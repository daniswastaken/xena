/**
 * OpenAI-compatible chat adapter — generic over base URL / key / model.
 * Serves both the 9Router rungs and the keyless Pollinations rung.
 * Reuses router9-client's battle-tested defensive body parsing (SSE frames
 * merged into one completion, first balanced JSON block salvage, etc).
 */
import { parseCompletionBody, Router9Error, type ChatMessage } from "@xena/router9-client";
import type { ChatCompletionResult } from "@xena/router9-client";

export interface OpenAiTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAiOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export async function openaiComplete(
  target: OpenAiTarget,
  messages: ChatMessage[],
  options: OpenAiOptions,
): Promise<ChatCompletionResult> {
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
  if (!res.ok) throw new Router9Error(res.statusText, res.status, await res.text());
  const raw = parseCompletionBody(await res.text());
  const msg = raw.choices?.[0]?.message;
  return {
    id: raw.id ?? "",
    model: raw.model ?? target.model,
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
  };
}

export async function openaiStream(
  target: OpenAiTarget,
  messages: ChatMessage[],
  options: OpenAiOptions,
  onToken: (delta: string) => void,
  onReasoning?: (delta: string) => void,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${target.baseUrl}/chat/completions`, {
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
  } catch (error) {
    if (error instanceof TypeError) throw new Router9Error(`network unreachable: ${error.message}`, 0, "");
    throw error;
  }
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
      if (typeof reasoning === "string" && reasoning.length > 0) onReasoning?.(reasoning);
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
