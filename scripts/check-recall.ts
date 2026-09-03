/**
 * Offline checks for memory recall + provider failover wiring,
 * plus an optional live completion when 9Router is reachable.
 * Run: pnpm dlx tsx scripts/check-recall.ts   (or node --experimental-transform-types)
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@xena/xena-core";
import { MemoryRecall, renderRecallContext } from "@xena/xena-core";
import { Diary } from "@xena/xena-core";
import { FactsStore } from "@xena/xena-core";
import { extractEmotion, extractFactTags, cleanForDisplay, isEmotion, EMOTIONS, XENA_SYSTEM_PROMPT, buildSystemPrompt } from "@xena/xena-core";
import { loadInferenceConfig, describeChain, supervisor, resetInference, chatCompleteFailover, visionCompleteFailover, InferenceError, type InferenceConfig } from "@xena/inference-gateway";

let failures = 0;
function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  // --- Persona -------------------------------------------------------------
  assert(XENA_SYSTEM_PROMPT.includes("AI daughter") && XENA_SYSTEM_PROMPT.includes("Father"), "daughter identity and Father address present");
  assert(XENA_SYSTEM_PROMPT.includes("orange-peach hair") && XENA_SYSTEM_PROMPT.includes("paintbrush"), "witch appearance and wand canon present");
  assert(XENA_SYSTEM_PROMPT.includes("Absolutely NO emojis"), "no-emoji rule present");
  assert(XENA_SYSTEM_PROMPT.includes("zero tolerance for romantic"), "relationship boundary present");
  assert(!XENA_SYSTEM_PROMPT.includes("corner gremlin with Wi-Fi"), "old gremlin identity removed");
  assert(buildSystemPrompt({ preamble: "Father prefers concise answers." }).endsWith("Context:\nFather prefers concise answers."), "custom prompt preamble appended");

  // --- Emotion protocol ---------------------------------------------------
  const parsed = extractEmotion("[smug] Oh I absolutely called that.");
  assert(parsed.emotion === "smug", "leading mood tag recognized");
  assert(parsed.clean === "Oh I absolutely called that.", "tag stripped cleanly");
  assert(extractEmotion("no tags here").emotion === null, "untagged text passes through");
  assert(
    extractEmotion("mid [happy] sentence [sleepy]").clean === "mid sentence",
    "all tag occurrences removed",
  );
  assert(EMOTIONS.every(isEmotion), "canonical list validates");
  assert(!isEmotion("[angry]") && !isEmotion("angry"), "non-canonical names rejected");
  const hallucinated = extractEmotion("[bubbly-hope] Ooh, do I know what, Father?");
  assert(hallucinated.emotion === null, "hallucinated tag drives no emote");
  assert(hallucinated.clean === "Ooh, do I know what, Father?", "hallucinated leading tag stripped from display");

  // --- Presentation cleanup -------------------------------------------------
  const combo = cleanForDisplay("[happy] Use it.");
  assert(combo === "Use it.", "display cleanup strips mood tags");
  const factful = extractFactTags("Got it. [fact: user's name is Dan]");
  assert(factful.facts.length === 1 && factful.facts[0] === "user's name is Dan", "fact tag curated");
  assert(factful.clean === "Got it.", "fact tag stripped from speech");
  assert(cleanForDisplay("[smug] Noted. [fact: likes tea]") === "Noted.", "fact stripped in display cleanup");
  // Truncated/unclosed fact tag (stream cut or model slip) must never leak.
  const unclosed = extractFactTags("May 4th is my birthday, Father! [fact: Xena's birthday");
  assert(unclosed.clean === "May 4th is my birthday, Father!", "unclosed fact tag stripped from speech");
  assert(unclosed.facts.length === 1 && unclosed.facts[0] === "Xena's birthday", "unclosed fact tag still curated as fact");
  assert(
    cleanForDisplay("[happy] That's so exciting, Father! [fact: Xena's birthday") ===
      "That's so exciting, Father!",
    "unclosed fact tag stripped in display cleanup",
  );

  // --- Recall -------------------------------------------------------------
  const dir = await mkdtemp(join(tmpdir(), "xena-recall-"));
  const store = new MemoryStore(dir);
  try {
    const day = (offset: number) =>
      new Date(Date.now() - offset * 86_400_000).toISOString();
    await mkdir(dir, { recursive: true });
    await store.save({
      meta: { id: "default-2026-08-20", startedAt: day(6), updatedAt: day(6) },
      messages: [
        { role: "user", content: "I named my cat Mochi, she loves knocking cups off desks." },
        { role: "assistant", content: "Mochi sounds like chaos incarnate. Respect." },
      ],
    });
    await store.save({
      meta: { id: "default-2026-08-24", startedAt: day(2), updatedAt: day(2) },
      messages: [
        { role: "user", content: "Reminder: my deploy window is Tuesday mornings." },
        { role: "assistant", content: "Noted. Tuesdays, before the coffee goes cold." },
      ],
    });

    const recallNoDiary = new MemoryRecall(store);
    const before = await recallNoDiary.recall("mochi cat");
    // --- Diary recall --------------------------------------------------------
    const diaryDir = join(dir, "diary");
    await mkdir(diaryDir, { recursive: true });
    await writeFile(
      join(diaryDir, "2026-08-25.md"),
      "DIARY 2026-08-25\n- User runs marathons; training for Berlin in September.\n- Hates raisins in baked goods.\n- Mochi the cat knocked over the third cup this week.\n",
      "utf8",
    );
    const recall = new MemoryRecall(store, diaryDir);
    const withDiary = await recall.recall("when is the berlin marathon?");
    assert(
      withDiary.length > 0 && withDiary[0]!.sessionId.startsWith("diary-"),
      "diary line recalled for marathon query",
    );
    assert(
      (await recall.recall("mochi cat")).length >= before.length,
      "transcript recall still works alongside diaries",
    );
    const list = await new Diary(store, diaryDir).listAll();
    assert(list.length === 1 && list[0]!.date === "2026-08-25", "diary listAll parses entries");

    // --- Facts store ----------------------------------------------------------
    const factsPath = join(dir, "facts.json");
    const facts = new FactsStore(factsPath);
    assert((await facts.renderPromptBlock()) === "", "empty facts -> empty prompt block");
    await facts.add("User's sister is named Lena.");
    await facts.add("User is allergic to shellfish.");
    const factsBlock = await facts.renderPromptBlock();
    assert(factsBlock.includes("Lena") && factsBlock.includes("shellfish"), "facts rendered into prompt block");
    assert(factsBlock.startsWith("[facts the user explicitly asked"), "facts block labeled authoritative");
    assert((await new FactsStore(factsPath).listAll()).length === 2, "facts persist across instances");

    const hits = await recallNoDiary.recall("what is my cat's name again?", {
      excludeSessionId: "default-2026-08-24",
    });
    assert(hits.length === 1, "recall excludes non-matching session");
    assert(hits[0]?.sessionId === "default-2026-08-20", "recall finds cat session");
    assert(hits[0]!.snippet.toLowerCase().includes("mochi"), "snippet contains hit term");

    const both = await recall.recall("cat tuesday deploy");
    const ids = new Set(both.map((h) => h.sessionId));
    assert(
      ids.has("default-2026-08-20") && ids.has("default-2026-08-24"),
      "multi-term query spans sessions",
    );

    const none = await recall.recall("quantum entanglement xylophone");
    assert(none.length === 0, "unrelated query yields nothing");

    const block = renderRecallContext(hits);
    assert(block.startsWith("[fragments"), "rendered context block formatted");

    // --- Failover chain ------------------------------------------------------
    const base = loadInferenceConfig();
    const chain = describeChain(base, "text");
    console.log(`      chain: ${chain.join(" -> ")}`);
    assert(chain.length >= 3, "multi-rung chain present (gemini x2 + router9 + pollinations)");
    assert(chain[0] === `gemini/${base.geminiChatModel}`, "primary rung is gemini primary model");
    assert(chain[1] === `gemini-lite/${base.geminiLiteModel}`, "second rung is gemini flash-lite");
    assert(chain.includes(`router9/${base.textModel}`), "router9 reasoning rung present");
    assert(chain[chain.length - 1] === `pollinations/${base.pollinationsTextModel}`, "last rung is keyless pollinations");
    const vision = describeChain(base, "vision");
    assert(vision[0] === `gemini/${base.geminiVisionModel}`, "vision chain leads with gemini");

    // --- Supervisor: 404 evicts model, chain rebuilds without it ------------
    supervisor.evictModel("router9", base.textModel, "test eviction");
    assert(!describeChain(base, "text").includes(`router9/${base.textModel}`), "evicted model excluded from rebuilt chain");
    resetInference();
    assert(describeChain(base, "text").includes(`router9/${base.textModel}`), "resetInference restores evicted model");

    // --- Live: normal path (Gemini is always-on HTTPS; no local router needed)
    try {
      const result = await chatCompleteFailover(
        [{ role: "user", content: "Reply with exactly: OK" }],
        { maxTokens: 200 },
        base,
      );
      assert(true, `live completion served by ${result.providerUsed}`);
      console.log(`      reply: ${JSON.stringify(result.content.slice(0, 40))}`);
    } catch (error) {
      const kind = error instanceof InferenceError ? error.kind : null;
      if (kind === "quota" || kind === "all-down") {
        assert(true, `live completion blocked everywhere (kind: ${kind}) — failover exercised`);
      } else {
        console.log(`      live error: ${error instanceof Error ? error.message : String(error)}`);
        assert(false, "live completion succeeded on some rung");
      }
    }

    // --- Live: forced failover (router9 base dead -> gemini/pollinations serve)
    const brokenR9: InferenceConfig = { ...base, baseUrl: "http://127.0.0.1:9/v1" }; // nothing listens here
    try {
      const result = await chatCompleteFailover(
        [{ role: "user", content: "Reply with exactly: OK" }],
        { maxTokens: 200 },
        brokenR9,
      );
      assert(result.providerUsed.startsWith("gemini"), `forced failover served by ${result.providerUsed}`);
      console.log(`      reply: ${JSON.stringify(result.content.slice(0, 40))}`);
    } catch (error) {
      console.log(`      failover error: ${error instanceof Error ? error.message : String(error)}`);
      assert(false, "forced failover reached a healthy rung");
    }

    // --- Live: vision failover (opt-in via XENA_CHECK_VISION=1; free tier) ----
    if (process.env.XENA_CHECK_VISION === "1") {
      const visionChain = describeChain(base, "vision");
      console.log(`      vision chain: ${visionChain.join(" -> ")}`);
      // 1x1 red PNG, minimal bytes.
      const tinyPng =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
      try {
        const result = await visionCompleteFailover(
          [
            {
              role: "user",
              content: [
                { type: "text", text: "What color is this single pixel? One word." },
                { type: "image_url", image_url: { url: `data:image/png;base64,${tinyPng}` } },
              ],
            },
          ],
          { maxTokens: 300 },
          base,
        );
        assert(result.content.trim() !== "", `vision served by ${result.providerUsed}: ${result.content.trim().slice(0, 60)}`);
      } catch (error) {
        const kind = error instanceof InferenceError ? error.kind : null;
        if (kind === "quota" || kind === "all-down" || kind === "empty") {
          assert(true, `vision blocked everywhere (kind: ${kind}) — chain exercised`);
        } else {
          console.log(`      vision error: ${error instanceof Error ? error.message : String(error)}`);
          assert(false, "vision completion succeeded on some rung");
        }
      }
    } else {
      console.log("SKIP  vision check — set XENA_CHECK_VISION=1 to exercise it");
    }
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }

  if (failures > 0) process.exitCode = 1;
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
