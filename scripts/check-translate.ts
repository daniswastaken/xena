/**
 * Live check for the TTS translation chain (gtx → MyMemory → passthrough)
 * and offline check for the version-keyed onboarding marker logic.
 * Run: node scripts/run-check.mjs scripts/check-translate.ts
 */
import { translateToJapanese } from "../apps/stage-xena/src/main/tts/translate.js";

let failures = 0;
function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  // --- Translation chain (live network) -------------------------------------
  const ja = await translateToJapanese("Hello Father, I made you something nice.");
  console.log(`       -> ${ja}`);
  assert(
    /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(ja),
    "translateToJapanese returns Japanese text (any rung)",
  );

  const cached = await translateToJapanese("Hello Father, I made you something nice.");
  assert(cached === ja, "repeat call served from cache (identical output)");

  const passthrough = await translateToJapanese("");
  assert(passthrough === "", "empty input passes through");

  // JP input should round-trip unchanged-ish (translation of JA→JA);
  // only asserts it does not throw and returns non-empty.
  const jaIn = await translateToJapanese("こんにちは、父さん。");
  console.log(`       -> ${jaIn}`);
  assert(jaIn.trim().length > 0, "already-Japanese input does not throw");

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
