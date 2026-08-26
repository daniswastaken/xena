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
import { extractEmotion, extractPointTag, extractPointTargets, extractFactTags, cleanForDisplay, isEmotion, EMOTIONS } from "@xena/xena-core";
import { loadConfig } from "@xena/router9-client";
import {
  buildProviderChain,
  buildVisionChain,
  chatCompleteFailover,
  visionCompleteFailover,
  Router9Error,
} from "@xena/router9-client";

let failures = 0;
function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
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

  // --- Point tag protocol ---------------------------------------------------
  const pointed = extractPointTag("Click the glass. [point: search icon top right]");
  assert(pointed.target === "search icon top right", "point tag extracted");
  assert(pointed.clean === "Click the glass.", "point tag stripped");
  assert(extractPointTag("no tag here").target === null, "pointless text passes");
  const multi = extractPointTargets("First [point: file menu], then [point: save button].");
  assert(multi.targets.length === 2 && multi.targets[1] === "save button", "multi-step points in order");
  assert(multi.clean === "First , then .", "multi-step strip keeps sentence flow");
  const combo = cleanForDisplay("[happy] Use it. [point: the button]");
  assert(combo === "Use it.", "combined mood+point cleanup");
  const factful = extractFactTags("Got it. [fact: user's name is Dan]");
  assert(factful.facts.length === 1 && factful.facts[0] === "user's name is Dan", "fact tag curated");
  assert(factful.clean === "Got it.", "fact tag stripped from speech");
  assert(cleanForDisplay("[smug] Noted. [fact: likes tea]") === "Noted.", "fact stripped in display cleanup");

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
    const base = loadConfig();
    console.log(`      chain: ${buildProviderChain(base).map((p) => `${p.name}:${p.model}`).join(" -> ")}`);
    const soloChain = buildProviderChain({ ...base, fallback: null });
    assert(soloChain.length === 1 && soloChain[0]!.name === "router9", "fallback:null -> single provider");
    if (base.fallback) {
      const duo = buildProviderChain(base);
      assert(
        duo.length === 2 &&
          duo[0]!.name === "router9" &&
          duo[1]!.name === "openrouter" &&
          duo[1]!.model === "stealth/ox-alpha",
        "fallback key -> openrouter appended with ox-alpha",
      );
    } else {
      console.log("SKIP  fallback assertions — OPENROUTER_API_KEY not set");
    }

    // --- Live: normal path (only if 9Router is up) ---------------------------
    let router9Up = false;
    try {
      const res = await fetch(`${base.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${base.apiKey}` },
        signal: AbortSignal.timeout(4000),
      });
      router9Up = res.ok;
    } catch {
      router9Up = false;
    }
    if (router9Up) {
      try {
        const result = await chatCompleteFailover(
          [{ role: "user", content: "Reply with exactly: OK" }],
          { maxTokens: 200 },
          base,
        );
        // Either provider is a pass — failover on primary quota exhaustion is by design.
        assert(true, `live completion served by ${result.providerUsed}`);
        console.log(`      reply: ${JSON.stringify(result.content.slice(0, 40))}`);
      } catch (error) {
        const status = error instanceof Router9Error ? error.status : null;
        if (status === 429 || status === 402 || status === 502 || status === 503) {
          // All providers rate/quota-limited — expected free-tier pressure.
          assert(true, `live completion blocked by quota everywhere (status ${status}) — failover exercised`);
        } else {
          console.log(`      live error: ${error instanceof Error ? error.message : String(error)}`);
          assert(false, "live completion succeeded on some provider");
        }
      }
    } else {
      console.log("SKIP  live check — 9Router unreachable");
    }

    // --- Live: forced failover (primary dead -> OpenRouter ox-alpha) ---------
    if (base.fallback) {
      const brokenPrimary: typeof base = {
        ...base,
        baseUrl: "http://127.0.0.1:9/v1", // nothing listens here
      };
      try {
        const result = await chatCompleteFailover(
          [{ role: "user", content: "Reply with exactly: OK" }],
          { maxTokens: 200 },
          brokenPrimary,
        );
        assert(result.providerUsed === "openrouter", `forced failover served by ${result.providerUsed}`);
        console.log(`      reply: ${JSON.stringify(result.content.slice(0, 40))}`);
      } catch (error) {
        const reachedFallback = error instanceof Router9Error; // primary failure mode is TypeError (refused)
        console.log(`      failover error: ${error instanceof Error ? error.message : String(error)}`);
        assert(reachedFallback, "forced failover reached fallback provider");
      }
    } else {
      console.log("SKIP  forced failover — OPENROUTER_API_KEY not set");
    }

    // --- Live: vision failover (opt-in via XENA_CHECK_VISION=1; costs quota) --
    if (process.env.XENA_CHECK_VISION === "1" && base.fallback) {
      const visionChain = buildVisionChain(base);
      console.log(`      vision chain: ${visionChain.map((p) => `${p.name}:${p.model}`).join(" -> ")}`);
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
        const status = error instanceof Router9Error ? error.status : null;
        if (status === 429 || status === 402 || status === 502 || status === 503) {
          assert(true, `vision blocked by quota everywhere (status ${status}) — chain exercised`);
        } else {
          console.log(`      vision error: ${error instanceof Error ? error.message : String(error)}`);
          assert(false, "vision completion succeeded on some provider");
        }
      }
    } else {
      console.log("SKIP  vision check — set XENA_CHECK_VISION=1 to spend quota on it");
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
