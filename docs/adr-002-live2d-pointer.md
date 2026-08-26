# ADR-002: Live2D Stage + AI Pointer Architecture

Date: 2026-08-26
Status: accepted

## Context

Xena's corner-overlay form factor is permanent, but the PNG sprite loop
caps expressiveness. Separately, users need Xena to *show* where things
are on screen, not just describe them.

## Decisions

### Live2D stage (experimental, tray toggle, default OFF)

- **pixi.js 6 + pixi-live2d-display (cubism4)** — the plugin's peer range
  pins pixi v6; v7 breaks its interaction manager. pnpm `overrides` pin
  every `@pixi/*` to 6.5.10: without them pnpm resolves duplicate
  `@pixi/core` instances and class-identity checks fail at runtime.
- **`@pixi/unsafe-eval`** patches out pixi's `new Function` shader
  compilation so the CSP keeps `script-src 'self'` (no unsafe-eval).
- **Cubism Core** ships as a local vendored script
  (`assets/vendor/live2dcubismcore.min.js`) loaded before the renderer.
- **Models**: Live2D's official free samples (Hiyori, Haru, Mao, Natori)
  under the Free Material License, provenance noted per folder. The tray
  picker auto-scans `assets/live2d/*` for `.model3.json`.
- **Per-model expression maps**: expression files use model-specific
  parameter semantics (Haru F-series, Mao exp-series, Natori semantic
  names). Maps are decoded by hand into `MOOD_EXPRESSIONS`; models
  without a map degrade to motion-only.
- **Mouth flap** drives `ParamMouthOpenY` on the pixi ticker (30fps cap);
  the same `Mouth` facade routes TTS playback to PNG flap AND Live2D.
- Footprint: ~229MB PNG mode, ~322MB with Live2D.

### AI Pointer (dual-cursor)

- Trigger paths: explicit `/point <thing>`, or natural-language
  `[point: target]` tags the persona appends when directing the user to
  plausibly-visible UI (multiple tags = sequential steps, 4.5s apart).
- **Locate**: screen capture → vision chain (9Router → minimax-m3:free →
  ox-alpha) → JSON `{x,y}` normalized coords; code-fence tolerant.
- **Render**: `PointerWindow` — transparent, click-through, never
  focusable, always-on-top. Coordinates map against **full display
  bounds** (captures include the taskbar; workArea clips it). Arrival
  plays a click-pulse; travel is a quad-eased glide; 9s dwell.
- Privacy stance: pointing is user-initiated (command or direct answer);
  the model must not point at non-visible targets.

## Consequences

- Adding a model = drop the folder; picker + scan pick it up. Adding
  expression fidelity = hand-decode its exp3.json into the map.
- The pointer is only as accurate as the vision chain; locate failures
  degrade to a spoken "couldn't find it" instead of a wrong point.
