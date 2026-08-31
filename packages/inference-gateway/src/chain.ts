/**
 * Provider chain — text/vision walk with supervisor-integrated failover.
 *
 * Invariants (from ADR-001, kept):
 *   - never restart a stream after the first emitted token, even across a
 *     failover hop (rung switch happens only pre-first-token)
 *   - a rung failure mid-stream leaves the partial reply standing; no error
 *     surfaces in the bubble for it
 *
 * Rung failure classification (supervisor):
 *   404 / empty 200 -> model evicted for 10 min, walk continues
 *   429 / 402 / 5xx -> provider noted, walk continues
 *   network error  -> provider noted, walk continues
 * Whole-chain failure -> classified InferenceError (errors.ts); UI maps kinds
 * to persona lines so raw provider detail never reaches the bubble.
 */
import type { InferenceConfig } from "./config.js";
import { supervisor, type ProviderId } from "./supervisor.js";
import { InferenceError } from "./errors.js";
import { geminiComplete, geminiStream } from "./adapters/gemini.js";
import { openaiComplete, openaiStream, type OpenAiTarget } from "./adapters/openai.js";
import { notifyRouter9KeyWorking, notifyRouter9KeyRejected } from "./child9router.js";
import { Router9Error, type ChatCompletionResult, type ChatMessage } from "@xena/router9-client";

export type ChainUsage = "text" | "vision";

export interface FailoverOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Reasoning-model deltas before content starts (thinking indicator). */
  onReasoning?: (delta: string) => void;
}

export interface FailoverResult extends ChatCompletionResult {
  /** Rung that served the reply, e.g. "gemini:gemini-2.5-flash". */
  providerUsed: string;
}

interface Rung {
  provider: ProviderId;
  model: string;
  kind: "gemini" | "openai";
  /** Fully-resolved target; gemini rungs carry the API key, openai rungs the baseUrl/key. */
  target: { apiKey: string; baseUrl: string };
}

const POLLINATIONS_BASE = "https://text.pollinations.ai/openai";

function buildChain(config: InferenceConfig, usage: ChainUsage): Rung[] {
  const rungs: Rung[] = [];

  if (config.geminiApiKey) {
    const model = usage === "text" ? config.geminiChatModel : config.geminiVisionModel;
    if (!supervisor.modelDead("gemini", model)) {
      rungs.push({ provider: "gemini", model, kind: "gemini", target: { apiKey: config.geminiApiKey, baseUrl: "" } });
    }
    const lite = config.geminiLiteModel;
    if (lite && lite !== model && !supervisor.modelDead("gemini-lite", lite)) {
      rungs.push({ provider: "gemini-lite", model: lite, kind: "gemini", target: { apiKey: config.geminiApiKey, baseUrl: "" } });
    }
  }

  const r9Models =
    usage === "text"
      ? [config.textModel, ...config.fallbackTextModels]
      : [config.visionModel, ...config.fallbackVisionModels];
  for (const model of r9Models) {
    if (supervisor.modelDead("router9", model)) continue;
    rungs.push({
      provider: "router9",
      model,
      kind: "openai",
      target: { apiKey: config.apiKey, baseUrl: config.baseUrl },
    });
  }

  const pollinationsModel = usage === "text" ? config.pollinationsTextModel : config.pollinationsVisionModel;
  if (pollinationsModel && !supervisor.modelDead("pollinations", pollinationsModel)) {
    rungs.push({
      provider: "pollinations",
      model: pollinationsModel,
      kind: "openai",
      target: { apiKey: "", baseUrl: POLLINATIONS_BASE },
    });
  }

  // Provider-level skips applied last so the rung list above stays ordered.
  return rungs.filter((r) => !supervisor.providerSkipped(r.provider));
}

/** 404 = model de-listed upstream — evict rather than just penalize. */
function shouldEvictModel(status: number): boolean {
  return status === 404;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /\babort(ed)?\b/i.test(error.message);
}

