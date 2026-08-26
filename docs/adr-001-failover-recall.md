# ADR-001: Provider Failover + Local Memory Recall

Date: 2026-08-26
Status: accepted

## Context

Xena depends on free-tier inference (9Router primary). Two failure modes observed:
quota exhaustion (429) and upstream load producing empty/garbage 200 bodies.
Separately, sessions rotate daily, so yesterday's facts were unreachable.

## Decisions

1. **Provider chain** (`packages/router9-client/src/chat/failover.ts`)
   - Primary: 9Router (`ROUTER9_*`). Fallback: OpenRouter `stealth/ox-alpha`
     (`OPENROUTER_API_KEY` in `.env`; absent key => single-provider chain).
   - Failover triggers: 401/402/403/404/408/429/5xx, network refusal,
     HTTP-200-with-empty-body (upstream load).
   - Streams never restart after the first emitted token (no duplicated text).
2. **Memory recall** (`packages/xena-core/src/memory/recall.ts`)
   - Keyword-overlap scoring + recency bonus over stored transcripts.
     No embeddings — zero extra inference on the weak target machine.
   - Top hits injected into the system prompt as clearly-labeled fragments;
     recall failure degrades silently to plain prompt.
3. **No automatic retry loops** — one walk of the provider chain per request.
   Free-tier etiquette beats availability micro-optimization.

## Consequences

- Chat and proactive comments survive primary-quota outages.
- Xena references past conversations without claiming certain memory.
- `scripts/check-recall.ts` (via `scripts/run-check.mjs`) verifies both offline;
  live sections tolerate free-tier pressure by design.
