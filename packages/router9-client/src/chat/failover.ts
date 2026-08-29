/**
 * Provider failover for chat completions.
 *
 * Provider priority (primary → secondary → tertiary):
 *   1. Gemini       — general-purpose chat model; also handles vision in the same pool
 *   2. 9Router      — reasoning (oc/big-pickle), catch-all secondary
 *   3. 9Router free — last resort within the same gateway
 *
 * Streaming restarts from scratch on a fallback ONLY if no token was emitted yet.
 */
import type { Router9Config } from "../config.js";
import {
  Router9Error,
  type ChatCompletionResult,
  type ChatMessage,
} from "../types.js";
import { chatComplete } from "./completions.js";
import { geminiChat, geminiVision, geminiStreamChat } from "../vision/gemini.js";

export interface ProviderTarget {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  kind: "openai" | "gemini";
  /** "text" targets are tried by streamChatFailover; "vision" only by visionCompleteFailover */
  usage: "text" | "vision";
}

export interface FailoverChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Fires when a reasoning-model delta arrives (before content). */
  onReasoning?: (delta: string) => void;
}

export interface FailoverResult extends ChatCompletionResult {
  providerUsed: string;
}

const RETRYABLE_STATUSES = new Set([401, 402, 403, 404, 408, 429, 500, 502, 503, 504]);

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

function isFailoverWorthy(error: unknown): boolean {
  if (error instanceof Router9Error) return RETRYABLE_STATUSES.has(error.status);
  if (error instanceof TypeError) return true;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return true;
  return false;
}

/** Text chain: Gemini → 9Router primary → 9Router free fallbacks. */
export function buildProviderChain(config: Router9Config): ProviderTarget[] {
  const chain: ProviderTarget[] = [];
  if (config.geminiApiKey) {
    chain.push({ name: "gemini", baseUrl: "", apiKey: "", model: config.geminiChatModel, kind: "gemini", usage: "text" });
  }
  chain.push({ name: "router9", baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.textModel, kind: "openai", usage: "text" });
  for (const model of config.fallbackTextModels) {
    chain.push({ name: "router9-fb", baseUrl: config.baseUrl, apiKey: config.apiKey, model, kind: "openai", usage: "text" });
  }
  return chain;
}

/** Vision chain: Gemini → 9Router primary → 9Router free fallbacks. */
export function buildVisionChain(config: Router9Config): ProviderTarget[] {
  const chain: ProviderTarget[] = [];
  if (config.geminiApiKey) {
    chain.push({ name: "gemini", baseUrl: "", apiKey: "", model: config.geminiVisionModel, kind: "gemini", usage: "vision" });
  }
  chain.push({ name: "router9", baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.visionModel, kind: "openai", usage: "vision" });
  for (const model of config.fallbackVisionModels) {
    chain.push({ name: "router9-fb", baseUrl: config.baseUrl, apiKey: config.apiKey, model, kind: "openai", usage: "vision" });
  }
  return chain;
}

async function completeOnTarget(
  target: ProviderTarget,
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  if (target.kind === "gemini" && target.usage === "text") {
    const result = await geminiChat(messages, options, config);
    return { ...result, providerUsed: target.name };
  }
  if (target.kind === "gemini" && target.usage === "vision") {
    const result = await geminiVision(messages, options, config);
    return { ...result, providerUsed: target.name };
  }
  // openai / router9 path
  const result = await chatComplete(
    messages,
    { model: target.model, maxTokens: options.maxTokens, temperature: options.temperature, signal: options.signal, baseUrl: target.baseUrl, apiKey: target.apiKey },
    config,
  );
  return { ...result, providerUsed: target.name };
}

/** Non-streaming completion with automatic provider failover (text). */
export async function chatCompleteFailover(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  return completeWalk(buildProviderChain(config), messages, options, config);
}

/** Non-streaming vision completion with automatic provider failover. */
export async function visionCompleteFailover(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  return completeWalk(buildVisionChain(config), messages, options, config);
}

async function completeWalk(
  chain: ProviderTarget[],
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]!;
    if (i > 0 && fallbackUnderPenalty()) break;
    try {
      const result = await completeOnTarget(target, messages, options, config);
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

/** Streaming completion with pre-stream provider failover (text only). */
export async function streamChatFailover(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  onToken: (delta: string) => void,
  config: Router9Config,
): Promise<{ full: string; providerUsed: string }> {
  const chain = buildProviderChain(config);
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]!;
    if (i > 0 && fallbackUnderPenalty()) break;
    let emitted = false;
    const guardedToken = (delta: string): void => {
      emitted = true;
      onToken(delta);
    };
    try {
      let full: string;
      let providerUsed: string;
      if (target.kind === "gemini" && target.usage === "text") {
        full = await geminiStreamChat(messages, options, config, guardedToken);
        providerUsed = target.name;
      } else {
        full = await streamOn(target, messages, options, guardedToken);
        providerUsed = target.name;
      }
      if (i > 0) clearFallbackPenalty();
      return { full, providerUsed };
    } catch (error) {
      lastError = error;
      const status = error instanceof Router9Error ? error.status : null;
      if (i > 0 && !emitted && (status === 429 || status === 502 || status === 503)) penalizeFallback();
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
      /* tolerate keep-alive noise between events */
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
  if (full === "") throw new Router9Error("provider returned empty stream", 502, "");
  return full;
}
