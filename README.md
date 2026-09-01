<div align="center">
  <img width="720" src="docs/banner.avif" alt="Project Xena — daughter's corner Live2D avatar with summon bar" />
</div>

<h1 align="center">Project Xena</h1>

<p align="center">Your adorable daughter, a little witch living in the bottom-right corner of your screen. She watches your work, talks with you, sees your screen, remembers things you teach her, and occasionally pipes up on her own.</p>

<p align="center">
  <a href="https://github.com/moeru-ai/airi"><img alt="Inspired by Project AIRI" src="https://img.shields.io/badge/Inspired%20By-Project%20AIRI-22c55e?style=flat&logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSIjZmZmZmZmIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZD0iTTEyIDIxLjM1bC0xLjQ1LTEuMzJDNS40IDE1LjM2IDIgMTIuMjggMiA4LjUgMiA1LjQyIDQuNDIgMyA3LjUgM2MxLjc0IDAgMy40MS44MSA0LjUgMi4wOUMxMy4wOSAzLjgxIDE0Ljc2IDMgMTYuNSAzIDE5LjU4IDMgMjIgNS40MiAyMiA4LjVjMCAzLjc4LTMuNCA2Ljg3LTguNTUgMTEuNTRMMTIgMjEuMzV6Ii8%2BPC9zdmc%2B&logoColor=white&labelColor=1a1024" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%2010%2F11-3b82f6?style=flat&logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSIjZmZmZmZmIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZD0iTTMgNS41bDcuNS0xdjYuOEgzVjUuNXptMCAxM3YtNi4zaDcuNVYxOUwzIDE4LjV2LS4wek0xMS41IDQuM0wyMSAzdjguM2gtOS41VjQuM3ptMCAxNS40di03LjVIMjFWMjFsLTkuNS0xLjN6Ii8%2BPC9zdmc%2B&logoColor=white&labelColor=1a1024" />
  <img alt="Runtime" src="https://img.shields.io/badge/Electron-44-06b6d4?style=flat&logo=electron&logoColor=white&labelColor=1a1024" />
  <img alt="Renderer" src="https://img.shields.io/badge/Live2D-Mao%20Cubism%204-ec4899?style=flat&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS13YW5kLWljb24gbHVjaWRlLXdhbmQiPjxwYXRoIGQ9Ik0xNSA0VjIiLz48cGF0aCBkPSJNMTUgMTZ2LTIiLz48cGF0aCBkPSJNOCA5aDIiLz48cGF0aCBkPSJNMjAgOWgyIi8%2BPHBhdGggZD0iTTE3LjggMTEuOCAxOSAxMyIvPjxwYXRoIGQ9Ik0xNSA5aC4wMSIvPjxwYXRoIGQ9Ik0xNy44IDYuMiAxOSA1Ii8%2BPHBhdGggZD0ibTMgMjEgOS05Ii8%2BPHBhdGggZD0iTTEyLjIgNi4yIDExIDUiLz48L3N2Zz4=&logoColor=white&labelColor=1a1024" />
  <img alt="AI" src="https://img.shields.io/badge/Inference-Gemini%20Flash%20Failover%20Chain-f97316?style=flat&logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSIjZmZmZmZmIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZD0iTTkgMWwxLjYgNC45IDQuOSAxLjYtNC45IDEuNkw5IDE0bC0xLjYtNC45TDIuNSA3LjVsNC45LTEuNkw5IDF6bTkgOGwxIDMgMyAxLTMgMS0xIDMtMS0zLTMtMSAzLTEgMS0zeiIvPjwvc3ZnPg==&logoColor=white&labelColor=1a1024" />
  <img alt="Footprint" src="https://img.shields.io/badge/RAM%20Footprint-~190%E2%80%93230%20MB-8b5cf6?style=flat&logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSIjZmZmZmZmIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZD0iTTE1IDlIOXY2aDZWOXptLTIgNGgtMnYtMmgydjJ6bTgtMlY5aC0yVjdjMC0xLjEtLjktMi0yLTJoLTJWM2gtMnYyaC0yVjNIOXYySDdjLTEuMSAwLTIgLjktMiAydjJIM3YyaDJ2MkgzdjJoMnYyYzAgMS4xLjkgMiAyIDJoMnYyaDJ2LTJoMnYyaDJ2LTJoMmMxLjEgMCAyLS45IDItMnYtMmgydi0yaC0ydi0yaDJ6bS00IDZIN1Y3aDEwdjEweiIvPjwvc3ZnPg==&logoColor=white&labelColor=1a1024" />
</p>

<p align="center">
  [<a href="#development">Build it</a>]
  [<a href="docs/setup-guide.md">Setup guide</a>]
</p>

