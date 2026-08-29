/**
 * Live2D stage: pixi.js + pixi-live2d-display rendering the Cubism 4 model
 * (Mao) as the corner avatar. Mouth flap driven by the talking signal; idle
 * motion plays automatically. This is the sole avatar — the PNG sprite
 * stage was retired.
 *
 * Requires window.Live2DCubismCore (loaded from assets/vendor in index.html).
 */
import * as PIXI from "pixi.js";
import { install } from "@pixi/unsafe-eval";
import { Live2DModel } from "pixi-live2d-display/cubism4";

// Bundled pixi: register ticker explicitly; patch out `new Function` usage
// (CSP forbids unsafe-eval).
install(PIXI);
PIXI.utils.skipHello();
Live2DModel.registerTicker(PIXI.Ticker);

/**
 * Mao is the one true model. Expression semantics decoded from exp3.json:
 *   exp_02 content smile-eyes, exp_04 sparkly delight, exp_03 eyes closed,
 *   exp_05 troubled, exp_06 blushing startle, exp_07 wide-eye surprised,
 *   exp_08 angry.
 * Each mood lists expression alternates (picked at random) so repeated
 * moods don't look canned; expressive moods also fire a TapBody motion
 * (6 available).
 */
const MAO_EXPRESSIONS: Record<string, string[]> = {
  happy: ["exp_04", "exp_02"],
  smug: ["exp_02", "exp_01"],
  surprised: ["exp_07", "exp_06"],
  annoyed: ["exp_08"],
  sleepy: ["exp_03"],
  sad: ["exp_05"],
};

const MOTION_GROUP = "TapBody";
const STILL_MOODS = new Set(["sleepy"]);

/** Subtle param touches layered ON TOP of expressions — extra variety. */
const MOOD_TOUCH: Record<string, Array<[string, number]>> = {
  happy: [["ParamCheek", 0.45]],
  smug: [["ParamCheek", 0.25]],
  surprised: [["ParamEyeEffect", 0.6]],
};

export class Live2DStage {
  private app: PIXI.Application | null = null;
  private model: Live2DModel | null = null;
  private talking = false;
  private flapPhase = 0;
  private vowelPhase = 0;
  private currentVowel = "ParamA";
  /** Live audio loudness from the analyser (0..1). */
  private audioLevel = 0;
  private lastLevelAt = 0;
  private gaze = { dx: 0, dy: 0 };
  /** Smoothed gaze — eyes glide, never snap. */
  private gazeSmooth = { dx: 0, dy: 0 };
  /**
   * AIRI-style random gaze: she free-roams most of the time, then
   * periodically engages cursor-tracking for a random window, then back.
   * No trigger conditions — purely time-randomized mode flips.
   */
  private gazeMode: "roam" | "track" = "roam";
  private gazeModeUntil = 0;
  private roamT = 0;
  private roamTarget = { dx: 0, dy: 0 };
  private nextSaccadeAt = 0;
  private blinkState: "open" | "closing" | "closed" | "opening" = "open";
  private nextBlinkAt = 0;
  private blinkT = 0;
  private lastExpression = "";
  private tiltBias = 0;
  private currentMood = "";
  private moodDecayTimer: number | null = null;

  constructor(private readonly modelDir: string) {}

  get ready(): boolean {
    return this.model !== null;
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.app) return;
    const app = new PIXI.Application({
      backgroundAlpha: 0,
      autoDensity: true,
      // Weak iGPU: cap render resolution; slight softness beats dropped frames.
      resolution: Math.min(window.devicePixelRatio || 1, 1.25),
      width: container.clientWidth,
      height: container.clientHeight,
    });
    container.appendChild(app.view as HTMLCanvasElement);
    this.app = app;
    // Weak iGPU battery guard: 30fps is plenty for idle sway + flap.
    app.ticker.maxFPS = 30;

