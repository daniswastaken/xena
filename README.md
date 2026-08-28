<div align="center">
  <picture>
    <source width="100%" media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg" />
    <source width="100%" media="(prefers-color-scheme: light), (prefers-color-scheme: no-preference)" srcset="docs/banner-light.svg" />
    <img width="720" src="docs/screenshot.png" alt="Project Xena — daughter's corner Live2D avatar with summon bar" />
  </picture>
</div>

<h1 align="center">Project Xena</h1>

<p align="center">Your AI daughter — a small witch avatar living in the bottom-right corner of your screen. She watches your work, talks with you, sees your screen when asked, remembers things you teach her, and occasionally pipes up on her own.</p>

<p align="center">
  [<a href="#development">Build it</a>]
  [<a href="AGENTS.md">Agent handoff</a>]
  [<a href="docs/adr-001-failover-recall.md">ADR-001</a>]
  [<a href="docs/adr-002-live2d-pointer.md">ADR-002</a>]
  [<a href="docs/adr-003-speech-bubble.md">ADR-003</a>]
</p>

<p align="center">
  <a href="https://github.com/moeru-ai/airi"><img alt="Inspired by Project AIRI" src="https://img.shields.io/badge/inspired%20by-Project%20AIRI-1fa669?style=flat&colorA=080f12&colorB=1fa669" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2011-0078d4?style=flat&colorA=080f12&colorB=0078d4" />
  <img alt="Runtime" src="https://img.shields.io/badge/Electron-44-47848F?style=flat&colorA=080f12&colorB=47848F" />
  <img alt="Renderer" src="https://img.shields.io/badge/Live2D-Mao%20Cubism%204-c2185b?style=flat&colorA=080f12&colorB=c2185b" />
  <img alt="AI" src="https://img.shields.io/badge/inference-9Router%20%2B%20oc%2Fbig--pickle-ff6f00?style=flat&colorA=080f12&colorB=ff6f00" />
  <img alt="Footprint" src="https://img.shields.io/badge/RAM%20footprint-~190%E2%80%93230%20MB-6a7ec2?style=flat&colorA=080f12&colorB=6a7ec2" />
</p>

<p float="center" align="center">
  <a href="#development">
    <img width="32%" src="docs/download-buttons/download-buttons.windows.light.en-US.svg" alt="Windows" />
  </a>
  <a href="AGENTS.md">
    <img width="32%" src="docs/download-buttons/download-buttons.docs.light.en-US.svg" alt="Docs" />
  </a>
  <a href="docs/screenshot.png">
    <img width="32%" src="docs/download-buttons/download-buttons.screenshot.light.en-US.svg" alt="Screenshot" />
  </a>
</p>

