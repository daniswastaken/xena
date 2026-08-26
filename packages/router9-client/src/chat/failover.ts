/**
 * Provider failover for chat completions.
 * Primary: 9Router. Fallback: OpenRouter (free tier) when the primary is
 * out of quota, unauthenticated, or unreachable. Streaming restarts from
 * scratch on the fallback only if no token was emitted yet.
 */
import type { Router9Config } from "../config.js";
import {
  Router9Error,
  type ChatCompletionResult,
  type ChatMessage,
} from "../types.js";
import { chatComplete, parseCompletionBody } from "./completions.js";

export interface ProviderTarget {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface FailoverChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** reasoning-model deltas (arrive before content) */
  onReasoning?: (delta: string) => void;
}

export interface FailoverResult extends ChatCompletionResult {
  providerUsed: string;
}

/** Errors worth trying the next provider for: quota, auth, rate limit, upstream outage. */
const RETRYABLE_STATUSES = new Set([401, 402, 403, 404, 408, 429, 500, 502, 503, 504]);

/**
 * Circuit breaker: when the fallback ALSO fails with quota/pressure errors,
 * skip it for a cooldown so every request doesn't pay the double-timeout.
 * Module-level on purpose — one breaker per process.
 */
let fallbackPenaltyUntil = 0;
const FALLBACK_PENALTY_MS = 5 * 60_000;

function fallbackUnderPenalty(): boolean {
  return Date.now() < fallbackPenaltyUntil;
}

function penalizeFallback(): void {
  fallbackPenaltyUntil = Date.now() + FALLBACK_PENALTY_MS;
}

function clearFallbackPenalty(): void {
  fallbackPenaltyUntil = 0;
}

export function buildProviderChain(config: Router9Config, modelOverride?: string): ProviderTarget[] {
  const chain: ProviderTarget[] = [
    { name: "router9", baseUrl: config.baseUrl, apiKey: config.apiKey, model: modelOverride ?? config.textModel },
  ];
  if (config.fallback) {
    chain.push({
      name: "openrouter",
      baseUrl: config.fallback.baseUrl,
      apiKey: config.fallback.apiKey,
      model: config.fallback.textModel,
    });
  }
  return chain;
}

/**
 * Vision chain: router9's vision model first, then the fallback provider's
 * vision model, then its text model (some free text models accept images —
 * probed and cached in docs/vision-models.md).
 */
export function buildVisionChain(config: Router9Config): ProviderTarget[] {
  const chain: ProviderTarget[] = [
    { name: "router9", baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.visionModel },
  ];
  if (config.fallback) {
    chain.push({
      name: "openrouter",
      baseUrl: config.fallback.baseUrl,
      apiKey: config.fallback.apiKey,
      model: config.fallback.visionModel,
    });
    if (config.fallback.textModel !== config.fallback.visionModel) {
      chain.push({
        name: "openrouter-alt",
        baseUrl: config.fallback.baseUrl,
        apiKey: config.fallback.apiKey,
        model: config.fallback.textModel,
      });
    }
  }
  return chain;
}

function isFailoverWorthy(error: unknown): boolean {
  if (error instanceof Router9Error) return RETRYABLE_STATUSES.has(error.status);
  if (error instanceof TypeError) return true; // fetch network failure / DNS / refused
  // Timeouts (AbortSignal.timeout / controller abort) — next provider may be faster.
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return true;
  return false;
}

interface RawChoice {
  message?: { content?: string | null; reasoning_content?: string | null };
  finish_reason?: string | null;
}

interface RawResponse {
  id?: string;
  model?: string;
  choices?: RawChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

function toResult(raw: RawResponse, requestedModel: string, providerUsed: string): FailoverResult {
  const msg = raw.choices?.[0]?.message;
  return {
    id: raw.id ?? "",
    model: raw.model ?? requestedModel,
    content: typeof msg?.content === "string" ? msg.content : "",
    reasoning: msg?.reasoning_content ?? null,
    finishReason: raw.choices?.[0]?.finish_reason ?? null,
    usage: raw.usage
      ? {
          promptTokens: raw.usage.prompt_tokens ?? 0,
          completionTokens: raw.usage.completion_tokens ?? 0,
          totalTokens: raw.usage.total_tokens ?? 0,
        }
      : null,
    providerUsed,
  };
}

async function completeOn(
  target: ProviderTarget,
  messages: ChatMessage[],
  options: FailoverChatOptions,
): Promise<FailoverResult> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({
      model: target.model,
      messages,
      max_tokens: options.maxTokens ?? 512,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    }),
    signal: options.signal,
  });
  if (!res.ok) throw new Router9Error(res.statusText, res.status, (await res.text()).slice(0, 800));
  const raw = parseCompletionBody(await res.text());
  const result = toResult(raw, target.model, target.name);
  // Upstream can return HTTP 200 with an empty body under load — treat as
  // transient failure so the next provider gets its chance.
  if (result.content.trim() === "") {
    throw new Router9Error("provider returned empty completion", 502, "");
  }
  return result;
}

