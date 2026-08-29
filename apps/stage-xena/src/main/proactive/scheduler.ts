/**
 * Proactive idle comments — v2.0 "initiates" behavior.
 * Conservative by design: long idle threshold, waking-hours gate,
 * one comment per cooldown, never while a chat reply is streaming.
 * Comments are one-shot completions and are NOT persisted to the transcript.
 */
import { chatCompleteFailover, type InferenceConfig } from "@xena/inference-gateway";
import { buildSystemPrompt, extractEmotion } from "@xena/xena-core";
import type { SettingsStore } from "../settings/store.js";
import { CHANNELS } from "../ipc/channels.js";

// Env overrides exist for dev verification only; production uses the long defaults.
const CHECK_INTERVAL_MS = Number(process.env.XENA_TEST_CHECK_MS) || 5 * 60_000;
const IDLE_THRESHOLD_MS = Number(process.env.XENA_TEST_IDLE_MS) || 45 * 60_000;
const COOLDOWN_MS = Number(process.env.XENA_TEST_IDLE_MS) || 45 * 60_000;
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

export class ProactiveScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastInteractionAt = Date.now();
  private lastCommentAt = 0;
  private busy = false;
  private promptRotation = 0;

  constructor(
    private readonly getWindow: () => Electron.BrowserWindow,
    private readonly settings: SettingsStore,
    private readonly config: InferenceConfig,
    private readonly onSpeak: (text: string, mood?: string) => Promise<void>,
    /** Optional: relevant memory fragments to flavor the idle comment. */
    private readonly memoryContext?: () => Promise<string>,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
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

  private async tick(): Promise<void> {
    if (this.busy) return;
    const { proactiveEnabled } = await this.settings.get();
    if (!proactiveEnabled) return;
    const now = new Date();
    const hour = now.getHours();
    if (hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end) return;
    if (Date.now() - this.lastInteractionAt < IDLE_THRESHOLD_MS) return;
    if (Date.now() - this.lastCommentAt < COOLDOWN_MS) return;

    this.lastCommentAt = Date.now();
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
            content: `It is ${timeOfDay(now.getHours())} right now. ${prompt}`,
          },
        ],
        // Reasoning upstream needs headroom or the visible answer truncates.
        { model: this.config.textModel, maxTokens: 70, temperature: 1.0 },
        this.config,
      );
      const { clean, emotion } = extractEmotion(result.content.trim());
      if (clean === "") return;
      this.getWindow().webContents.send("chat:proactive", clean);
      this.getWindow().webContents.send(CHANNELS.avatarEmote, emotion ?? "");
      await this.onSpeak(clean, emotion ?? undefined);
    } catch {
      // Proactive comments are best-effort; stay silent on failure.
    }
  }
}
