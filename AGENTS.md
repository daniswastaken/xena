# Project Xena — Agent Context Handoff

Read this file fully before doing anything. The codebase is past the greenfield kickoff and into the polish/maintenance phase. Treat this document as the **current** state of things; do not trust anything in `CHANGELOG.md` for "what's where" — that file is a chronological history, this one is the map.

## What Xena Is

A Neuro-sama-inspired AI desktop companion scoped to a **bottom-right corner Live2D overlay** use case:

- A transparent, always-on-top, borderless Electron window pinned to the bottom-right, hosting the Live2D avatar (Mao, the only model — see `apps/stage-xena/assets/live2d/mao/`)
- A separate translucent **summon bar** window (bottom-left by default, Spotlight-style) for input + inline streaming reply
- Replies render in a **mood-tinted speech bubble anchored to Mao's head** inside the avatar window
- The avatar *talks* — mouth flap synced to the TTS audio duration, per-mood expression ALTERNATES, gaze tracking on the cursor
- The companion *sees* on command (`/look <question>`), *remembers* (SQLite transcripts + JSON diary + facts store + keyword+recency recall), and occasionally *initiates* (proactive idle comments, ambient screen glances)
- Voice input via push-to-talk (`Ctrl+Alt+V`) — mic → WAV → free `gpt-audio-mini` transcription → auto-sent as chat
- All inference is **remote** through 9Router (port `20129`); 9Router is the only AI gateway Xena uses, with a free `oc/*` fallback chain for both text and vision

**Not** a goal (scope discipline): full Live2D authoring pipeline, real-time stream interaction, singing, multi-channel chatbots. The corner-overlay form factor and the "weak-laptop-no-GPU" constraint are permanent.

## Target Machine (hard constraints)

| Spec | Value |
|---|---|
| CPU | AMD Athlon Gold 3150U — 2 cores / 4 threads |
| RAM | 9.9 GB total (~3.3 GB free typically) |
| GPU | AMD Radeon integrated (Vega 3 class), shared 2 GB, **no CUDA**, weak WebGPU |
| OS | Windows 11, PowerShell 5.1 default shell |

Implications:
- All LLM / vision / STT inference is remote. **No** local model inference.
- Avatar rendering stays trivial: `pixi.js` + `pixi-live2d-display` (Cubism 4) for Mao. No three.js, no WebGL pipeline of our own to maintain.
- Steady-state footprint target: **≤300 MB** private across Electron processes. Current measured: ~190–230 MB / 5 procs.

## Infrastructure Already In Place (do not re-create)

### 9Router — primary AI gateway (already installed & configured)
- npm global package `9router` v0.5.55 on Node 26
- **Always runs on port 20129** (20128 is reserved for OmniRoute, another router the user keeps)
- OpenAI-compatible endpoint: `http://localhost:20129/v1`
- API key: `sk-2143c08449a11de2-r8roza-89b030fa`
- ~700 models exposed; the free tier that matters in production:
  - `oc/big-pickle` — primary text/reasoning (exposes `reasoning_content`)
  - `oc/x-preview-f-free` — primary vision (upstream `mimo-v2.5-free`)
  - `oc/laguna-s-2.1-free` — text + vision fallback
  - `oc/mimo-v2.5-free` — text + vision fallback
  - `tokenrouter/openai/gpt-audio-mini` — STT for push-to-talk
- List all models:
  ```powershell
  Invoke-RestMethod -Uri "http://localhost:20129/v1/models" -Headers @{ Authorization = "Bearer sk-2143c08449a11de2-r8roza-89b030fa" }
  ```
- Smoke test:
  ```powershell
  $body = '{"model":"oc/big-pickle","messages":[{"role":"user","content":"Say OK"}],"max_tokens":200}'
  Invoke-RestMethod -Uri "http://localhost:20129/v1/chat/completions" -Method Post -Body $body -ContentType "application/json" -Headers @{ Authorization = "Bearer sk-2143c08449a11de2-r8roza-89b030fa" }
  ```
