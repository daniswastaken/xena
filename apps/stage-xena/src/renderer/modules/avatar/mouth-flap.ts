/**
 * Avatar presentation: sprite swaps driven by talk state, blinks, and the
 * active emotion from the EmoteStage. Fully passive — callers decide when.
 */
import type { EmoteStage, SpriteKind } from "./emotes.js";

export type AvatarState = "idle" | "talking";

export class MouthFlap {
  private _state: AvatarState = "idle";

  constructor(private readonly stage: EmoteStage) {}

  get state(): AvatarState {
    return this._state;
  }

  get emotion(): string | null {
    return this.stage.emotion;
  }

  start(): void {
    this._state = "talking";
    this.show("talk");
  }

  stop(): void {
    this._state = "idle";
    this.show("idle");
  }

  blinkOnce(durationMs = 120): void {
    if (this._state === "talking") return;
    this.show("blink");
    window.setTimeout(() => {
      if (this._state === "idle") this.show("idle");
    }, durationMs);
  }

  private show(kind: SpriteKind): void {
    const img = document.getElementById("avatar") as HTMLImageElement | null;
    const src = this.stage.srcFor(kind);
    if (img && !img.src.endsWith(src)) img.src = src;
  }
}
