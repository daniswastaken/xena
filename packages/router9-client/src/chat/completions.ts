/**
 * Chat completions against the 9Router OpenAI-compatible endpoint.
 */
import { loadConfig, type Router9Config } from "../config.js";
import {
  Router9Error,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatRequestOptions,
} from "../types.js";

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

function extractContent(raw: RawResponse): string {
  const msg = raw.choices?.[0]?.message;
  return typeof msg?.content === "string" ? msg.content : "";
}

/**
 * Router9 sometimes appends SSE frames (e.g. "data: [DONE]") even to
 * non-streaming bodies — parse defensively.
 */
export function parseCompletionBody(text: string): RawResponse {
  try {
    return JSON.parse(text) as RawResponse;
  } catch {
    let cleaned = text.split(/\r?\ndata:/)[0]?.trim() ?? "";
    if (cleaned === "") throw new Router9Error("unparseable response body", 502, text.slice(0, 300));
    try {
      return JSON.parse(cleaned) as RawResponse;
    } catch {
      // last resort: first balanced {...} block
      const start = text.indexOf("{");
      if (start !== -1) {
        let depth = 0;
        for (let i = start; i < text.length; i++) {
          if (text[i] === "{") depth++;
          else if (text[i] === "}") {
            depth--;
            if (depth === 0) {
              cleaned = text.slice(start, i + 1);
              return JSON.parse(cleaned) as RawResponse;
            }
          }
        }
      }
      throw new Router9Error("unparseable response body", 502, text.slice(0, 300));
    }
  }
}

export async function chatComplete(
  messages: ChatMessage[],
  options: Omit<ChatRequestOptions, "messages" | "signal"> & { signal?: AbortSignal },
  config: Router9Config = loadConfig(),
): Promise<ChatCompletionResult> {
  const body = JSON.stringify({
    model: options.model,
    messages,
    max_tokens: options.maxTokens ?? 512,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  });
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body,
    signal: options.signal,
  });
  if (!res.ok) throw new Router9Error(res.statusText, res.status, await res.text());
  const raw = parseCompletionBody(await res.text());
  return {
    id: raw.id ?? "",
    model: raw.model ?? options.model,
    content: extractContent(raw),
    reasoning: raw.choices?.[0]?.message?.reasoning_content ?? null,
    finishReason: raw.choices?.[0]?.finish_reason ?? null,
    usage: raw.usage
      ? {
          promptTokens: raw.usage.prompt_tokens ?? 0,
          completionTokens: raw.usage.completion_tokens ?? 0,
          totalTokens: raw.usage.total_tokens ?? 0,
        }
      : null,
  };
}

/**
 * Streaming completion. Invokes onToken for every delta chunk; resolves with
 * the fully-assembled text. Falls back to a single-token yield when the
 * upstream ignores `stream` and returns a plain completion.
 */
export async function streamChat(
  messages: ChatMessage[],
  options: Omit<ChatRequestOptions, "messages">,
  onToken: (delta: string) => void,
  config: Router9Config = loadConfig(),
): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: options.model,
      messages,
      max_tokens: options.maxTokens ?? 512,
      stream: true,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    }),
    signal: options.signal,
  });
  if (!res.ok) throw new Router9Error(res.statusText, res.status, await res.text());
  if (!res.body) throw new Router9Error("empty response body", res.status, "");

  let full = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleSsePayload = (payload: string): void => {
    if (payload === "[DONE]") return;
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string | null } }>;
      };
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
      if (line.startsWith("data:")) handleSsePayload(line.slice(5).trim());
    }
  }
  // Upstream sometimes returns a non-SSE JSON body despite stream:true.
  if (full === "" && buffer.trim() !== "") {
    try {
      const raw = JSON.parse(buffer.trim()) as RawResponse;
      const content = extractContent(raw);
      if (content) {
        full = content;
        onToken(content);
      }
    } catch {
      /* nothing salvageable */
    }
  }
  return full;
}