function noteFailure(rung: Rung, error: unknown): void {
  const status = error instanceof Router9Error ? error.status : null;
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[inference] rung down: ${rung.provider}/${rung.model}${status !== null ? ` HTTP ${status}` : ""}: ${message.slice(0, 140)}`);
  if (status !== null && shouldEvictModel(status)) {
    supervisor.evictModel(rung.provider, rung.model, message);
  } else {
    supervisor.noteProviderFailure(rung.provider, message);
  }
  // A 401 from the local 9Router means the configured key no longer
  // matches the child's DB (rotated key / fresh machine) — let the child
  // re-adopt the DB key on its next probe.
  if (rung.provider === "router9" && status === 401) notifyRouter9KeyRejected();
}

function classifyChainFailure(errors: Array<{ rung: Rung; error: unknown }>): InferenceError {
  if (errors.length === 0) return new InferenceError("all-down", "no rungs configured");
  let sawQuota = false;
  let sawTimeout = false;
  let sawEmpty = false;
  let sawNetwork = false;
  let sawAbort = false;
  let sawOther = false;
  for (const { error } of errors) {
    if (isAbortError(error)) {
      sawAbort = true;
      continue;
    }
    if (error instanceof Router9Error) {
      if (error.status === 429 || error.status === 402) sawQuota = true;
      else if (error.status === 408) sawTimeout = true;
      else if (error.status === 502) sawEmpty = true;
      else if (error.status === 0) sawNetwork = true;
      else sawOther = true;
    } else if (error instanceof Error && error.name === "TimeoutError") {
      sawTimeout = true;
    } else if (error instanceof TypeError) {
      sawNetwork = true;
    } else {
      sawOther = true;
    }
  }
  const detail = errors
    .map(({ rung, error }) => {
      const status = error instanceof Router9Error ? ` HTTP ${error.status}` : "";
      const message = error instanceof Error ? error.message : String(error);
      return `${rung.provider}/${rung.model}${status}: ${message}`;
    })
    .join("; ")
    .slice(0, 600);
  if (sawAbort) return new InferenceError("aborted", "aborted by user");
  if (sawQuota && !sawNetwork && !sawOther) return new InferenceError("quota", detail);
  if (sawTimeout) return new InferenceError("timeout", detail);
  if (sawEmpty && !sawNetwork && !sawOther) return new InferenceError("empty", detail);
  return new InferenceError("all-down", detail);
}

async function runOnRung(
  rung: Rung,
  messages: ChatMessage[],
  options: FailoverOptions,
  onToken: ((delta: string) => void) | null,
): Promise<FailoverResult> {
  const providerUsed = `${rung.provider}:${rung.model}`;
  if (rung.kind === "gemini") {
    const target = { apiKey: rung.target.apiKey, model: rung.model };
    if (onToken) {
      const full = await geminiStream(target, messages, options, onToken);
      return { id: "", model: rung.model, content: full, reasoning: null, finishReason: "stop", usage: null, providerUsed };
    }
    const result = await geminiComplete(target, messages, options);
    return { ...result, providerUsed };
  }
  const target: OpenAiTarget = { baseUrl: rung.target.baseUrl, apiKey: rung.target.apiKey, model: rung.model };
  if (onToken) {
    const full = await openaiStream(target, messages, options, onToken, options.onReasoning);
    return { id: "", model: rung.model, content: full, reasoning: null, finishReason: "stop", usage: null, providerUsed };
  }
  const result = await openaiComplete(target, messages, options);
  return { ...result, providerUsed };
}

async function walk(
  usage: ChainUsage,
  messages: ChatMessage[],
  options: FailoverOptions,
  onToken: ((delta: string) => void) | null,
  config: InferenceConfig,
): Promise<FailoverResult> {
  const rungs = buildChain(config, usage);
  const errors: Array<{ rung: Rung; error: unknown }> = [];
  for (const rung of rungs) {
    let emitted = false;
    const guarded = onToken
      ? (delta: string): void => {
          emitted = true;
          onToken(delta);
        }
      : null;
    try {
      const result = await runOnRung(rung, messages, options, guarded);
      supervisor.noteProviderSuccess(rung.provider);
      if (rung.provider === "router9") notifyRouter9KeyWorking();
      return result;
    } catch (error) {
      errors.push({ rung, error });
      // Mid-stream failure: the partial reply stands, never restart (ADR-001).
      if (emitted) throw classifyChainFailure([{ rung, error }]);
      noteFailure(rung, error);
      if (options.signal?.aborted) throw classifyChainFailure(errors);
    }
  }
  const failure = classifyChainFailure(errors);
  // Total collapse -> auto self-recovery sweep (penalties, evictions, config).
  // Not for aborts — that's the user's own stop.
  if (failure.kind !== "aborted") supervisor.reset();
  throw failure;
}

/** Non-streaming completion with automatic provider failover (text). */
export async function chatCompleteFailover(
  messages: ChatMessage[],
  options: FailoverOptions,
  config: InferenceConfig,
): Promise<FailoverResult> {
  return walk("text", messages, options, null, config);
}

/** Non-streaming vision completion with automatic provider failover. */
export async function visionCompleteFailover(
  messages: ChatMessage[],
  options: FailoverOptions,
  config: InferenceConfig,
): Promise<FailoverResult> {
  return walk("vision", messages, options, null, config);
}

/** Streaming completion with pre-stream provider failover (text). */
export async function streamChatFailover(
  messages: ChatMessage[],
  options: FailoverOptions,
  onToken: (delta: string) => void,
  config: InferenceConfig,
): Promise<{ full: string; providerUsed: string }> {
  const result = await walk("text", messages, options, onToken, config);
  return { full: result.content, providerUsed: result.providerUsed };
}

/** Inspect the active chain (tray diagnostics + tests). */
export function describeChain(config: InferenceConfig, usage: ChainUsage): string[] {
  return buildChain(config, usage).map((r) => `${r.provider}/${r.model}`);
}
