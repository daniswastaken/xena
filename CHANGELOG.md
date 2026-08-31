# Changelog

## 0.6.1 — 2026-08-31

### Packaged distribution + fresh-machine 9Router (ADR-005)
- **Fresh-machine key bootstrap** — the 9Router child's DB starts with ZERO
  api keys (they're dashboard-created), so every Xena request 401'd on a
  fresh install. `NineRouterChild` now adopts the child's newest active key,
  or mints one with 9Router's own algorithm (machine-id + HMAC + default
  secret) and inserts it into the child's sqlite DB via `node:sqlite`.
  Validated live: minted key → HTTP 200 → 691 models → full chat roundtrip.
- **Key self-heal** — a successful router9 request locks the key; a 401
  re-opens DB sync, so dashboard key rotation heals within one probe (15s,
  down from a 60s cadence that lagged cold boots by two full minutes)
- **Gemini model aliases** — `gemini-2.5-flash` is deprecated upstream
  (404); defaults now use pointer aliases `gemini-flash-latest` /
  `gemini-flash-lite-latest` across gateway + router9-client
- **Rung diagnostics** — per-rung failures log `[inference] rung down:
  <provider>/<model> HTTP <status>`; settings-path + key-source logged at
  boot (packaged userData is `%APPDATA%\@xena\stage-xena`, not `Xena`)
- **Windows Sandbox E2E harness v6** (`scripts/sandbox-e2e.ps1` + `.wsb`) —
  Win10 19044 LogonCommand is dead on this host, so the driver types into
  the guest taskbar search box via host-side SendKeys/mouse_event + OCR
  loop. 6 stages: silent install, no-key bubble chat with provider
  attribution, 9Router kill/respawn, 3-rapid-send stress, with-key relaunch
  asserting key overlay + gemini-first attempt, first-run setup flow
  (greeting → yes → pasted key → persisted), silent uninstall
  (exe gone, no orphan child), XENA_NINEROUTER_ENABLED=0 pure-stack mode,
  footprint. **Run 14: ALL 8 STAGES GREEN** (bubble oracle now distinguishes
  persona error lines from model replies)
- **Key hygiene** — the seeded AI Studio key was flagged leaked by Google
  (it sat in a committed test script); scrubbed from the repo, harness reads
  the key from the mapped share (`C:\Shared\gemini-key.txt`). **Rotate the
  key** — user action needed for Gemini-primary on any machine

## 0.3.0 — 2026-08-29

### Inference backend rework (ADR-004)
- **New `packages/inference-gateway`** owns all orchestration; 9Router
  demotes to a rung, not a prerequisite
- **Chain (text):** Gemini `gemini-2.5-flash` (one free key: text +
  vision + STT) → `gemini-2.5-flash-lite` → 9Router `oc/big-pickle` +
  `oc/*` free models → keyless Pollinations `openai-fast` final net
- **Chain (vision):** same Gemini rungs → `oc/x-preview-f-free` →
  `oc/mimo-v2.5-free`
- **Chain (STT):** Gemini inline audio → 9Router gpt-audio — voice
  input now survives 9Router being down
- **Unified launch:** Xena spawns the 9Router gateway at boot
  (profile flags `--port 20129 --no-browser --skip-update`), probes
  every 60s, respawns with 5s→30s backoff, adopts an already-running
  instance, tree-kills on quit; no more manual `9router` start
- **Self-recovery:** 404/empty evicts a model 10 min; 3 provider
  failures = 5-min provider offline; chain collapse auto-resets the
  supervisor; tray gains an Inference status line + "Restart
  inference" (never restarts Xena)
- `XENA_NINEROUTER_ENABLED=0` runs a pure Gemini + Pollinations stack

### Error surface boundary (no more raw provider text)
- Failures classify into `InferenceError` kinds (quota / timeout /
  empty / all-down / stt / aborted / unknown)
- Main maps kinds to persona lines before IPC — the bubble never shows
  `9Router 404` style noise again; bar gets short plain lines; OS
  toasts plain English with an auto-recovery note; technical detail
  lives in console + tray diagnostics only
- Aborts are silent; mid-stream failures leave the partial reply
  standing (no-restart invariant extends to the error surface)

### Repo
- `router9-client` is now pure 9Router transport; apps/xena-core import
  `@xena/inference-gateway` (import-line-only migration)
- `scripts/check-child9router.ts` — offline child lifecycle checks
- ADR-004 documents the chain, recovery layers, and error boundary

## 0.2.2 — 2026-08-26

### Speech bubble (replaces the chat window)
- **Replies merge into the avatar window** as a comic bubble anchored to
  Mao's head — white panel, dark text, tail meeting the hat; the
  independent chat window is gone (user directive)
- Avatar window enlarged to 460x400; click-through everywhere except the
  bubble surface (hover unlocks scroll/select/copy)
