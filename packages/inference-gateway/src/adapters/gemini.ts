/**
 * Google AI Studio Gemini adapter — primary provider rungs.
 * One free key covers text, vision, and audio (STT).
 *
 * Kept in the gateway (not router9-client) because model selection and rung
 * order are orchestration policy; this file is pure transport for the
 * Gemini wire format (contents/parts, not OpenAI messages).
 */
import { Router9Error, type ChatCompletionResult, type ChatMessage } from "@xena/router9-client";

export interface GeminiTarget {
  apiKey: string;
  model: string;
}

interface GemPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GemContent {
  role: string;
  parts: GemPart[];
}

interface GemResponse {
  id?: string;
  model?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  error?: { code?: number; message?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function splitDataUrl(url: string): { mime: string; data: string } {
  const i = url.indexOf(",");
  if (i === -1) return { mime: "image/png", data: url };
  const meta = url.slice(0, i);
  const data = url.slice(i + 1);
  const m = /^data:(.+?)(?:;base64)?$/i.exec(meta);
  return { mime: m ? m[1]! : "image/png", data };
}

export function toGeminiMessages(messages: ChatMessage[]): { systemText: string | null; contents: GemContent[] } {
  let systemText: string | null = null;
  const contents: GemContent[] = [];
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts: GemPart[] = [];
    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else {
      for (const part of msg.content) {
        if (part.type === "text") parts.push({ text: part.text });
        else if (part.type === "image_url") {
          const { mime, data } = splitDataUrl(part.image_url.url);
          parts.push({ inlineData: { mimeType: mime, data } });
        }
      }
    }
    if (msg.role === "system") {
      systemText = parts.map((p) => p.text ?? "").join("");
      continue;
    }
    contents.push({ role, parts });
  }
  return { systemText, contents };
}

async function geminiFetch(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Router9Error(`network unreachable: ${error.message}`, 0, "");
    throw error;
  }
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function throwGeminiHttp(status: number, text: string): never {
  let code = status;
  let msg = `HTTP ${status}`;
  try {
    const e = JSON.parse(text) as { error?: { code?: number; message?: string } };
    if (e.error?.message) msg = e.error.message;
    if (typeof e.error?.code === "number") code = e.error.code;
  } catch {
    /* keep statusText */
  }
  throw new Router9Error(msg, code, text.slice(0, 800));
}

function toResult(raw: GemResponse, model: string, text: string): ChatCompletionResult {
  const content = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (content.trim() === "") throw new Router9Error("gemini returned empty completion", 502, text.slice(0, 300));
  const u = raw.usageMetadata;
  return {
    id: raw.id ?? "",
    model: raw.model ?? model,
    content,
    reasoning: null,
    finishReason: raw.candidates?.[0]?.finishReason ?? null,
    usage: u
      ? {
          promptTokens: u.promptTokenCount ?? 0,
          completionTokens: u.candidatesTokenCount ?? 0,
          totalTokens: u.totalTokenCount ?? 0,
        }
      : null,
  };
}

/** Non-streaming Gemini completion (text or vision, model chosen by target). */
export async function geminiComplete(
  target: GeminiTarget,
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<ChatCompletionResult> {
  const { systemText, contents } = toGeminiMessages(messages);
  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  body.generationConfig = {
    maxOutputTokens: options.maxTokens ?? 512,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:generateContent?key=${target.apiKey}`;
  const { ok, status, text } = await geminiFetch(url, body, options.signal);
  if (!ok) throwGeminiHttp(status, text);
  const raw = JSON.parse(text) as GemResponse;
  if (raw.error) throw new Router9Error(raw.error.message ?? "gemini error", raw.error.code ?? 500, text.slice(0, 800));
  return toResult(raw, target.model, text);
}

/** Streaming Gemini completion (SSE). Vision-capable model works for images. */
export async function geminiStream(
  target: GeminiTarget,
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number; signal?: AbortSignal },
  onToken: (delta: string) => void,
): Promise<string> {
  const { systemText, contents } = toGeminiMessages(messages);
  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  body.generationConfig = {
    maxOutputTokens: options.maxTokens ?? 512,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:streamGenerateContent?key=${target.apiKey}&alt=sse`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Router9Error(`network unreachable: ${error.message}`, 0, "");
    throw error;
  }
  if (!res.ok) throwGeminiHttp(res.status, await res.text());
  if (!res.body) throw new Router9Error("empty response body", res.status, "");

  let full = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string): void => {
    if (!line) return;
    try {
      const chunk = JSON.parse(line) as GemResponse;
      const text = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (text) {
        full += text;
        onToken(text);
      }
    } catch {
      /* tolerate non-JSON SSE noise */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      handleLine(line);
    }
  }
  if (full === "") throw new Router9Error("gemini stream returned empty", 502, "");
  return full;
}