    // autoInteract off: pixi v6 interaction manager fights the plugin's
    // expectations, and the avatar is click-through anyway.
    const model = await Live2DModel.from(`${this.modelDir}`, { autoInteract: false });
    // Bust framing: upper body only (head → mid-torso), legs cropped below
    // window. User wants "middle body till head" not whole body.
    const baseWidth = model.width;
    const baseHeight = model.height;
    const w = app.screen.width;
    const h = app.screen.height;
    // ~1.4× canvas height, scaled down 10%: face + upper body framing.
    const scale = (h * 1.4) / baseHeight * 0.80;
    model.scale.set(scale);
    const modelW = baseWidth * scale;
    const modelH = baseHeight * scale;
    model.x = w - 300;
    model.y = h - modelH * 0.55 + 25 + 15;
    // Canvas is taller than the window (500 vs 400px), so head stays
    // visible while legs extend below the window edge (intentional crop).
    app.stage.addChild(model);
    this.model = model;

    // Gaze must be applied AFTER the idle motion writes its parameters,
    // or the motion overwrites it every frame. Patch the internal update
    // to re-apply gaze post-motion (community-standard hook).
    const internal = model.internalModel as unknown as {
      update: (model: unknown, now: number) => void;
    };
    const originalUpdate = internal.update.bind(internal);
    internal.update = (m: unknown, now: number): void => {
      originalUpdate(m, now);
      this.applyGaze();
      this.applyMouthFlap();
    };

