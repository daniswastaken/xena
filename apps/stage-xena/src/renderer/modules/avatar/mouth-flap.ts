/**
 * Mouth flap: hold talk sprite while audio is playing.
 */
export type AvatarState = "idle" | "talking";

export class MouthFlap {
  private _state: AvatarState = "idle";

  constructor(
    private readonly idleSrc: string,
    private readonly talkSrc: string,
    private readonly blinkSrc: string | null,
  ) {}

  get state(): AvatarState {
    return this._state;
  }

  start(): void {
    this._state = "talking";
    this.show(this.talkSrc);
  }

  stop(): void {
    this._state = "idle";
    this.show(this.idleSrc);
  }

  blinkOnce(durationMs = 120): void {
    if (!this.blinkSrc || this._state === "talking") return;
    this.show(this.blinkSrc);
    window.setTimeout(() => {
      if (this._state === "idle") this.show(this.idleSrc);
    }, durationMs);
  }

  private show(src: string): void {
    const img = document.getElementById("avatar") as HTMLImageElement | null;
    if (img && !img.src.endsWith(src)) img.src = src;
  }
}
