# Development Scripts

All scripts run from the repo root. Node 24+ (type stripping handles TS).

## Build & verify

| Command | What it does |
|---|---|
| `pnpm typecheck` | strict TS across all packages |
| `pnpm build` | esbuild-bundle the Electron app into `apps/stage-xena/dist` |
| `node scripts/gen-sprites.mjs` | regenerate placeholder PNG sprites + emotion set |
| `node scripts/run-check.mjs scripts/check-recall.ts` | offline suite: emotion parser, point/fact tags, recall, diary, facts, provider chain (live sections need 9Router; vision gated by `XENA_CHECK_VISION=1`) |

## CDP drivers (app must run with `--remote-debugging-port=9223`)

| Script | Purpose |
|---|---|
| `drive-xena.mjs "msg"` | send a chat message through the real UI |
| `drive-point.mjs "target"` | fire `/point` at a screen target |
| `inspect-avatar.mjs` | avatar sprite src + transform + screenshot |
| `inspect-bar.mjs` | bar answer text + visibility |
| `inspect-live2d.mjs` | Live2D mount diagnostics (core/canvas) |
| `probe-live2d-api.mjs` | preload `getLive2d()` round-trip |
| `arm-gaze.mjs` / `read-gaze.mjs` | count gaze IPC events received |
| `watch-console.mjs` | stream renderer exceptions/console errors for 10s |

## Generators / probes

| Script | Purpose |
|---|---|
| `gen-vision-test-image.ps1` | test image for vision probes |
| `probe-vision-models.ps1` | probe candidate vision models (results → `docs/vision-models.md`) |
| `l2d-inspect-imports.mjs` | dump pixi-live2d-display import graph (dependency debugging) |
| `smoke-stream.mjs` | quick streaming smoke test |
