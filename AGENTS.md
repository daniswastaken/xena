# Project Xena — Agent Context Handoff

You are the agent working on Project Xena. Read this file fully before doing anything.

## What Xena Is

A Neuro-sama-inspired AI desktop companion, scoped to a **bottom-right corner PNGtuber** use case:

- A transparent, always-on-top, borderless window pinned to the bottom-right of the screen
- A 2D character (PNG sprite set) that "talks" with mouth flaps while responding
- Chat with the user via text input and/or hotkey
- Screen awareness: on command, capture the screen and answer questions about it
- Long-term direction: grow toward AIRI/Neuro-sama capability (voice, proactive behavior, memory, integrations) — but the corner-overlay form factor is permanent

**Not** a goal: full Live2D/VRM rigging, real-time stream interaction, singing. Keep scope disciplined.

## Target Machine (hard constraints)

| Spec | Value |
|---|---|
| CPU | AMD Athlon Gold 3150U — 2 cores / 4 threads |
| RAM | 9.9 GB total (~3.3 GB free typically) |
| GPU | AMD Radeon integrated (Vega 3 class), shared 2 GB, **no CUDA**, weak WebGPU |
| OS | Windows 11, PowerShell 5.1 default shell |

Implications:
- All LLM/vision inference MUST be remote (API calls). No local model inference.
- Avatar rendering must be trivially cheap: plain DOM `<img>` swaps. No WebGL/three.js/Live2D.
- Keep Electron's memory footprint in mind; avoid spawning extra Chromium contexts.

## Infrastructure Already In Place (do not re-create)

### 9Router — primary AI gateway (already installed & configured)
- npm global package `9router` v0.5.55 on Node 26
- **Always runs on port 20129** (20128 is reserved for OmniRoute, another router the user keeps)
- OpenAI-compatible endpoint: `http://localhost:20129/v1`
- API key: `sk-2143c08449a11de2-r8roza-89b030fa`
- ~700 models exposed; the free tier that matters:
  - `oc/big-pickle` — text/reasoning, verified working (reasoning model, has `reasoning_content`)
  - Other `oc/*` models: `oc/deepseek-v4-flash-free`, `oc/x-preview-f-free`, `oc/muse-spark-1.2-contributor-free`, `oc/mimo-v2.5-free`, `oc/hy3-free`, `oc/nemotron-3-ultra-free`, `oc/nemotron-3.5-lightning-free`, `oc/laguna-s-2.1-free`
- List all models:
  ```powershell
  Invoke-RestMethod -Uri "http://localhost:20129/v1/models" -Headers @{ Authorization = "Bearer sk-2143c08449a11de2-r8roza-89b030fa" }
  ```
- Smoke test:
  ```powershell
  $body = '{"model":"oc/big-pickle","messages":[{"role":"user","content":"Say OK"}],"max_tokens":200}'
  Invoke-RestMethod -Uri "http://localhost:20129/v1/chat/completions" -Method Post -Body $body -ContentType "application/json" -Headers @{ Authorization = "Bearer sk-2143c08449a11de2-r8roza-89b030fa" }
  ```
- Dashboard: `http://localhost:20129/dashboard` (password `123456`) — only if provider changes needed
- Server is started MANUALLY by the user (profile function injects `--port 20129 --no-browser --skip-update`). If `/v1/models` fails, tell the user to run `9router` — do not try to start it yourself silently.

### OmniRoute — secondary router (exists, do not touch)
- Port 20128, own key store. Xena does not use it for now.

### opencode integration
- `~/.config/opencode/opencode.json` already has `router9` provider pointing at 9Router. Irrelevant to Xena runtime but explains the setup.

## Source Layout — MANDATORY (AIRI-grade organization)

The user explicitly mandates clean, categorized architecture — inspired by moeru-ai/airi's monorepo discipline. **Flat "3 folders and all the JS in one place" structures are rejected on sight.**

**This layout is the mandatory minimum scaffold: create ALL of it (empty dirs with `.gitkeep` where needed) before writing feature code.** It is a floor, not a ceiling — the agent is expected and encouraged to expand further and beyond as features grow, under these rules:

- **Expand freely**: new submodules, new packages (`packages/tts/`, `packages/memory-vector/`, ...), new app entry points — all allowed and welcomed
- **Expansion must follow the same grain**: feature-domain folders, one responsibility each — never a `misc/` or `utils/` dumping ground
- **Never demote**: no flattening, merging away, or renaming of the baseline structure below

Baseline tree:

