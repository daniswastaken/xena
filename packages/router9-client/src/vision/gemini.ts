/**
 * Google AI Studio Gemini adapter — primary provider for both text and vision.
 *
 * Gemini is primary because:
 * 1. It's a general-purpose chat model (not a cold coding model like
 *    oc/big-pickle) — better for conversational tone and 1-sentence replies
 * 2. One free key covers both text AND vision in the same pool
 *
 * Gemini uses its own `contents`/`inlineData` format (not OpenAI-compatible),
 * so we translate here and map back to the shared `FailoverResult` shape.
 */
import type { Router9Config } from "../config.js";
import { Router9Error, type ChatMessage } from "../types.js";
import type { FailoverChatOptions, FailoverResult } from "../chat/failover.js";

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

interface GemStreamChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
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

function toGeminiMessages(messages: ChatMessage[]): { systemText: string | null; contents: GemContent[] } {
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

async function geminiGenerate(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  model: string,
  apiKey: string,
  hasImages: boolean,
): Promise<FailoverResult> {
  const { systemText, contents } = toGeminiMessages(messages);
  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  body.generationConfig = { maxOutputTokens: options.maxTokens ?? 700 };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let status = res.status;
    let msg = res.statusText;
    try {
      const e = JSON.parse(text) as { error?: { code?: number; message?: string } };
      if (e.error?.message) msg = e.error.message;
      if (typeof e.error?.code === "number") status = e.error.code;
    } catch {
      /* keep statusText */
    }
    throw new Router9Error(msg, status, text.slice(0, 800));
  }

  const raw = JSON.parse(text) as GemResponse;
  if (raw.error) throw new Router9Error(raw.error.message ?? "gemini error", raw.error.code ?? 500, text.slice(0, 800));

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
    providerUsed: hasImages ? "gemini-vision" : "gemini",
  };
}

/** Non-streaming Gemini chat completion (text-only messages). */
export async function geminiChat(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  if (!config.geminiApiKey) throw new Router9Error("gemini not configured", 0, "");
  return geminiGenerate(messages, options, config.geminiChatModel, config.geminiApiKey, false);
}

/** Non-streaming Gemini vision completion (messages may contain images). */
export async function geminiVision(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  if (!config.geminiApiKey) throw new Router9Error("gemini not configured", 0, "");
  return geminiGenerate(messages, options, config.geminiVisionModel, config.geminiApiKey, true);
}

/** Streaming Gemini chat completion (text-only, SSE). */
export async function geminiStreamChat(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
  onToken: (delta: string) => void,
): Promise<string> {
  if (!config.geminiApiKey) throw new Router9Error("gemini not configured", 0, "");
  const { systemText, contents } = toGeminiMessages(messages);
  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  body.generationConfig = {
    maxOutputTokens: options.maxTokens ?? 512,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiChatModel}:streamGenerateContent?key=${config.geminiApiKey}&alt=sse`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) throw new Router9Error(res.statusText, res.status, (await res.text()).slice(0, 800));
  if (!res.body) throw new Router9Error("empty response body", res.status, "");

  let full = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line) as GemStreamChunk;
        const text = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (text) {
          full += text;
          onToken(text);
        }
      } catch {
        /* tolerate non-JSON SSE noise */
      }
    }
  }
  if (full === "") throw new Router9Error("gemini stream returned empty", 502, "");
  return full;
}