- **Mood-tinted bubble** — border + tail accent follow the emotion tag
  (happy gold / smug purple / surprised cyan / annoyed red / sleepy blue)
- **Animated thinking dots** while the model reasons (replaces static "…")
- Reading-time fade scales with actual reply length (8s + 20ms/char, cap
  28s); supersedes the 12s idle leash so long answers survive
- Linkified URLs, copy chip, provider fallback badge carried over from
  the old chat window

### Fixes
- Bubble tail no longer creates a phantom scrollbar (text pane scrolls)
- Bubble anchored above Mao's head instead of floating top-left
- Gaze face coords updated for the larger window

## 0.2.1 — 2026-08-26

### Avatar
- **Gaze tracking** — eyes + head follow the cursor; holds eye contact
  while speaking or listening; glances at AI Pointer targets; smoothed
- **Vowel lip-sync** — real A/I/U/E/O mouth shapes under the flap, with
  amplitude jitter
- **Live2D blinking** — organic blink state machine, expression-aware
- Mao is now the only Live2D model; expression alternates per mood +
  param touch-ups (blush/sparkle) + neutral resets + head-tilt variants
- Idle gesture beats (neutral-face fidgets)

### Chat window
- Replies moved to their own independent translucent window
  (bottom-left, above the input bar)
- Hover-interactivity: scroll + text-select + copy chip
- Linkified URLs (click opens default browser)
- Reading-time fade: longer answers stay visible longer
- Proactive comments/glances visible post-split; stream-concurrency
  guards for /look and /point

### Voice input
- Push-to-talk (Ctrl+Alt+V) with silence auto-stop, 30s cap, barge-in
  echo prevention, cancel-on-dismiss, transcription preview

### Pointer
- Glide travel, click-pulse arrival, guided locate retry
- Per-attempt 45s / overall 90s budgets; timeouts are failover-worthy

### Misc
- Persona v0.2: full character voice (origin, opinions, quirks)
- Name perk-up (instant emote when "Xena" is mentioned)
- Wave on summon; /stats command; /look Q&A joins the transcript
- Glance observations append to the daily diary
- Friendly voice-transcription errors; graphify-out ignored

## 0.2.0 — 2026-08-26

The companion release. Xena gains a full Live2D rig, screen pointing,
durable memory, and emotional prosody.

### Avatar
- Live2D avatar (sole avatar, tray toggle): free Mao sample model with
  per-mood expression alternates, TapBody gesture motions, vowel
  lip-sync (A/I/U/E/O), organic blinking, neutral resets, jittered flap
- Gaze tracking: eyes + head follow the cursor; she glances at her own
  pointer targets; smoothed organic motion, applied post-idle-motion
- PNG fallback unchanged (emotion sprites, breathing, bounce, blinks)

### AI Pointer
- `/point <thing>` + natural-language `[point: target]` tags
- Multi-step choreography (up to 3 sequential targets, 4.5s apart)
- Vision-located coordinates with guided retry; glide travel with
  click-pulse arrival; 9s dwell; Mao looks where she points

### Memory
- Transcripts on SQLite (node:sqlite — zero native deps); legacy JSON
  imported
- Nightly in-character diary summaries on session rotation
- Auto-fact curation via `[fact:]` tags + `/remember` / `/forget`
- Keyword+recency+density recall injected into every prompt

### Voice
- 7 Edge voices (tray radio), 96kbit (endpoint max)
- Per-mood SSML prosody — the voice acts the emotion

### Conversation
- Summon bar moved bottom-left, translucent panel
- Message queue while streaming (max 2, auto-send)
- Input history (ArrowUp/Down), markdown-lite answers, thinking
  indicator for reasoning models, provider fallback badge

### Presence & resilience
- Welcome-back greeting after 30min absence
- First-run intro, proactive idle comments (memory+time flavored),
  ambient screen glances (opt-in), idle mood flickers and gestures
- **Push-to-talk voice input** (Ctrl+Alt+V): mic → WAV → free
  gpt-audio transcription → auto-sent as chat
- Provider failover (9Router → OpenRouter ox-alpha; vision via
  minimax-m3:free) with 5min circuit breaker
- Failure toasts, renderer crash auto-recovery, unhandledRejection guard
- Start with Windows (opt-in)

### Internal
- pnpm overrides pin @pixi/* 6.5.10 (duplicate-instance fix);
  @pixi/unsafe-eval keeps CSP strict
- 37-check offline suite + CDP driver/inspector scripts
- ADR-001 (failover/recall), ADR-002 (Live2D/Pointer)

## 0.1.0 — 2026-08-25

Initial release: corner PNGtuber overlay, streamed chat via 9Router,
`/look` screen vision, Edge TTS, proactive comments, summon bar
(hotkey + cursor shake), daily transcripts, tray settings.
