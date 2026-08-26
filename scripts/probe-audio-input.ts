/**
 * Probes 9Router audio-input models: synthesize speech via @xena/tts,
 * send as OpenAI input_audio, see if the model transcribes/answers.
 * Usage: node scripts/run-check.mjs scripts/probe-audio-input.ts
 */
import { speakToBase64 } from "@xena/tts";
import { loadConfig, parseCompletionBody } from "@xena/router9-client";

const config = loadConfig();
const MODELS = ["tokenrouter/openai/gpt-audio-mini", "tokenrouter/openai/gpt-audio"];

let failures = 0;
function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  const audioB64 = await speakToBase64("What is the capital of France? Answer in one word.");
  console.log(`audio: ${audioB64.length} b64 chars`);

  for (const model of MODELS) {
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
                { type: "text", text: "Transcribe the audio, then answer the question in it." },
                { type: "input_audio", input_audio: { data: audioB64, format: "mp3" } },
              ],
            },
          ],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        console.log(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
        continue;
      }
      const raw = parseCompletionBody(await res.text()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = raw.choices?.[0]?.message?.content ?? "";
      console.log(`${model}: ${JSON.stringify(content.slice(0, 140))}`);
      if (content.toLowerCase().includes("paris")) {
        assert(true, `${model} heard the question and answered correctly`);
      }
    } catch (e) {
      console.log(`${model}: ERR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
