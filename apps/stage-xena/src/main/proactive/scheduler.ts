/**
 * Proactive idle comments — v2.0 "initiates" behavior.
 * Conservative by design: long idle threshold, waking-hours gate,
 * one comment per cooldown, never while a chat reply is streaming.
 * Comments are one-shot completions and are NOT persisted to the transcript.
 */
import { chatComplete, type Router9Config } from "@xena/router9-client";
import { buildSystemPrompt } from "@xena/xena-core";
import type { SettingsStore } from "../settings/store.js";

// Env overrides exist for dev verification only; production uses the long defaults.
const CHECK_INTERVAL_MS = Number(process.env.XENA_TEST_CHECK_MS) || 5 * 60_000;
const IDLE_THRESHOLD_MS = Number(process.env.XENA_TEST_IDLE_MS) || 45 * 60_000;
const COOLDOWN_MS = Number(process.env.XENA_TEST_IDLE_MS) || 45 * 60_000;
const QUIET_HOURS = { start: 23, end: 8 }; // [23:00, 08:00) = silent

const IDLE_PROMPTS = [
  "The user has been away from the chat a while. Say ONE short idle remark (max 12 words) — an observation, a nudge, or a tiny question. No emoji spam.",
  "It's been quiet for a while. Say ONE brief playful comment (max 12 words) as the corner gremlin. Vary your tone.",
  "Long silence. Offer ONE short thought or gentle check-in (max 12 words).",
];

export class ProactiveScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastInteractionAt = Date.now();
  private lastCommentAt = 0;
  private busy = false;
  private promptRotation = 0;

  constructor(
    private readonly getWindow: () => Electron.BrowserWindow,
    private readonly settings: SettingsStore,
    private readonly config: Router9Config,
    private readonly onSpeak: (text: string) => Promise<void>,
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
    try {
      const result = await chatComplete(
        [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: prompt },
        ],
        // Reasoning upstream needs headroom or the visible answer truncates.
        { model: this.config.textModel, maxTokens: 500, temperature: 1.0 },
        this.config,
      );
      const comment = result.content.trim();
      if (comment === "") return;
      this.getWindow().webContents.send("chat:proactive", comment);
      await this.onSpeak(comment);
    } catch {
      // Proactive comments are best-effort; stay silent on failure.
    }
  }
}