```
project-xena/
├── apps/
│   └── stage-xena/              # the Electron desktop app
│       ├── src/
│       │   ├── main/            # Electron main process
│       │   │   ├── index.ts
│       │   │   ├── window/      # overlay window create/pin/click-through logic
│       │   │   ├── tray/        # tray icon, quick actions
│       │   │   ├── capture/     # screen capture pipeline (desktopCapturer)
│       │   │   └── ipc/         # typed IPC handlers main<->renderer
│       │   ├── preload/         # contextBridge exposure, typed API surface
│       │   └── renderer/        # what the user sees
│       │       ├── index.html
│       │       ├── components/  # dumb presentational pieces
│       │       ├── modules/
│       │       │   ├── avatar/      # sprite stage, state machine (idle/talk/blink)
│       │       │   ├── chat/        # chat box, message list, streaming render
│       │       │   └── settings/    # provider/model pickers, hotkeys
│       │       ├── composables/ # reactive hooks (useMouthFlap, useChatStream...)
│       │       └── styles/
│       └── assets/              # sprites live here (assets/idle.png ...)
├── packages/
│   ├── router9-client/          # ALL 9Router API code lives here, nowhere else
│   │   ├── src/chat/            # completions, streaming
│   │   ├── src/vision/          # image messages, screenshot encode
│   │   ├── src/models/          # model registry, capability probe results
│   │   └── src/types.ts         # shared API types
│   └── xena-core/               # personality, memory, conversation state
│       ├── src/persona/         # system prompt(s), character definition
│       ├── src/memory/          # transcript persistence (JSON → SQLite later)
│       └── src/session/         # conversation orchestration
├── docs/                        # vision-model-probe results, ADRs, notes
├── scripts/                     # dev/test helper scripts
├── .env
└── AGENTS.md
```

Rules:
- pnpm workspaces (`pnpm-workspace.yaml`) from day one so packages are real, not aspirational folders
- `apps/*` may import `packages/*`; **packages must never import apps**
- Renderer never calls fetch directly — always through `router9-client` over IPC
- One responsibility per module; if a file exceeds ~200 lines and mixes concerns, split it
- TypeScript everywhere, strict mode, no `any` unless justified in a comment
- Named exports only (except entry points); PascalCase components, camelCase functions, kebab-case non-component filenames
- No commented-out dead code, no TODO without an owner line — delete or do it

## Decided Architecture — Stack & Runtime Behavior

Baseline: **Electron + 9Router API**, with the renderer being plain DOM initially.

**Framework choice is deliberately unconstrained** — the agent is free to adopt whatever improves quality (Vue, React, Solid, Svelte, Vite, state management, animation libs, testing frameworks, etc.). The only judging criteria are correctness, maintainability, performance on the weak target machine, and fit with the mandatory Source Layout. If a framework adoption implies restructuring, follow the expansion rules in the Source Layout section and explain the choice in the commit message or a short ADR under `docs/`.

1. **Overlay window**: Electron `BrowserWindow` — transparent, frameless, always-on-top, skip-taskbar, positioned bottom-right. Click-through regions where there is no UI.
2. **Avatar**: two stacked `<img>` layers — `idle.png` / `talk.png`, swapped on a timer while a response streams (token-stream mouth flap = zero audio analysis). Optional later: blink sprite, mic-driven flap via Web Audio AnalyserNode, TTS-driven flap via edge-tts.
3. **Chat**: system prompt defines personality ("Xena"). User input from a small chat box that slides into the overlay on demand. Stream completions from `oc/big-pickle`, render tokens as they arrive, flap while streaming.
4. **Screen vision**: `desktopCapturer` → downscaled JPEG screenshot → base64 data URL → OpenAI-format image message (`image_url`) → vision-capable model via 9Router. Capture ONLY on explicit user command or explicit trigger — never continuous (free-tier rate limits + token burn).
5. **Memory**: start with a JSON file transcript + system prompt. Upgrade path: SQLite.

## CRITICAL Unverified Item — Vision Model Probe (do this FIRST)

It is NOT yet confirmed which 9Router models accept image inputs. Before building the vision feature, probe candidates empirically with a tiny base64 test image:

Candidates to try (in order): `tokenrouter/google/gemini-3-flash-preview`, `bzl/gemini-3-flash-preview`, `gc/gemini-2.5-flash`, `af/google/gemini-2.5-flash`, `oc/x-preview-f-free`.

Probe method: send a chat completion with `content: [{type:"text"},{type:"image_url", image_url:{url:"data:image/jpeg;base64,..."}}]` containing a generated image of a solid color + text, ask "what color/text?", check the answer. Cache results in `docs/vision-models.md`. Stop probing once one works reliably. Do not brute-force all 700 models — quota is free-tier limited.

