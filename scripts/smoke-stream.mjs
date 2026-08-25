/**
 * Smoke test: streamChat through the real 9Router (same code path as the app).
 * Usage: node scripts/smoke-stream.mjs [message]
 */
import { loadConfig, streamChat } from "../packages/router9-client/src/index.js";

const config = loadConfig();
const message = process.argv[2] ?? "Reply with exactly: XENA STREAM OK";
let tokens = 0;
const full = await streamChat(
  [
    { role: "system", content: "You are terse." },
    { role: "user", content: message },
  ],
  { model: config.textModel, maxTokens: 300 },
  (delta) => {
    tokens++;
    process.stdout.write(delta);
  },
);
process.stdout.write("\n");
console.log(`[smoke] model=${config.textModel} tokens=${tokens} chars=${full.length}`);
if (full.length === 0) {
  console.error("[smoke] FAIL: empty stream");
  process.exit(1);
}
console.log("[smoke] PASS");
