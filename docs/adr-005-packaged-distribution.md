# ADR-005: Packaged distribution + fresh-machine 9Router key bootstrap

Date: 2026-08-31
Status: Accepted

## Context

Xena ships as a one-click NSIS installer (`Xena-setup-0.6.0.exe`, ~158 MB —
Electron + bundled `9router@0.5.55` under `resources/9router/`). A fresh
machine has no `.env`, no seeded `ROUTER9_API_KEY`, and possibly no Gemini
key at all. Sandbox E2E (run 8, all green) surfaced two fresh-machine
blockers and one upstream deprecation:

1. **9Router fresh DB has zero API keys.** Keys are normally hand-created in
   the 9Router dashboard; the child gateway boots with an empty `apiKeys`
   table, so every Xena request 401s and the local rung is dead.
2. **Electron userData dir** on a packaged build is `%APPDATA%\@xena\stage-xena`
   (derived from the package name), NOT `%APPDATA%\Xena` — E2E settings
   planting and log discovery must cover all candidate dirs.
3. **`gemini-2.5-flash` is deprecated upstream** (404 for new users); the
   seeded AI Studio key was additionally flagged as leaked (it had been
   committed in a test script; Google auto-scans public repos). Defaults now
   use the pointer aliases `gemini-flash-latest` / `gemini-flash-lite-latest`.

## Decision

**Fresh-machine key bootstrap lives in `NineRouterChild`**
(`packages/inference-gateway/src/child9router.ts`):

- On every successful health probe, while the current key is unverified,
  the gateway opens the child's sqlite DB (`%APPDATA%\9router\db\data.sqlite`,
  `node:sqlite` — no native deps) and **adopts the newest active key**.
- Fresh DB (zero keys): the gateway **mints a key with 9Router's own
  algorithm** — `sk-<machineId[:6]>-<rand6>-<hmac-sha256(API_KEY_SECRET,
  machineId+rand)[:8]>` with the default secret, machine-id resolved the same
  way 9Router does (file → Windows MachineGuid → random, cached to
  `machine-id`) — and INSERTs it into `apiKeys`. Validated live: minted key
  authenticates (HTTP 200, 691 models, full chat roundtrip on `oc/big-pickle`).
- The chain signals back: a successful router9 request marks the key
  verified (never touched again); a 401 re-opens the sync path, so dashboard
  key rotation self-heals within one probe cycle (15 s).

**Probe cadence 60s → 15s**: fresh cold boot takes ~60s on weak CPUs; a 60s
interval left the tray showing "starting" for two full minutes and lagged
key adoption past the first chat.

**Model aliases**: gateway + router9-client defaults now use
`gemini-flash-latest` / `gemini-flash-lite-latest` (Google's pointer
aliases, immune to model deprecation sweeps).

**Rung diagnostics**: per-rung failures log `[inference] rung down:
<provider>/<model> HTTP <status>` so E2E can prove the chain *attempted*
Gemini before falling to router9.

## Consequences

- Fresh machine: install → boot → chat works with ZERO configuration
  (9Router keyless-from-Xena's-side, `oc/*` free rungs, Pollinations net).
- A real Gemini key entered in first-run setup (or settings.json) overlays
  the chain and Gemini is attempted first; if the key is quota'd/dead the
  chain degrades to 9Router without surfacing raw errors (ADR-004 boundary).
- The leaked seed key must be rotated by the user (new AI Studio key into
  `.env` / first-run prompt). Test scripts never hardcode keys — the sandbox
  harness reads `C:\Shared\gemini-key.txt` from the mapped share.
- Footprint: bundled 9Router child adds ~500-700 MB working set (node +
  Next.js server). Xena's own Electron processes stay ~190-230 MB; the
  ≤300 MB target applies to Xena proper, documented per ADR-002/004 machine
  budget (9.9 GB RAM total).

## Validation (Windows Sandbox E2E, run 10 — 2026-08-31)

- Silent install (`/S`) → exe at `%LOCALAPPDATA%\Programs\@xenastage-xena\Xena.exe`
- No-key boot: 9Router child self-spawns (bundled copy), bubble chat served
  by `router9:oc/big-pickle` via minted key
- Kill 9Router child → auto-respawn within probe cycle
- 3 rapid sends → 3 reply-dones (no lost messages)
- With-key relaunch: settings overlay active (`-> active`), gemini-primary
  attempted (429 quota on the dead key), router9 served
- First-run setup flow (Stage F): greeting + clickable yes/no → key input
  revealed → pasted key accepted → flow completes → `.firstrun` marker +
  `geminiApiKey` persisted in settings.json
- Pure Gemini+Pollinations stack (XENA_NINEROUTER_ENABLED=0 in a .env next to the
  installed exe): child disabled, port free, chain walk surfaces persona lines only
- Silent uninstall (/S): exe removed, zero processes left, no orphan 9Router
  child holding port 20129
- Working-set footprint logged for the record
