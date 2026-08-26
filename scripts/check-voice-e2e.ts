/**
 * Real-speech E2E through transcribeAudio's exact code path:
 * TTS mp3 -> transcribeAudio(format mp3) -> transcription.
 * Usage: node scripts/run-check.mjs scripts/check-voice-e2e.ts
 */
import { speakToBase64 } from "@xena/tts";
import { loadConfig } from "@xena/router9-client";
import { transcribeAudio } from "../apps/stage-xena/src/main/voice-input/transcribe.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const mp3 = await speakToBase64("What is two plus two? Answer with just the number.");
  console.log(`speech: ${mp3.length} b64 chars (mp3)`);
  const text = await transcribeAudio(mp3, config, "mp3");
  console.log("transcribed:", JSON.stringify(text));
  if (/2\s*(?:\+|plus)\s*2|two\s+plus\s+two/i.test(text)) {
    console.log("PASS  voice E2E through transcribeAudio");
  } else {
    console.log("FAIL  unexpected transcription");
    process.exitCode = 1;
  }
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
