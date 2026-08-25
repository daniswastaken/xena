/**
 * Smoke test: synthesize speech to file.
 * Usage: node scripts/smoke-tts.mjs [text]
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const text = process.argv[2] ?? "Xena online. Corner secured.";
const tts = new MsEdgeTTS();
await tts.setMetadata("en-US-AriaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
const { audioStream } = await tts.toStream(text);
const chunks = [];
for await (const c of audioStream) chunks.push(c);
const buf = Buffer.concat(chunks);
const out = process.env.TEMP + "\\opencode\\xena-tts.mp3";
(await import("node:fs")).writeFileSync(out, buf);
console.log(`[smoke-tts] wrote ${out} (${buf.length} bytes)`);
await tts.close();
if (buf.length < 1000) {
  console.error("[smoke-tts] FAIL: suspiciously small audio");
  process.exit(1);
}
console.log("[smoke-tts] PASS");