<p float="center" align="center">
  <a href="https://github.com/daniswastaken/xena/releases/latest">
    <img width="32%" src="docs/buttons/download-win.svg" alt="Download for Windows" />
  </a>
  <a href="docs/setup-guide.md">
    <img width="32%" src="docs/buttons/setup-guide.svg" alt="Setup Guide" />
  </a>
  <a href="https://github.com/daniswastaken/xena/issues/new">
    <img width="32%" src="docs/buttons/request-feature.svg" alt="Request a Feature" />
  </a>
</p>

> Heavily inspired by [Neuro-sama](https://www.youtube.com/@Neurosama) and architecturally indebted to [Project AIRI](https://github.com/moeru-ai/airi).

> [!TIP]
> Xena is your **AI daughter**, a little witch who treats your desktop as her playground. She's clingy, affectionate, and always eager to help and watch you work.

> [!NOTE]
> All LLM and vision inference is **remote**, none of the heavy LLM computing are done locally.

## What's So Special About This Project?

Project Xena is a **daughter witch avatar** living in the bottom-right corner of your screen. Unlike most AI-VTuber projects that need beefy GPUs or take over your whole desktop, Xena is the user’s AI daughter, a little witch who treats code, design, and screen elements as canvases for magical paint-wand spells.

- Lightweight: runs on weak laptops, no CUDA, no WebGPU, no local models.
- Persistent: always-on-top, click-through overlay in bottom-right corner.

> [!TIP]
> This is a **small, focused project**. The daughter avatar form factor is permanent, and so is the constraint (no local model inference). Long-term direction grows toward AIRI / Neuro-sama capability (real-time voice, proactive behavior, memory, integrations) while keeping the **daughter avatar footprint** intact.

## Current Progress & Roadmap

Shipped:

- **v0.1 —** Project kickoff.
- **v0.2 —** Live2D model.
- **v0.3 —** Vision model.
- **v0.4 —** TTS feature.
- **v0.5 —** Long term memory and knowledge.
- **v0.6 —** Model auto recovery.
- **v0.6.1 —** Packaged `.exe` distribution (NSIS) with bundled 9Router and fresh-machine key bootstrap — build it locally with `pnpm --filter @xena/stage-xena dist`.

Planned:
- **Release channel.** Hosted releases once a public repo/CI is set up; the Windows `.exe` itself is already shippable (see the [setup guide](docs/setup-guide.md), section 5).
- **Real-time voice.** Streaming TTS pipeline replacing Edge read-aloud.

## What Can Xena Do?

### Brain <img alt="all shipped" src="https://img.shields.io/badge/All%20Shipped-ec4899?style=flat-square&labelColor=1a1024" />

| Status | Feature |
|---|---|
| Shipped | Memory: SQLite transcripts + JSON diary + facts store, keyword+recency recall in the system prompt (no embeddings) |
| Shipped | `/remember` · `/forget` · `/clear` · `/help` commands |
| Shipped | Proactive comments + ambient screen glances, unified 5-7 min randomized initiative clock, coin-flip pick, quiet-hours gate, tray-toggleable |
| Shipped | Guided tasks: "how do I…?" starts a vision-driven multi-step desktop tutor |

### Eyes <img alt="sees on command" src="https://img.shields.io/badge/On%20Command-3b82f6?style=flat-square&labelColor=1a1024" />

| Status | Feature |
|---|---|
| Shipped | Screen vision on command: `/look <question>` shares the screen to the vision chain |

### Mouth <img alt="1 shipped, 1 planned" src="https://img.shields.io/badge/1%20Shipped%20%2F%201%20Planned-06b6d4?style=flat-square&labelColor=1a1024" />

| Status | Feature |
|---|---|
| Shipped | Lips movement synced to TTS audio duration |
| Planned | Streaming TTS (v4) |

### Body <img alt="all shipped" src="https://img.shields.io/badge/All%20Shipped-ec4899?style=flat-square&labelColor=1a1024" />

| Status | Feature |
|---|---|
| Shipped | Xena avatar (Mao) via `pixi.js` + `pixi-live2d-display` (Cubism 4) |
| Shipped | Mood expression ALTERNATES, random pick per reply |
| Shipped | `TapBody` motions (6 gestures) on all expressive moods |
| Shipped | Gaze tracking: eyes + head follow cursor, holds eye contact while speaking, glances at pointer targets |

## Development

> For detailed instructions to develop this project, read [`AGENTS.md`](AGENTS.md). It is the full handoff document: scope, target machine, infrastructure, source layout, current status, architectural decisions.

> [!NOTE]
> Starting the app starts the whole inference stack: Xena spawns and supervises the 9Router gateway herself (`--port 20129 --no-browser --skip-update`), adopts an already-running instance instead of double-spawning, and respawns it on crash. Gemini and Pollinations are plain HTTPS — always up. If everything is somehow down at once, the tray's "Restart inference" action recovers without restarting Xena.

```powershell
pnpm install
pnpm build         # bundle the app
pnpm start         # run the Electron overlay (inference comes up with it)
pnpm typecheck     # all packages, strict TS
node scripts/run-check.mjs scripts/check-recall.ts   # offline core checks
node scripts/run-check.mjs scripts/check-child9router.ts  # child lifecycle checks
```

### Configuring `.env`

The seed keys are already present. The interesting knobs:

```dotenv
# Gemini — primary provider (free key: https://aistudio.google.com/app/apikey)
XENA_GEMINI_API_KEY=AIza...
XENA_GEMINI_CHAT_MODEL=gemini-2.5-flash
XENA_GEMINI_VISION_MODEL=gemini-2.5-flash
XENA_GEMINI_LITE_MODEL=gemini-2.5-flash-lite

# 9Router — supervised child rung (spawned at app boot)
ROUTER9_BASE_URL=http://localhost:20129/v1
ROUTER9_API_KEY=sk-...
XENA_NINEROUTER_ENABLED=1        # 0 = pure Gemini + Pollinations stack
XENA_TEXT_MODEL=oc/big-pickle
XENA_VISION_MODEL=oc/x-preview-f-free
XENA_FALLBACK_TEXT_MODELS=oc/laguna-s-2.1-free,oc/mimo-v2.5-free
XENA_FALLBACK_VISION_MODELS=oc/mimo-v2.5-free

# Pollinations — keyless final net
XENA_POLLINATIONS_TEXT_MODEL=openai-fast
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
    IG[inference-gateway\nchain + supervisor\nchild 9router]
    R9[router9-client\n9Router transport]
    XC[xena-core\npersona, memory, recall, session]
    TTS[tts\nEdge read-aloud]
  end

  subgraph Remote[remote providers]
    G[Gemini 2.5 Flash\ntext + vision]
    L[Gemini Flash-Lite\noverflow rung]
    Host[9Router :20129\noc/big-pickle\noc/x-preview-f-free\noc/* free models]
    P[Pollinations\nopenai-fast, keyless]
  end

  User((user)) -->|Ctrl+Alt+X / shake| Render
  Render <-->|typed IPC| Preload
  Preload <--> Main
  Main --> IG
  Main --> XC
  Main --> TTS
  IG --> R9
  IG -->|HTTPS| G
  IG -->|HTTPS| L
  IG -->|supervised child| Host
  IG -->|HTTPS keyless| P
  XC -->|SQLite| Data[(data/transcripts.db)]
  XC -->|JSON| Facts[(data/facts.json)]
  XC -->|JSON| Diary[(data/diary/)]
```

## Provider Support

Xena walks a failover chain per request. The first healthy rung serves; failures never surface as raw API errors, just persona lines (ADR-004).

| Provider | Role | Status |
|---|---|---|
| [Gemini](https://aistudio.google.com) `gemini-2.5-flash` | **Primary**: text + vision, one free AI Studio key | <img alt="active" src="https://img.shields.io/badge/Active-22c55e?style=flat-square&labelColor=1a1024" /> |
| Gemini `gemini-2.5-flash-lite` | Overflow rung: same key, higher free rate limits | <img alt="active" src="https://img.shields.io/badge/Active-22c55e?style=flat-square&labelColor=1a1024" /> |
| [9Router](https://github.com/9router/9router) `oc/*` | Reasoning rung (`oc/big-pickle`, `reasoning_content`) + free vision models, spawned & supervised by Xena at boot | <img alt="active" src="https://img.shields.io/badge/Active-22c55e?style=flat-square&labelColor=1a1024" /> |
| [Pollinations](https://pollinations.ai) `openai-fast` | Keyless final net | <img alt="active" src="https://img.shields.io/badge/Active-22c55e?style=flat-square&labelColor=1a1024" /> |
| Microsoft Edge read-aloud | Free TTS, JP `Nanami` voice | <img alt="active" src="https://img.shields.io/badge/Active-22c55e?style=flat-square&labelColor=1a1024" /> |
| Any OpenAI-compatible provider | Drop a base URL + key in `.env` — failover chain runs unchanged | <img alt="planned" src="https://img.shields.io/badge/Plug%20And%20Play-8b5cf6?style=flat-square&labelColor=1a1024" /> |

## Star History

<a href="https://star-history.com/#daniswastaken/project-xena&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=daniswastaken/project-xena&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=daniswastaken/project-xena&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=daniswastaken/project-xena&type=Date" />
  </picture>
</a>
