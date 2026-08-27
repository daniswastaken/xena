/**
 * Google AI Studio Gemini vision adapter — a separate free pool used as a
 * vision fallback. Gemini uses its own `contents`/`inlineData` format (not
 * OpenAI-compatible), so we translate OpenAI `ChatMessage`s here and map the
 * response back to the shared `FailoverResult` shape.
 *
 * Vision model: `gemini-flash-latest` (AI Studio free tier, 1M context).
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

export async function geminiVision(
  messages: ChatMessage[],
  options: FailoverChatOptions,
  config: Router9Config,
): Promise<FailoverResult> {
  if (!config.geminiApiKey) throw new Router9Error("gemini not configured", 0, "");
  const model = config.geminiVisionModel;
  const { systemText, contents } = toGeminiMessages(messages);
  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  body.generationConfig = { maxOutputTokens: options.maxTokens ?? 700 };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;

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
  // Gemini can return HTTP 200 with an empty candidate under load — treat as
  // transient so the next fallback (or a retry) gets its chance.
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
    providerUsed: "gemini",
  };
}