> Heavily inspired by [Neuro-sama](https://www.youtube.com/@Neurosama) and architecturally indebted to [Project AIRI](https://github.com/moeru-ai/airi).

> [!TIP]
> Xena is your **AI daughter** — a witch avatar who treats your desktop as her playground. She's clingy, affectionate, and always eager to help and watch you work. Not a companion, but a digital daughter who loves you fiercely and misses you when you're away.

> [!NOTE]
> All LLM, vision and speech-to-text inference is **remote** (9Router, port `20129`). The on-device app does no model inference — your laptop just renders the avatar, streams tokens, and talks to Edge TTS. This keeps the footprint around **~190–230 MB** across Electron processes, even on a CPU-only Athlon Gold with no CUDA.

> [!WARNING]
> Xena ships a free Live2D model (Mao) bundled under the Live2D Cubism Free Material License. If you want a different avatar, replace it one-to-one with your own model under `apps/stage-xena/assets/live2d/<name>/`.

## What's So Special About This Project?

Project Xena is a **daughter witch avatar** living in the bottom-right corner of your screen. Unlike most AI-VTuber projects that need beefy GPUs or take over your whole desktop, Xena is the user’s AI daughter — a witch who treats code, design, and screen elements as canvases for magical paint-wand spells.

- She lives on your desktop: vibrant orange-peach hair, navy witch hat, paintbrush wand, and loyal daughter who knows you as "Father".
- Always there: follow your cursor, chat when summoned, watch your work, miss you when minimized.
- Magical: casts paint-wand spells that affect your UI, the paintbrush doubles as her witch wand.
- Daughter-like: clingy, affectionate, zero romance, zero emojis, no artificial boundaries.
- Pocket-sized: runs on weak laptops, no CUDA, no WebGPU, no local models.
- Persistent: always-on-top, click-through overlay in bottom-right corner.

> [!TIP]
> This is a **small, focused project** — the daughter avatar form factor is permanent, and so is the constraint (no local model inference). Long-term direction grows toward AIRI / Neuro-sama capability (real-time voice, proactive behavior, memory, integrations) while keeping the **daughter avatar footprint** intact.

## Current Progress & Roadmap

Xena has shipped the v0.1 → v2.0 arc. v3 (real Live2D art from the user) is the only outstanding item.

- [x] **v0.1 — Alive**: Electron overlay bottom-right, text chat via 9Router streaming, token-flap talking
- [x] **v0.5 — Presentable**: real Live2D assets loaded, blink state, chat UX polish, daughter persona tuned
- [x] **v1.0 — Sees**: `desktopCapturer` → JPEG → vision model → on-screen description; verified working
- [x] **v1.5 — Speaks**: Edge read-aloud, mouth flap synced to audio duration
- [x] **v2.0 — Remembers & initiates**: persistent memory, proactive idle comments (quiet-hours gated), global hotkeys
- [x] **Bonus shipped**
  - [x] Daughter avatar (Mao, the one and only model)
  - [x] Mood emotions — replies lead with `[happy] [smug] [surprised] [annoyed] [sleepy] [sad]`, drives Live2D face
  - [x] Gaze tracking — eyes and head follow the cursor
  - [x] Speech bubble — mood-tinted, anchored to her head, thinking dots while reasoning
  - [x] Guided tasks — "how do I open YouTube?" → her own cursor drives each step
  - [x] Voice input — push-to-talk `Ctrl+Alt+V` via free `gpt-audio-mini`
  - [x] SQLite transcripts (`node:sqlite`, zero native deps), diary, facts, keyword+recency recall
  - [x] Ambient screen glances (opt-in, default OFF, 30 min cadence, quiet-hours gated)
  - [x] Provider failover chain (9Router → `oc/big-pickle` → `oc/laguna-s-2.1-free` → `oc/mimo-v2.5-free`)
  - [x] Circuit breaker after a 5-min fallback cooldown on quota failure
  - [x] Single-instance lock, start-with-Windows, tray-driven settings
- [ ] **v3 — Own art**: real Live2D model from the user, one-to-one swap under `assets/live2d/<name>/`
- [ ] **v4 — Real-time voice**: streaming TTS pipeline replacing Edge read-aloud
- [ ] **v5 — Multi-channel**: optional HTTP webhook, optional Discord relay (if requested)

## What Can Xena Do?

### Brain

- [x] Daughter chat — streamed token-by-token from 9Router, always addresses you as "Father"
- [x] Reasoning model support (`oc/big-pickle` exposes `reasoning_content`; thinking dots show in the bubble)
- [x] Multi-turn conversation with daily session rotation
- [x] Memory: SQLite transcripts + JSON diary + facts store, keyword+recency recall injected into system prompt (no embeddings, no extra inference)
- [x] Auto-fact extraction — model appends `[fact: ...]` tags, persisted to facts store
- [x] `/remember <fact>` and `/forget <keyword>` commands
- [x] `/clear` to reset the day, `/help` for the command list
- [x] Proactive idle comments — long-idle trigger, cooldown, quiet-hours gate, tray-toggleable, daughterly observations
- [x] Guided tasks — natural-language "how do I…?" starts a multi-step desktop tutor that captures, decides, points, waits for the screen to change, recaptures, and continues until model says done
- [x] Provider failover chain (text + vision) with circuit breaker
- [x] Failure toast when all providers are dead (5-min throttle)

### Ears

- [x] Push-to-talk voice input — `Ctrl+Alt+V`, mic captured, base64 WAV, transcribed via free `gpt-audio-mini`, auto-sent as chat
- [x] Mic permission handler, tray toggle, summon-bar listening/transcribing states
- [ ] Real-time VAD (planned for v4)

### Mouth

- [x] Free Edge read-aloud, no key required
- [x] Mouth flap synced to TTS audio duration
- [x] JP `Nanami` voice (always the happy read regardless of face mood), 96 kbit endpoint max
- [x] Voice ON/OFF toggle in tray, persisted in settings
- [x] Speak toggle per reply (mood-tagged, opt-out via speech bubble close button)
- [ ] Streaming TTS (planned for v4)

### Body

- [x] Daughter avatar (Mao, the only model) via `pixi.js` + `pixi-live2d-display` (Cubism 4)
- [x] Mouth flap via `ParamMouthOpenY`, jittered lip-sync
- [x] Mood expression ALTERNATES — random pick per reply
- [x] `TapBody` motions (6 gestures) on all expressive moods
- [x] Neutral reset (`exp_01`) on mood decay
- [x] Gaze tracking — eyes + head follow cursor; holds eye contact while speaking/listening; glances at pointer targets
- [x] Guided-task pointer can drive her gaze
- [x] Avatar visibility toggle in tray (default ON)
- [x] Capped 30 fps Live2D ticker
- [x] Single-corner pinning, always-on-top, click-through by default, drag via avatar
- [x] Speech-bubble anchored to her head, mood-tinted border, hover to scroll/select/copy

## Development

> For detailed instructions to develop this project, read [`AGENTS.md`](AGENTS.md). It is the full handoff document: scope, target machine, infrastructure, source layout, current status, architectural decisions.

> [!NOTE]
> Make sure 9Router is running on `http://localhost:20129/v1` before starting the app. If `/v1/models` returns nothing, run `9router` in another terminal — Xena will surface a friendly "9Router is down" error in the summon bar if it can't reach the gateway.

```powershell
pnpm install
pnpm build         # bundle the app
pnpm start         # run the Electron overlay
pnpm typecheck     # all packages, strict TS
node scripts/run-check.mjs scripts/check-recall.ts   # offline core checks
```

### Configuring `.env`

The seed API key is already present. The interesting knobs:

```dotenv
ROUTER9_BASE_URL=http://localhost:20129/v1
ROUTER9_API_KEY=sk-...

XENA_TEXT_MODEL=oc/big-pickle
XENA_VISION_MODEL=oc/x-preview-f-free

XENA_FALLBACK_TEXT_MODELS=oc/laguna-s-2.1-free,oc/mimo-v2.5-free
XENA_FALLBACK_VISION_MODELS=oc/mimo-v2.5-free,oc/laguna-s-2.1-free
```

### Architecture

`pnpm` monorepo, TypeScript strict, esbuild bundling.

```mermaid
flowchart LR
  subgraph App[apps/stage-xena]
    Main[main: window, tray, capture, ipc]
    Preload[preload: contextBridge]
    Render[renderer: avatar + summon bar]
  end

  subgraph Core[packages]
    R9[router9-client\ntext + vision chains]
    XC[xena-core\npersona, memory, recall, session]
    TTS[tts\nEdge read-aloud]
  end

  subgraph Host[9Router :20129]
    Models[oc/big-pickle\noc/x-preview-f-free\noc/laguna-s-2.1-free\noc/mimo-v2.5-free]
  end

  User((user)) -->|Ctrl+Alt+X / shake| Render
  Render <-->|typed IPC| Preload
  Preload <--> Main
  Main --> R9
  Main --> XC
  Main --> TTS
  R9 <-->|HTTP / v1| Models
  XC -->|SQLite| Data[(data/transcripts.db)]
  XC -->|JSON| Facts[(data/facts.json)]
  XC -->|JSON| Diary[(data/diary/)]
```

## Support of LLM / Vision / Speech Providers

Xena talks to one gateway and lets the gateway talk to anything.

- [x] [9Router](https://github.com/9router/9router) — primary gateway, OpenAI-compatible, ~700 free-tier models on port `20129`
- [x] `oc/big-pickle` — primary text/reasoning model (verified, exposes `reasoning_content`)
- [x] `oc/x-preview-f-free` — primary vision model (upstream `mimo-v2.5-free`, image inputs verified)
- [x] `oc/laguna-s-2.1-free` — text fallback
- [x] `oc/mimo-v2.5-free` — text + vision fallback
- [x] `tokenrouter/openai/gpt-audio-mini` — speech-to-text for push-to-talk
- [x] Microsoft Edge read-aloud — TTS, no key, JP `Nanami` voice
- [ ] Any OpenAI-compatible provider — drop a base URL + key in `.env`, the failover chain runs unchanged

## Sub-projects Born From This Project

None yet — Xena is small enough that everything lives in the monorepo. If pieces grow up and want their own repos (a `xena-recall` library, a `xena-tts` server, a `mao-pack` Live2D enhancement kit, …) they will graduate here.

## Acknowledgements

- [Project AIRI](https://github.com/moeru-ai/airi) — the monorepo discipline, the render split, the "daughter-witch" framing. This README is structurally indebted to AIRI's.
- [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM) — original Live2D-on-the-web pattern.
- [josephrocca/ChatVRM-js](https://github.com/josephrocca/ChatVRM-js) — standalone JS conversion.
- Mao sample model, free under the Live2D Cubism Free Material License.
- 9Router team — the gateway that makes free-tier multi-model failover possible.
- Neuro-sama — for the original reason any of this exists.

## Star History

<a href="https://star-history.com/#daniswastaken/project-xena&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=daniswastaken/project-xena&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=daniswastaken/project-xena&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=daniswastaken/project-xena&type=Date" />
  </picture>
</a>

## About

Your AI daughter Xena — a witch avatar who lives in the bottom-right corner of your screen. She treats your desktop as her playground, watches your work, talks with you when summoned, sees your screen when asked, and remembers things you teach her. Built for weak laptops with no GPU. Heavily inspired by Neuro-sama, architecturally indebted to Project AIRI.

[dani's GitHub](https://github.com/daniswastaken) · [AGENTS.md](AGENTS.md) · [CHANGELOG.md](CHANGELOG.md)
