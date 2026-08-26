/**
 * Emotion stage: tracks the active mood, resolves sprite paths per state,
 * probes which emotion sprites actually exist (placeholder art may ship a
 * subset), and decays back to neutral after a hold time.
 */
import type { Emotion } from "@xena/xena-core/persona";
import { EMOTIONS, isEmotion } from "@xena/xena-core/persona";

export type SpriteKind = "idle" | "talk" | "blink";

export interface BaseSprites {
  idle: string;
  talk: string;
  blink: string;
}

const DEFAULT_HOLD_MS = 9000;

export class EmoteStage {
  private current: Emotion | null = null;
  /** probed existence of `<emotion>-<kind>.png` */
  private readonly available = new Map<string, boolean>();
  private decayTimer: number | null = null;

  constructor(
    private readonly base: BaseSprites,
    private readonly holdMs: number = DEFAULT_HOLD_MS,
  ) {}

  /** Probes every emotion sprite once at startup; missing files fall back to neutral. */
  async preload(): Promise<void> {
    const probes: Promise<void>[] = [];
    for (const emotion of EMOTIONS) {
      for (const kind of ["idle", "talk", "blink"] as const) {
        probes.push(this.probe(`./assets/emotions/${emotion}-${kind}.png`, emotion, kind));
      }
    }
    await Promise.all(probes);
  }

  private probe(src: string, emotion: Emotion, kind: SpriteKind): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.available.set(`${emotion}:${kind}`, true);
        resolve();
      };
      img.onerror = () => {
        this.available.set(`${emotion}:${kind}`, false);
        resolve();
      };
      img.src = src;
    });
  }

  get emotion(): Emotion | null {
    return this.current;
  }

  /** Applies an emotion by name; unknown names or missing sprites are ignored. */
  setEmotion(name: string, onExpire?: () => void): void {
    if (!isEmotion(name) || this.available.get(`${name}:idle`) !== true) return;
    this.current = name;
    if (this.decayTimer !== null) window.clearTimeout(this.decayTimer);
    this.decayTimer = window.setTimeout(() => {
      this.current = null;
      this.decayTimer = null;
      onExpire?.();
    }, this.holdMs);
  }

  /** Sprite path for the given state under the active emotion (or neutral). */
  srcFor(kind: SpriteKind): string {
    if (this.current && this.available.get(`${this.current}:${kind}`) === true) {
      return `./assets/emotions/${this.current}-${kind}.png`;
    }
    switch (kind) {
      case "idle":
        return this.base.idle;
      case "talk":
        return this.base.talk;
      case "blink":
        return this.base.blink;
    }
  }
}