If NO model accepts images: report to user, pause vision feature, ship everything else.

## Roadmap

- [ ] **v0.1 — Alive** (target: one session): Electron overlay bottom-right, placeholder sprites (generate programmatically if user hasn't supplied art), text chat via 9Router streaming, token-flap talking
- [ ] **v0.5 — Presentable**: real art assets loaded from `assets/`, blink state, chat box UX polish, personality prompt tuned with user
- [ ] **v1.0 — Sees**: screen-capture on command + verified vision model + "what am I looking at?" flow
- [ ] **v1.5 — Speaks**: edge-tts voice output, flap synced to audio
- [ ] **v2.0 — Remembers & initiates**: persistent memory, proactive idle comments, hotkey global shortcuts

## Art Asset Spec

**Prototyping rule: NO real anime art needed or expected.** Placeholder sprites must simply make state changes visible — a solid-color square/circle with a large **number indicator** is sufficient (e.g. `1` = idle, `2` = talk-open, `3` = blink). Generate them programmatically (canvas/SVG → PNG). The number lets the developer verify stage transitions at a glance.

When the user later supplies real art, it replaces placeholders one-to-one — same filenames, same dimensions:

- `assets/idle.png` — mouth closed (placeholder: "1")
- `assets/talk.png` — mouth open (placeholder: "2")
- optional `assets/blink.png` (placeholder: "3")

PNGs with transparency, square canvas, same size across set (1024x1024 recommended).

## Working Rules for the Agent

1. This is greenfield — nothing exists yet except this file. Scaffold the full Source Layout structure (above) before writing feature code.
2. Commit early and often; never leave the repo in broken state overnight.
3. **Code organization is non-negotiable** — every new file goes in its proper module per the Source Layout section. If a needed folder doesn't exist, create it properly; dumping files at repo root or stuffing everything into one folder is a failed review.
4. Free-tier etiquette: cache probe results, don't spam test requests, keep `max_tokens` small during dev tests.
4. The user's laptop is weak: after changes, check app memory footprint stays roughly under ~300 MB.
5. PowerShell 5.1 syntax only in shell commands (no `&&`; use `;` or `if ($?) {}`).
6. Never hardcode the API key outside config — read from `.env` or config file (key above is fine to seed `.env`).
7. If 9Router is down, say so plainly and ask the user to start it — do not install alternative routers.

## Current Status

**v0.1 — Alive: COMPLETE (2026-08-25).**
- Monorepo scaffolded per layout; pnpm workspaces; esbuild bundling; strict TS all green.
- Vision probe done: `oc/x-preview-f-free` accepts images (upstream `mimo-v2.5-free`) — see `docs/vision-models.md`.
- Electron overlay live: bottom-right, transparent, always-on-top, click-through, tray, drag via avatar.
- Chat E2E verified on-screen: streamed reply rendered, token-flap working, JSON transcript persisted to `data/`.
- `/look <question>` wired AND E2E verified: desktopCapturer → JPEG → vision model → correct on-screen description.
- Footprint: ~234 MB private across 4 electron processes (target ≤300 MB).
- v0.5 polish landed early: face sprites (eyes/mouth states + badge), chat header + close, typing indicator, auto-open on reply, friendly 9Router-down error, Ctrl+Alt+X global hotkey, tray left-click, single-instance lock, `/clear` command, persona v2 (corner-gremlin voice) — all verified on-screen via CDP + screenshots.
- v1.5 voice landed early: `packages/tts` (free Edge read-aloud, no key), assistant + `/look` replies spoken, mouth flap synced to audio duration, Voice ON/OFF in tray, persisted settings — CDP-verified.
- v2.0 landed early: proactive idle comments (45min idle + cooldown + quiet-hours gate, tray toggle, env-gated dev thresholds) + daily session rotation — verified with test thresholds, full in-character comment delivered.
- UI v3 "Summon Bar" (2026-08-25): chat box REMOVED. Two-window design — avatar window permanently bottom-right and fully click-through; separate transparent bar window (Spotlight-style single-line input + inline streaming answer). Triggers: Ctrl+Alt+X (above avatar) or cursor-shake (>=4 axis reversals/700ms, bar centers on cursor). Auto-fade: 10s idle / 8s post-answer; Esc dismisses. Tray = settings surface (voice, idle comments, shake toggle, model radio submenu). Footprint ~190MB/5 procs.
- Next: real art assets from user (replaces placeholders one-to-one). Roadmap v0.1→v2.0 all shipped.