    app.ticker.add(this.tick);
  }

  setTalking(value: boolean): void {
    this.talking = value;
    if (!value) this.audioLevel = 0;
  }

  /**
   * Real audio loudness 0..1 from the playing TTS (WebAudio analyser).
   * When receiving levels, the mouth follows the actual sound instead of
   * the synthetic flap — the JP lip-sync fix.
   */
  setAudioLevel(level: number): void {
    this.audioLevel = level;
    this.lastLevelAt = Date.now();
  }

  /** Cursor position relative to the avatar, normalized -1..1. */
  setGaze(dx: number, dy: number): void {
    this.gaze = { dx, dy };
  }

  /** Forces cursor-tracking immediately (pointer targets / overrides). */
  forceTrack(holdMs = 4000): void {
    this.gazeMode = "track";
    this.gazeModeUntil = Date.now() + holdMs;
  }

  /** Randomized mode schedule: roam 8-25s, track 4-12s, ad infinitum. */
  private scheduleGazeMode(now: number): void {
    if (now < this.gazeModeUntil) return;
    if (this.gazeMode === "roam") {
      this.gazeMode = "track";
      this.gazeModeUntil = now + 4000 + Math.random() * 8000;
    } else {
      this.gazeMode = "roam";
      this.gazeModeUntil = now + 8000 + Math.random() * 17_000;
      this.roamTarget = this.nextRoamTarget();
    }
  }

  private nextRoamTarget(): { dx: number; dy: number } {
    return {
      dx: Math.random() * 1.6 - 0.8,
      dy: Math.random() * 0.9 - 0.45,
    };
  }

  /**
   * Apply a mood: an empty string returns to neutral immediately, any other
   * mood fires a flourish and auto-decays back to neutral after a hold so the
   * face doesn't stay stuck. Replaces the PNG EmoteStage's decay role.
   */
  setMood(emotion: string): void {
    if (this.moodDecayTimer !== null) {
      window.clearTimeout(this.moodDecayTimer);
      this.moodDecayTimer = null;
    }
    if (emotion === "") {
      this.resetExpression();
      return;
    }
    this.playMoodFlourish(emotion);
    this.moodDecayTimer = window.setTimeout(() => {
      this.moodDecayTimer = null;
      this.resetExpression();
    }, 12_000);
  }

  /** Mood flourish: random expression variant + TapBody motion. */
  playMoodFlourish(mood: string): void {
    if (!this.model) return;
    this.currentMood = mood;
    const options = MAO_EXPRESSIONS[mood];
    if (options && options.length > 0) {
      const pick = options[Math.floor(Math.random() * options.length)]!;
      this.lastExpression = pick;
      // Micro-variant: tiny random head-tilt bias so the same mood never
      // plays identically twice (applied in applyGaze each frame).
      this.tiltBias = Math.random() * 10 - 5;
      try {
        void this.model.expression(pick);
      } catch {
        // expression missing — ignore
      }
    }
    if (STILL_MOODS.has(mood)) return;
    const groups = this.model.internalModel.motionManager.definitions;
    if (!groups) return;
    const groupNames = Object.keys(groups);
    const group = groupNames.includes(MOTION_GROUP) ? MOTION_GROUP : groupNames[0];
    if (!group) return;
    void this.model.motion(group);
  }

  /** Gesture without a mood — an idle stretch/fidget beat. */
  playIdleGesture(): void {
    if (!this.model) return;
    const groups = this.model.internalModel.motionManager.definitions;
    if (!groups) return;
    const groupNames = Object.keys(groups);
    if (groupNames.length === 0) return;
    const group = groupNames.includes("TapBody") ? "TapBody" : groupNames[0]!;
    void this.model.motion(group);
  }

  /** Returns the face to neutral (mood decay calls this). */
  resetExpression(): void {
    if (!this.model) return;
    this.currentMood = "";
    this.lastExpression = "";
    try {
      void this.model.expression("exp_01");
    } catch {
      // no neutral expression — ignore
    }
  }

  destroy(): void {
    if (this.moodDecayTimer !== null) {
      window.clearTimeout(this.moodDecayTimer);
      this.moodDecayTimer = null;
    }
    if (this.app) this.app.ticker.remove(this.tick);
    this.model?.destroy();
    this.model = null;
    this.app?.destroy(true, { children: true });
    this.app = null;
  }

  /** Eyes lead, head follows lazily — called after motion update each frame. */
  private applyGaze(): void {
    const core = this.model?.internalModel.coreModel as
      | { setParameterValueById?: (id: string, value: number) => void }
      | undefined;
    if (!core?.setParameterValueById) return;
    // Kill the color-sample spheres (white balls) — they're test artifacts
    // baked into the Mao model, not part of the character.
    core.setParameterValueById("ParamSphereOn", 0);
    core.setParameterValueById("ParamSphereMove", 0);
    const coreAny = core as { setPartOpacityById?: (id: string, value: number) => void };
    coreAny.setPartOpacityById?.("PartColorSample", 0);
    // Mood touch-ups ride along every frame (blush tint etc.).
    const touch = this.currentMood ? MOOD_TOUCH[this.currentMood] : undefined;
    if (touch) {
      for (const [id, value] of touch) core.setParameterValueById(id, value);
    }

    // --- Random gaze mode selection (AIRI-style engage/roam) -------------
    const now = Date.now();
    this.scheduleGazeMode(now);
    let target = this.gaze;
    if (this.talking) {
      // Eye contact while speaking — main pins gaze to the user (0,0).
      target = this.gaze;
    } else if (this.gazeMode === "roam") {
      // Free-roaming: slow drift toward wander targets with occasional
      // quick saccades — organic idle eye movement, mostly NOT tracking.
      this.roamT += 0.016;
      if (now >= this.nextSaccadeAt) {
        this.nextSaccadeAt = now + 900 + Math.random() * 2600;
        this.roamTarget = this.nextRoamTarget();
      }
      const sway = 0.08 * Math.sin(this.roamT * 0.7);
      const swayY = 0.06 * Math.sin(this.roamT * 0.45 + 1.3);
      target = {
        dx: this.roamTarget.dx + sway,
        dy: this.roamTarget.dy + swayY,
      };
    }
    // While talking she looks at the user (main sets gaze 0,0 for TTS).

    // Exponential smoothing toward the target: fast enough to feel alive,
    // slow enough to read as organic eye movement. Roam is lazier still.
    const k = this.talking ? 0.12 : this.gazeMode === "roam" ? 0.045 : 0.12;
    this.gazeSmooth.dx += (target.dx - this.gazeSmooth.dx) * k;
    this.gazeSmooth.dy += (target.dy - this.gazeSmooth.dy) * k;
    const g = this.gazeSmooth;
    core.setParameterValueById("ParamEyeBallX", g.dx * 0.85);
    core.setParameterValueById("ParamEyeBallY", -g.dy * 0.55);
    core.setParameterValueById("ParamAngleX", g.dx * 14);
    core.setParameterValueById("ParamAngleY", -g.dy * 9);
    core.setParameterValueById("ParamAngleZ", g.dx * -4 + this.tiltBias);
    // Body trails the head — layered depth to the tracking.
    core.setParameterValueById("ParamBodyAngleX", g.dx * 6);
  }

  private lastTickAt = 0;
  /** Expressions that own the eyelids — blinking would fight them. */
  private static NO_BLINK = new Set(["exp_02", "exp_03"]);

  /** Organic blink state machine (open -> closing -> closed -> opening). */
  private applyBlink(core: { setParameterValueById?: (id: string, value: number) => void }): void {
    if (!core.setParameterValueById) return;
    if (this.lastExpression && Live2DStage.NO_BLINK.has(this.lastExpression)) return;
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTickAt) / 1000 || 0.016);
    this.lastTickAt = now;
    if (this.blinkState === "open") {
      if (now >= this.nextBlinkAt) {
        this.blinkState = "closing";
        this.blinkT = 0;
      }
      return;
    }
    this.blinkT += dt;
    if (this.blinkState === "closing") {
      const v = Math.max(0, 1 - this.blinkT / 0.06);
      core.setParameterValueById("ParamEyeLOpen", v);
      core.setParameterValueById("ParamEyeROpen", v);
      if (this.blinkT >= 0.06) {
        this.blinkState = "closed";
        this.blinkT = 0;
      }
    } else if (this.blinkState === "closed") {
      if (this.blinkT >= 0.07) {
        this.blinkState = "opening";
        this.blinkT = 0;
      }
    } else {
      const v = Math.min(1, this.blinkT / 0.1);
      core.setParameterValueById("ParamEyeLOpen", v);
      core.setParameterValueById("ParamEyeROpen", v);
      if (this.blinkT >= 0.1) {
        this.blinkState = "open";
        this.nextBlinkAt = now + 2400 + Math.random() * 4200;
      }
    }
  }

  private applyMouthFlap(): void {
    const core = this.model?.internalModel.coreModel as
      | { setParameterValueById?: (id: string, value: number) => void }
      | undefined;
    if (!core?.setParameterValueById) return;
    if (this.talking) {
      // Audio-reactive when the analyser is live (levels arrived < 200ms
      // ago); otherwise fall back to the synthetic flap.
      const live = Date.now() - this.lastLevelAt < 200 ? this.audioLevel : null;
      let open: number;
      if (live !== null) {
        // Real level: widen the range so speech reads clearly on the face.
        open = Math.min(1, live * 1.25);
        this.flapPhase += 0.45;
      } else {
        this.flapPhase += 0.45;
        const jitter = 0.72 + 0.28 * Math.abs(Math.sin(this.flapPhase * 0.37));
        open = ((Math.sin(this.flapPhase) + 1) / 2) * jitter;
      }
      // Vowel lip-sync: rotate mouth shapes at JP mora pace (~110ms) with
      // amplitude locked to the openness so quiet syllables narrow the mouth.
      this.vowelPhase += 0.45;
      if (this.vowelPhase >= 1) {
        this.vowelPhase = 0;
        const vowels = ["ParamA", "ParamI", "ParamU", "ParamE", "ParamO"];
        this.currentVowel = vowels[Math.floor(Math.random() * vowels.length)]!;
      }
      // Boost amplitude + floor: the mouth never fully slams shut mid-
      // speech (kills the "static" look during JP mora runs).
      const shaped = 0.08 + open * 0.92;
      core.setParameterValueById("ParamMouthOpenY", shaped);
      const vowelOpen = 0.3 + shaped * 0.6;
      for (const v of ["ParamA", "ParamI", "ParamU", "ParamE", "ParamO"]) {
        core.setParameterValueById(v, v === this.currentVowel ? vowelOpen : 0);
      }
    } else {
      if (this.flapPhase !== 0) {
        this.flapPhase = 0;
        core.setParameterValueById("ParamMouthOpenY", 0);
      }
      for (const v of ["ParamA", "ParamI", "ParamU", "ParamE", "ParamO"]) {
        core.setParameterValueById(v, 0);
      }
    }
  }

  private tick = (): void => {
    const core = this.model?.internalModel.coreModel as
      | { setParameterValueById?: (id: string, value: number) => void }
      | undefined;
    if (!core?.setParameterValueById) return;
    this.applyBlink(core);
  };
}
