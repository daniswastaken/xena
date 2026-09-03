/**
 * Unified initiative scheduler — v2.1 "initiates" behavior.
 * Every 5-7 minutes (randomized) Xena takes ONE initiative: either an
 * AI-initiated chat comment or an ambient screen glance (reworked). Which
 * one fires is a coin flip; per-feature settings still gate each side.
 * Comments are one-shot completions and are NOT persisted to the transcript.
 */
import { chatCompleteFailover, type InferenceConfig } from "@xena/inference-gateway";
import { buildSystemPrompt, extractEmotion, extractFactTags } from "@xena/xena-core";
import type { SettingsStore } from "../settings/store.js";
import { CHANNELS } from "../ipc/channels.js";

const MIN_GAP_MS = Number(process.env.XENA_TEST_CHECK_MS) || 5 * 60_000;
const MAX_GAP_MS = Number(process.env.XENA_TEST_CHECK_MS) || 7 * 60_000;
const QUIET_HOURS = { start: 23, end: 8 }; // [23:00, 08:00) = silent

const IDLE_PROMPTS = [
  "Father has been away from the chat a while. Say ONE short daughterly remark (max 12 words): a caring nudge, observation, or tiny question. No emojis.",
  "It has been quiet for a while. Say ONE brief playful comment (max 12 words) as his eager witch daughter. Vary your tone.",
  "Long silence. Offer Father ONE short caring thought or gentle check-in (max 12 words).",
];

function timeOfDay(hour: number): string {
  if (hour < 8) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function nextGapMs(): number {
  if (MIN_GAP_MS === MAX_GAP_MS) return MIN_GAP_MS;
  return MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
}

export class ProactiveScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastInteractionAt = Date.now();
  private busy = false;
  private promptRotation = 0;
  /** Ambient glance callback — installed via setGlanceHook. */
  private onGlance: (() => Promise<void>) | null = null;

  constructor(
    private readonly getWindow: () => Electron.BrowserWindow,
    private readonly settings: SettingsStore,
    private readonly config: InferenceConfig,
    private readonly onSpeak: (text: string, mood?: string) => Promise<void>,
    /** Optional: relevant memory fragments to flavor the idle comment. */
    private readonly memoryContext?: () => Promise<string>,
  ) {}

  /** Ambient glance callback — set after construction (init-order). */
  setGlanceHook(hook: () => Promise<void>): void {
    this.onGlance = hook;
  }

  start(): void {
    if (this.timer) return;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  noteActivity(): void {
    this.lastInteractionAt = Date.now();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /** Milliseconds since the last user interaction. */
  timeSinceInteractionMs(): number {
    return Date.now() - this.lastInteractionAt;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => void this.fire(), nextGapMs());
  }

  private async fire(): Promise<void> {
    this.timer = null;
    try {
      await this.tick();
    } catch {
      // initiatives are best-effort
    }
    this.scheduleNext();
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    const hour = new Date().getHours();
    if (hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end) return;
    const { proactiveEnabled, ambientEnabled } = await this.settings.get();
    // Coin flip: screen glance OR AI-initiated chat comment.
    if (Math.random() < 0.5) {
      if (ambientEnabled && this.onGlance) {
        await this.onGlance();
        return;
      }
      if (!proactiveEnabled) return;
    } else if (!proactiveEnabled) {
      if (ambientEnabled && this.onGlance) await this.onGlance();
      return;
    }
    await this.comment();
  }

  private async comment(): Promise<void> {
    const prompt = IDLE_PROMPTS[this.promptRotation % IDLE_PROMPTS.length] as string;
    this.promptRotation++;
    let memory = "";
    try {
      memory = (await this.memoryContext?.()) ?? "";
    } catch {
      memory = "";
    }
    try {
      const result = await chatCompleteFailover(
        [
          { role: "system", content: buildSystemPrompt() },
          ...(memory ? [{ role: "system" as const, content: memory }] : []),
          {
            role: "user" as const,
            content: `It is ${timeOfDay(new Date().getHours())} right now. ${prompt}`,
          },
        ],
        // Reasoning upstream needs headroom or the visible answer truncates.
        { model: this.config.textModel, maxTokens: 70, temperature: 1.0 },
        this.config,
      );
      const { clean, emotion } = extractEmotion(result.content.trim());
      // Fact tags are protocol metadata — never displayed, never spoken.
      const { clean: line, facts } = extractFactTags(clean);
      if (line === "" && facts.length === 0) return;
      this.getWindow().webContents.send(CHANNELS.chatProactive, line);
      this.getWindow().webContents.send(CHANNELS.avatarEmote, emotion ?? "");
      await this.onSpeak(line, emotion ?? undefined);
    } catch {
      // Proactive comments are best-effort; stay silent on failure.
    }
  }
}
