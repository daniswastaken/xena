# Setup Guide

End-to-end setup for Project Xena on Windows 11. ~10 minutes if everything goes right.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 26.x | Electron 44 + `node:sqlite` |
| **pnpm** | 9.x | monorepo workspaces |
| **Windows** | 11 | target machine; PowerShell 5.1 default |
| **9Router** | v0.5.55+ | AI gateway, runs on port `20129` |
| **Google AI Studio key** | free tier | primary provider (chat + vision) |

The free tier is enough. No paid provider keys.

## 1. Install Node + pnpm

```powershell
node --version    # should be v26.x; if not, install LTS from nodejs.org
npm install -g pnpm@9
pnpm --version
```

## 2. Install 9Router (optional but recommended)

The local reasoning rung. Xena **spawns and supervises it herself at app boot** — you never start it manually. Installing it just means the rung is available; skip this section entirely for a pure Gemini + Pollinations stack.

```powershell
npm install -g 9router
9router --version    # v0.5.55 or later
```

That's it — do **not** leave a `9router` terminal open. If one is already running when Xena starts, she adopts it instead of double-spawning.

## 3. Get a Gemini API key

The primary provider. Free tier at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey). No billing; no credit card.

Copy the key (starts with `AIzaSy...`).

## 4. Clone + configure

```powershell
git clone https://github.com/daniswastaken/xena.git
cd xena
pnpm install
```

Open `.env` in the project root. It already has the 9Router key. Replace `XENA_GEMINI_API_KEY` with your own.

```dotenv
# Gemini — primary provider (free key: https://aistudio.google.com/app/apikey)
XENA_GEMINI_API_KEY=AIzaSy...your-key-here...
XENA_GEMINI_CHAT_MODEL=gemini-2.5-flash
XENA_GEMINI_VISION_MODEL=gemini-2.5-flash
XENA_GEMINI_LITE_MODEL=gemini-2.5-flash-lite

# 9Router — supervised child rung (Xena spawns it at boot)
ROUTER9_BASE_URL=http://localhost:20129/v1
ROUTER9_API_KEY=sk-...your-local-9router-key...
XENA_NINEROUTER_ENABLED=1        # 0 = pure Gemini + Pollinations stack
XENA_TEXT_MODEL=oc/big-pickle
XENA_VISION_MODEL=oc/x-preview-f-free
XENA_FALLBACK_TEXT_MODELS=oc/laguna-s-2.1-free,oc/mimo-v2.5-free
XENA_FALLBACK_VISION_MODELS=oc/mimo-v2.5-free

# Pollinations — keyless final net
XENA_POLLINATIONS_TEXT_MODEL=openai-fast
```

**Provider chain** (per request, first healthy rung wins — see [`AGENTS.md`](../AGENTS.md) / ADR-004):

1. **Gemini `gemini-2.5-flash`** — primary, chat + vision + STT, one free key
2. **Gemini `gemini-2.5-flash-lite`** — same key, higher free rate limits
3. **9Router** — reasoning (`oc/big-pickle`) + free `oc/*` fallbacks
4. **Pollinations `openai-fast`** — keyless, zero-config, the chain never goes mute

## 5. Run

```powershell
pnpm build
pnpm start
```

One command starts everything: Mao appears in the bottom-right corner, the inference stack (Gemini HTTPS instantly, 9Router spawned and supervised as a child) comes up with the app. Press `Ctrl+Alt+X` to summon the chat bar.

## 6. Quick verification

| Try this | Expected |
|---|---|
| `Ctrl+Alt+X` | Summon bar appears, bottom-left |
| Type "hello" + Enter | Reply streams + reads aloud (JP Nanami) |
| `/look what's on my screen?` | Mao describes your screen |
| `/remember my favorite color is teal` | Acknowledges; persists to `data/facts.json` |
| `/forget teal` | Removes the fact |
| `Ctrl+Alt+V` | Push-to-talk voice input (mic permission popup on first use) |
| Shake cursor (4+ reversals in 700 ms) | Summon bar appears at cursor |
| `Esc` | Dismisses the bar |
| Tray icon → Avatar | Toggles Live2D visibility |

## 7. Stopping / restarting

- **Stop Xena**: right-click tray icon → Quit (the supervised 9Router child is tree-killed with it)
- **Recovery without restarting**: tray → "Restart inference" clears cooldowns, re-reads `.env`, respawns the child
- **Next session**: just `pnpm start` — no other terminal, no manual gateway

## 8. Optional: dev mode

For iterating on the renderer / main process:

```powershell
pnpm typecheck                                # all packages
node scripts/run-check.mjs scripts/check-recall.ts   # offline core checks
```

The full agent handoff (architecture, source layout, decision authority) is in [`AGENTS.md`](../AGENTS.md). All chronological changes are in [`CHANGELOG.md`](../CHANGELOG.md).

## Troubleshooting

**Replies say she can't reach her thoughts** — every rung in the chain is down at once (rare). Wait a minute, or tray → "Restart inference". Technical detail lives in the tray Inference status line and the console.

**Voice input not working** — Gemini inline audio failed and 9Router's gpt-audio rung is unavailable (`XENA_NINEROUTER_ENABLED=0` or 9Router not installed). Try again, or type instead.

**Mouth doesn't flap, no voice** — voice is off in the tray. Click tray → Voice → ON.

**Summon bar won't appear on hotkey** — another app likely owns `Ctrl+Alt+X`. Edit it in `apps/stage-xena/src/main/input/` (search for `Ctrl+Alt+X`).

**Reply is a wall of text** — the persona has a strict 1-sentence rule, but free models sometimes ignore it. The cap is in the system prompt; tighten by editing the length rule in `packages/xena-core/src/persona/prompt.ts`.

**Memory footprint creeping up** — Electron normally sits around 190–230 MB. If it's well over 300 MB, check for orphan processes: `Get-Process electron`.

## Reporting issues

Something broken? [Open an issue](https://github.com/daniswastaken/xena/issues) with:

- `pnpm typecheck` output
- The exact text you sent Xena
- What you expected vs what happened
- Screenshot of the bubble if relevant

Feature requests → [issues/new?template=feature_request.md](https://github.com/daniswastaken/xena/issues/new).
