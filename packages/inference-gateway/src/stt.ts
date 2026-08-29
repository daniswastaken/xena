/**
 * Speech-to-text chain — Gemini inline audio primary, 9Router gpt-audio
 * secondary. Voice input survives 9Router being down.
 */
import type { InferenceConfig } from "./config.js";
import { InferenceError } from "./errors.js";
import { supervisor } from "./supervisor.js";
import { parseCompletionBody, Router9Error } from "@xena/router9-client";

const STT_PROMPT =
  "Transcribe the speech in this audio exactly. Reply with ONLY the transcription text, nothing else.";

const R9_STT_MODELS = ["tokenrouter/openai/gpt-audio-mini", "tokenrouter/openai/gpt-audio"];

function cleanTranscription(content: string): string {
  return content
    .replace(/^[\s*]*transcription[:\s*]*/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
}

/** Gemini inline-audio transcription (primary). */
async function geminiTranscribe(
  config: InferenceConfig,
  base64Audio: string,
  mimeType: string,
  signal: AbortSignal,
): Promise<string> {
  const model = config.geminiChatModel;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: STT_PROMPT },
          { inlineData: { mimeType, data: base64Audio } },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 300 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const e = JSON.parse(text) as { error?: { message?: string } };
      if (e.error?.message) message = e.error.message;
    } catch {
      /* keep status */
    }
    throw new Router9Error(message, res.status, text.slice(0, 800));
  }
  const raw = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const cleaned = cleanTranscription(content);
  if (cleaned === "") throw new Router9Error("gemini returned empty transcription", 502, "");
  return cleaned;
}

/** 9Router gpt-audio transcription (secondary). */
async function r9Transcribe(
  config: InferenceConfig,
  base64Wav: string,
  format: "wav" | "mp3",
  signal: AbortSignal,
): Promise<string> {
  let lastError: unknown = null;
  for (const model of R9_STT_MODELS) {
    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: STT_PROMPT },
                { type: "input_audio", input_audio: { data: base64Wav, format } },
              ],
            },
          ],
          max_tokens: 300,
        }),
        signal,
      });
      if (!res.ok) throw new Router9Error(res.statusText, res.status, await res.text());
      const raw = parseCompletionBody(await res.text()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const cleaned = cleanTranscription(raw.choices?.[0]?.message?.content ?? "");
      if (cleaned !== "") return cleaned;
      throw new Router9Error("empty transcription", 502, "");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Router9Error("transcription failed", 0, "");
}

/**
 * Transcribe mic audio through the STT chain. Throws InferenceError("stt")
 * when both rungs fail — UI shows a friendly bar line, never raw detail.
 */
export async function transcribeAudio(
  base64Wav: string,
  config: InferenceConfig,
  format: "wav" | "mp3" = "wav",
): Promise<string> {
  const signal = AbortSignal.timeout(90_000);
  const mimeType = format === "wav" ? "audio/wav" : "audio/mpeg";
  const errors: unknown[] = [];

  if (config.geminiApiKey && !supervisor.providerSkipped("gemini")) {
    try {
      const text = await geminiTranscribe(config, base64Wav, mimeType, signal);
      supervisor.noteProviderSuccess("gemini");
      return text;
    } catch (error) {
      if (signal.aborted) throw new InferenceError("aborted", "stt aborted");
      supervisor.noteProviderFailure("gemini", error instanceof Error ? error.message : String(error));
      errors.push(error);
    }
  }

  if (config.nineRouterEnabled && !supervisor.providerSkipped("router9")) {
    try {
      const text = await r9Transcribe(config, base64Wav, format, signal);
      supervisor.noteProviderSuccess("router9");
      return text;
    } catch (error) {
      if (signal.aborted) throw new InferenceError("aborted", "stt aborted");
      supervisor.noteProviderFailure("router9", error instanceof Error ? error.message : String(error));
      errors.push(error);
    }
  }

  throw new InferenceError(
    "stt",
    errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; ").slice(0, 400),
  );
}
