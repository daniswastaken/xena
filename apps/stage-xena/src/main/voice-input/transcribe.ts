/**
 * Voice input: renderer captures mic PCM -> WAV base64 -> this module
 * transcribes it through the free gpt-audio models on 9Router
 * (failover to OpenRouter ox-alpha handled by the chain).
 */
import { visionCompleteFailover, parseCompletionBody, type Router9Config } from "@xena/router9-client";

const TRANSCRIBE_MODELS = ["tokenrouter/openai/gpt-audio-mini", "tokenrouter/openai/gpt-audio"];

const PROMPT =
  "Transcribe the speech in this audio exactly. Reply with ONLY the transcription text, nothing else.";

export async function transcribeAudio(
  base64Wav: string,
  config: Router9Config,
  format: "wav" | "mp3" = "wav",
): Promise<string> {
  let lastError: unknown = null;
  for (const model of TRANSCRIBE_MODELS) {
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
                { type: "text", text: PROMPT },
                { type: "input_audio", input_audio: { data: base64Wav, format } },
              ],
            },
          ],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = parseCompletionBody(await res.text()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = (raw.choices?.[0]?.message?.content ?? "").trim();
      // Models like to prefix "Transcription:" — strip common wrappers.
      const cleaned = content
        .replace(/^[\s*]*transcription[:\s*]*/i, "")
        .replace(/^["'\s]+|["'\s]+$/g, "")
        .trim();
      if (cleaned !== "") return cleaned;
      throw new Error("empty transcription");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("transcription failed");
}
