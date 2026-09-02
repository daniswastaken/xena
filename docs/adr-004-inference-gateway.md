# ADR-004: Inference gateway — Gemini-primary chain with self-recovery

Date: 2026-08-29
Status: Accepted
Supersedes: ADR-001's 9Router-primary chain ordering (failover concept itself is kept and generalized)

## Context

9Router in practice was unreliable — 404s, 502s, empty bodies — and it
required a manual `9router` launch before Xena could think at all. The
user directive: rework the entire inference backend. Requirements:

1. 100% free
2. Vision capable
3. Self-recovery on failure (restart the inference layer, never Xena)
4. Anything except OmniRoute
5. One unified ecosystem: launch Xena → inference is up

Also observed: raw provider errors ("9Router 404") leaking into Xena's
speech bubble read as uncanny out-of-character noise.

## Decision

New package `packages/inference-gateway` owns ALL inference orchestration.
`router9-client` demotes to pure 9Router wire transport (defensive body
parsing, shared types) and is no longer imported by apps directly.

### Chain (text)

> **Amended by [ADR-005](adr-005-packaged-distribution.md)** (2026-08-31): the Gemini
> rungs now use the pointer aliases `gemini-flash-latest` / `gemini-flash-lite-latest`;
> `gemini-2.5-flash` is deprecated upstream (404 for new keys). The table below is
> kept as originally decided.

| Rung | Provider | Role |
|---|---|---|
| 1 | `gemini-2.5-flash` | primary text + vision + STT (one free AI Studio key) |
| 2 | `gemini-2.5-flash-lite` | same key, higher free RPD headroom |
| 3 | 9Router `oc/big-pickle` + `oc/*` | reasoning rung; child spawned by Xena |
| 4 | Pollinations `openai-fast` | keyless final net — whole stack never goes mute |

Vision: Gemini flash → flash-lite → 9Router `oc/x-preview-f-free` →
`oc/mimo-v2.5-free`. STT: Gemini inline audio → 9Router gpt-audio.

"Plenty of use without entering provider keys one by one": Gemini is one
key total, Pollinations zero, 9Router the pre-existing local key.

### Self-recovery layers

1. Request level (ADR-001, kept): rung advance pre-first-token; a
   mid-stream failure leaves the partial reply standing — no restart,
   no error bubble.
2. Model level: 404/empty evicts the model for 10 min; chains are
   rebuilt per request from supervisor state.
3. Provider level: 3 consecutive failures take a provider offline for
   5 min; one success restores it.
4. Process level: `NineRouterChild` spawns `9router --port 20129
   --no-browser --skip-update` at app boot (user profile flags), probes
   `/v1/models` every 60s, respawns with 5s→30s backoff (5 attempts),
   adopts an already-serving instance instead of double-spawning, and
   never kills a instance it didn't spawn. Windows tree-kill via
   `taskkill /T /F` prevents orphaned node processes.
5. `resetInference()`: tray "Restart inference" + auto-invoked on
   total-chain collapse. Clears penalties/evictions, re-reads `.env`
   into the same config object (long-lived holders see fresh values),
   respawns the child. Xena itself never restarts.

### Error surface boundary

Adapters throw raw; the chain classifies whole-chain failure into
`InferenceError` kinds: `aborted | all-down | quota | timeout | empty |
stt | unknown`. Main maps kinds to persona lines
(`apps/stage-xena/src/main/ui/error-lines.ts`) BEFORE IPC. The bubble
renders only pre-mapped persona text (mood tag drives the face); the
bar gets short plain lines; OS toasts get plain English with an
auto-recovery note; the tray is the single surface where technical
diagnostics are allowed; raw detail goes to console.error only.
Aborts are fully silent. With Pollinations as the last rung, a
bubble-visible failure requires multiple independent providers down
simultaneously — a rare event by construction.

## Alternatives rejected

- OmniRoute (port 20128): user directive excluded it.
- Local model inference: 2-core CPU, no CUDA — permanent constraint.
- Evolve router9-client in place: the name would lie about its job
  forever; orchestration and transport deserve separate modules.
- Gemini-only: single-provider risk on quota-heavy days; the 9Router
  reasoning rung and the keyless Pollinations net cost nothing to keep.
- Remove 9Router entirely: loses reasoning (`reasoning_content`) and
  the oc/* depth; child supervision makes it zero-maintenance.

## Consequences

- Renderer never calls fetch directly (kept); apps import
  `@xena/inference-gateway`, gateway imports `router9-client`.
- New `.env` keys: `XENA_NINEROUTER_ENABLED` (default on),
  `XENA_GEMINI_LITE_MODEL`, `XENA_POLLINATIONS_TEXT_MODEL`,
  `XENA_POLLINATIONS_VISION_MODEL`.
- The user's manual `9router` habit still works: adopted, not fought.
- Free-tier etiquette: health probes hit only the local 9Router;
  Gemini health is inferred from request outcomes, never probed.
- Footprint: pure-Gemini path adds zero processes. The child adds its
  own ~80-120 MB only while enabled; `XENA_NINEROUTER_ENABLED=0` runs
  the whole stack without it.