- Dashboard: `http://localhost:20129/dashboard` (password `123456`) — only if provider changes are needed
- Server is started **manually** by the user (profile function injects `--port 20129 --no-browser --skip-update`). If `/v1/models` fails, tell the user to run `9router` — do not try to start it yourself silently.

### OmniRoute — secondary router (exists, do not touch)
- Port 20128, own key store. Xena does not use it.

### opencode integration
- `~/.config/opencode/opencode.json` already has `router9` provider pointing at 9Router. Irrelevant to Xena runtime but explains the setup.

## Source Layout — current (post-v2.0)

The monorepo discipline is from [Project AIRI](https://github.com/moeru-ai/airi) — feature-domain folders, one responsibility each, **apps import packages, packages never import apps**.

```
project-xena/
├── apps/
│   └── stage-xena/                       # the Electron desktop app
│       ├── src/
│       │   ├── main/                     # Electron main process
│       │   │   ├── index.ts
│       │   │   ├── window/               # overlay window create/pin/click-through
│       │   │   ├── tray/                 # tray icon, quick actions, settings surface
│       │   │   ├── capture/              # desktopCapturer + vision chain wiring
│       │   │   ├── ipc/                  # typed IPC handlers main<->renderer
│       │   │   ├── input/                # global hotkeys, cursor-shake, push-to-talk
│       │   │   ├── tts/                  # edge-tts glue, audio duration tracking
│       │   │   ├── voice-input/          # mic capture, WAV b64, gpt-audio STT
│       │   │   ├── pointer/              # AI Pointer window + glide + guided tasks
│       │   │   ├── proactive/            # idle comments, ambient glances, scheduler
│       │   │   ├── settings/             # persisted preferences, tray sync
│       │   │   └── ambient/              # quiet-hours + cadence + diary hooks
│       │   ├── preload/                  # contextBridge typed API surface
│       │   └── renderer/                 # what the user sees
│       │       ├── index.html
│       │       ├── components/           # dumb presentational pieces
│       │       ├── composables/          # reactive hooks (useChatStream, useGaze, useEmotion...)
│       │       ├── modules/
│       │       │   ├── avatar/           # Live2D stage (Mao), gaze, lip-sync, blink
│       │       │   ├── bar/              # summon bar window (input + inline answer)
│       │       │   ├── chat/             # message list, streaming render
│       │       │   └── settings/         # provider/model pickers, hotkeys
│       │       ├── assets/               # in-renderer static assets
│       │       └── styles/
│       └── assets/
│           ├── app-icon.{ico,png}
│           ├── xena-cursor.svg
│           ├── fonts/nunito-latin.woff2
│           ├── live2d/mao/               # the only Live2D model
│           │   ├── Mao.model3.json
│           │   ├── Mao.moc3
│           │   ├── Mao.cdi3.json
│           │   ├── Mao.physics3.json
│           │   ├── Mao.pose3.json
│           │   ├── Mao.2048/             # texture directory
│           │   ├── expressions/
│           │   ├── motions/
│           │   └── PROVENANCE.txt        # Live2D Free Material License
│           └── vendor/live2dcubismcore.min.js
├── packages/
│   ├── router9-client/                   # ALL 9Router API code lives here, nowhere else
│   │   ├── src/chat/                     # completions, streaming, failover
│   │   ├── src/vision/                   # image messages, screenshot encode, failover
│   │   ├── src/models/                   # model registry, capability probes
│   │   └── src/types.ts                  # shared API types
│   ├── xena-core/                        # persona, memory, conversation state
│   │   ├── src/persona/                  # system prompt, emotion protocol
│   │   ├── src/memory/                   # SQLite store, recall, facts, diary
│   │   └── src/session/                  # conversation orchestration
│   └── tts/                              # free Edge read-aloud (MsEdgeTTS)
│       ├── src/index.ts                  # JP Nanami lock, prosody, speak()
│       └── scripts/                      # voice probes
├── docs/                                 # ADRs, vision-model probe results, screenshots
├── scripts/                              # CDP drivers, offline check suite
├── data/                                 # runtime: transcripts.db, facts.json, diary/
├── .env
├── AGENTS.md
├── CHANGELOG.md
├── README.md
└── pnpm-workspace.yaml
```

Rules:
- `pnpm` workspaces (`pnpm-workspace.yaml`) from day one
- `apps/*` may import `packages/*`; **packages must never import apps**
- Renderer never calls `fetch` directly — always through `router9-client` over IPC
- One responsibility per module; if a file exceeds ~200 lines and mixes concerns, split it
- TypeScript everywhere, strict mode, no `any` unless justified in a comment
- Named exports only (except entry points); PascalCase components, camelCase functions, kebab-case non-component filenames
- No commented-out dead code, no TODO without an owner line — delete or do it
- **Expand freely** under the same grain — new submodules, new packages (`packages/memory-vector/`, `packages/translate/`, ...), new app entry points are allowed. **Never** demote by flattening or merging away the baseline structure above

## Architecture — Stack & Runtime Behavior

Baseline: **Electron + 9Router API** + **pixi.js / pixi-live2d-display** (Mao) + **MsEdgeTTS** (free Edge read-aloud, no key) + **node:sqlite** (Node 24 in Electron 44, zero native deps) for transcripts.

Two Electron windows:
1. **Avatar window** — bottom-right, transparent, always-on-top, click-through by default, hosts the Live2D stage and the speech-bubble answer surface
2. **Summon bar window** — translucent panel, hotkey or cursor-shake triggered, hosts the input + inline streaming answer; auto-fades after a quiet beat, Esc to dismiss

A third window, **AI Pointer**, appears on demand during guided tasks and glides across the screen under vision control.

Decision authority (the kinds of choices that have already been made and shouldn't be re-litigated):
- Avatar: Mao only; expressions ALTERNATES per mood (random pick), TapBody motions on expressive moods, neutral reset (`exp_01`) on mood decay
- Voice: JP `Nanami` only (sole voice, picker was removed); always the "happy" read regardless of face mood; 96 kbit endpoint max
- Mood tags: model leads with one of `[happy] [smug] [surprised] [annoyed] [sleepy]`, parsed in main, stripped from speech/UI, drives face + drives TTS prosody
- Streaming: never restart after the first token, even across a failover hop
- Failover: 9Router primary → free `oc/*` fallbacks; circuit breaker opens for 5 min after a quota failure on a fallback
- Reasoning: `oc/big-pickle` exposes `reasoning_content`; show animated thinking dots in the bubble while it streams

If a change implies a stack decision, follow the Source Layout expansion rules and explain the choice in a commit message or a short ADR under `docs/`.

## Art Asset Spec

The avatar is the **Live2D Mao model** under `apps/stage-xena/assets/live2d/mao/` (Mao.model3.json + textures, motions, expressions, physics, pose). It is the one and only model — other Live2D models were removed by user directive. Visuals are tuned via `Mao.moc3` parameters and the expression/motion maps in `apps/stage-xena/src/renderer/modules/avatar/live2d/stage.ts`.

When the user supplies a different/upgraded Live2D model it replaces Mao one-to-one under `assets/live2d/<name>/`. The renderer should pick the model directory by config, not by name.

## Current Status

**v0.1 → v2.0 all shipped (2026-08-25 → 2026-08-27).** Phase = polish + maintenance + selective growth. See `CHANGELOG.md` for the chronological feature log; this section is just the headline.

| Capability | Status | Notes |
|---|---|---|
| Bottom-right corner overlay | ✓ | transparent, always-on-top, click-through, single-instance lock |
| Live2D avatar (Mao) | ✓ | mouth flap, gaze, blink, expression ALTERNATES, TapBody motions, 30 fps cap |
| Speech-bubble answer surface | ✓ | mood-tinted, anchored to head, thinking dots, hover-scroll/select/copy |
| Summon bar (input) | ✓ | Ctrl+Alt+X, cursor-shake, Esc dismiss, input history (↑/↓, last 20), message queue |
| Streaming text + token-flap | ✓ | never restart after first token, even across failover |
| Provider failover (text + vision) | ✓ | 9Router primary, `oc/*` chain, 5-min circuit breaker |
| Vision on command (`/look`) | ✓ | desktopCapturer → JPEG → `oc/x-preview-f-free` → correct on-screen description |
| Ambient screen glances | ✓ | opt-in, default OFF, 30 min cadence, quiet-hours gated |
| Guided tasks | ✓ | natural-language "how do I…?" → vision-driven multi-step tutor + AI Pointer |
| Edge TTS | ✓ | JP Nanami, mouth flap synced to audio duration, ON/OFF in tray |
| Voice input (push-to-talk) | ✓ | `Ctrl+Alt+V`, mic → WAV → `gpt-audio-mini` → auto-submit |
| Memory | ✓ | SQLite transcripts, JSON diary, facts store, keyword+recency recall |
| Proactive idle comments | ✓ | 45 min idle, cooldown, quiet-hours gate, tray toggle |
| Single-instance lock | ✓ | |
| Start with Windows | ✓ | opt-in |
| Real Live2D art from user | ✗ | next: one-to-one swap under `assets/live2d/<name>/` |
| Real-time streaming TTS | ✗ | planned (replaces Edge read-aloud) |
| Multi-channel integrations | ✗ | not scoped (Discord/Telegram/stream bot — out of scope) |

Memory line:
```text
~190–230 MB private across 5 Electron procs (target ≤300 MB)
```

## ADRs (decisions worth keeping)

- `docs/adr-001-failover-recall.md` — 9Router primary + free `oc/*` failover chain; keyword+recency recall
- `docs/adr-002-live2d-pointer.md` — Mao as sole Live2D; AI Pointer window for guided tasks
- `docs/adr-003-speech-bubble.md` — bubble replaces the chat window; mood-tinted, anchored to head

If you make a new architectural decision (new package, new window, new IPC contract, new model selection strategy), drop a one-page ADR in `docs/adr-NNN-short-slug.md` and reference it from the table above.

## Working Rules for the Agent

1. **Read this file and `CHANGELOG.md` first.** Skim the most recent 5 commits with `git log --oneline -5`. Then look at the file you intend to touch before you touch it.
2. Commit early and often; never leave the repo in broken state overnight. One focused commit per logical change. If a change spans layers (prompt + IPC + renderer), split it.
3. **Code organization is non-negotiable.** Every new file goes in its proper module per the Source Layout section. If a needed folder doesn't exist, create it properly. Flattening, merging, or renaming the baseline is a failed review.
4. Free-tier etiquette: cache probe results, don't spam test requests, keep `max_tokens` small during dev tests, respect the failover circuit breaker (don't hammer a 5-min-cooled fallback).
5. The user's laptop is weak: after changes, sanity-check the app memory footprint stays under ~300 MB.
6. PowerShell 5.1 syntax only in shell commands (no `&&`; use `;` or `if ($?) {}`).
7. Never hardcode the API key outside config — read from `.env` or a config file. The seed key in `.env` is fine; do **not** put it in code.
8. If 9Router is down, say so plainly and ask the user to start it. Do not install alternative routers.
9. Never delete or replace the Mao model. New Live2D models go in a sibling directory; the renderer picks by config.
10. When in doubt about an architectural decision, write a one-page ADR before writing the code.

## Quick Commands

```powershell
pnpm install
pnpm build         # bundle the app
pnpm start         # run the Electron overlay
pnpm typecheck     # all packages, strict TS
node scripts/run-check.mjs scripts/check-recall.ts   # offline core checks
```

Test 9Router reachability:

```powershell
Invoke-RestMethod -Uri "http://localhost:20129/v1/models" -Headers @{ Authorization = "Bearer sk-2143c08449a11de2-r8roza-89b030fa" }
```