/** Non-streaming completion with automatic provider failover. */
export async function chatCompleteFailover(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  return completeWalk(buildProviderChain(config, options.model), messages, options);
}

/** Non-streaming vision completion with automatic provider failover. */
export async function visionCompleteFailover(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  return completeWalk(buildVisionChain(config), messages, options);
}

async function completeWalk(
  chain: ProviderTarget[],
  messages: ChatMessage[],
  options: FailoverChatOptions,
): Promise<FailoverResult> {
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]!;
    if (i > 0 && fallbackUnderPenalty()) break; // breaker open — fail fast
    try {
      const result = await completeOn(target, messages, options);
      if (i > 0) clearFallbackPenalty();
      return result;
    } catch (error) {
      lastError = error;
      const status = error instanceof Router9Error ? error.status : null;
      if (i > 0 && (status === 429 || status === 502 || status === 503)) penalizeFallback();
      if (options.signal?.aborted || !isFailoverWorthy(error) || i === chain.length - 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Router9Error("all providers failed", 0, "");
}

/** Streaming completion with pre-stream provider failover. */
export async function streamChatFailover(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  onToken: (delta: string) => void,
  config: Router9Config,
): Promise<{ full: string; providerUsed: string }> {
  const chain = buildProviderChain(config, options.model);
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]!;
    if (i > 0 && fallbackUnderPenalty()) break; // breaker open — fail fast
    let emitted = false;
    const guardedToken = (delta: string): void => {
      emitted = true;
      onToken(delta);
    };
    try {
      const full = await streamOn(target, messages, { ...options, onReasoning: (r) => options.onReasoning?.(r) }, guardedToken);
      if (i > 0) clearFallbackPenalty();
      return { full, providerUsed: target.name };
    } catch (error) {
      lastError = error;
      const status = error instanceof Router9Error ? error.status : null;
      if (i > 0 && !emitted && (status === 429 || status === 502 || status === 503)) penalizeFallback();
      // Never restart a stream the user already saw tokens from.
      if (emitted || options.signal?.aborted || !isFailoverWorthy(error) || i === chain.length - 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Router9Error("all providers failed", 0, "");
}

async function streamOn(
  target: ProviderTarget,
  messages: ChatMessage[],
  options: FailoverChatOptions,
  onToken: (delta: string) => void,
): Promise<string> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({
      model: target.model,
      messages,
      max_tokens: options.maxTokens ?? 512,
      stream: true,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    }),
    signal: options.signal,
  });
  if (!res.ok) throw new Router9Error(res.statusText, res.status, (await res.text()).slice(0, 800));
  if (!res.body) throw new Router9Error("empty response body", res.status, "");

  let full = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handlePayload = (payload: string): void => {
    if (payload === "[DONE]") return;
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>;
      };
      const reasoning = json.choices?.[0]?.delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        options.onReasoning?.(reasoning);
      }
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        full += delta;
        onToken(delta);
      }
    } catch {
      // tolerate keep-alive noise between events
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = (buffer.slice(0, nl) as string).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) handlePayload(line.slice(5).trim());
    }
  }
  // Upstream sometimes returns a non-SSE JSON body despite stream:true.
  if (full === "" && buffer.trim() !== "") {
    try {
      const raw = JSON.parse(buffer.trim()) as RawResponse;
      const content =
        typeof raw.choices?.[0]?.message?.content === "string"
          ? raw.choices[0]!.message!.content!
          : "";
      if (content) {
        full = content;
        onToken(content);
      }
    } catch {
      /* nothing salvageable */
    }
  }
  if (full === "") throw new Router9Error("provider returned empty stream", 502, "");
  return full;
}

