/**
 * Ambient screen glances: capture the screen and let the vision model make
 * ONE short observation, delivered as a visible proactive comment — the
 * user always sees exactly what was captured. Triggered by the unified
 * initiative scheduler (5-7 min random cadence). Quiet hours + busy gate
 * respected.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { visionCompleteFailover, type InferenceConfig } from "@xena/inference-gateway";
import { buildSystemPrompt, extractEmotion, extractFactTags } from "@xena/xena-core";
import { captureScreenDataUrl } from "../capture/screenshot.js";
import { CHANNELS } from "../ipc/channels.js";

const QUIET_HOURS = { start: 23, end: 8 };

const GLANCE_PROMPT =
  "In ONE short sentence (max 14 words), make a light observation about what is on this screen. " +
  "Do not address the user directly, do not ask questions, do not read out private text verbatim.";

export class GlanceTimer {
  constructor(
    private readonly getWindow: () => Electron.BrowserWindow,
    private readonly config: InferenceConfig,
    private readonly isBusy: () => boolean,
    private readonly onSpeak: (text: string, mood?: string) => Promise<void>,
    private readonly diaryDir?: string,
  ) {}

  /** One glance, now — called by the initiative scheduler. */
  async glanceNow(): Promise<void> {
    if (this.isBusy()) return;
    const hour = new Date().getHours();
    if (hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end) return;

    try {
      const dataUrl = await captureScreenDataUrl();
      const result = await visionCompleteFailover(
        [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: [
              { type: "text", text: GLANCE_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        { maxTokens: 80 },
        this.config,
      );
      const { clean, emotion } = extractEmotion(result.content.trim());
      const { clean: observation } = extractFactTags(clean);
      if (observation === "") return;
      this.getWindow().webContents.send(CHANNELS.chatProactive, observation);
      this.getWindow().webContents.send(CHANNELS.avatarEmote, emotion ?? "");
      await this.onSpeak(observation, emotion ?? undefined);
      // Observations become memory: appended to the day's diary so recall
      // can surface them later ("what was on my screen earlier?").
      if (this.diaryDir) {
        const date = new Date().toISOString().slice(0, 10);
        const file = join(this.diaryDir, `${date}.md`);
        const line = `- (glance ${new Date().toTimeString().slice(0, 5)}) ${observation}\n`;
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, line, "utf8").catch(() => undefined);
      }
    } catch {
      // glances are best-effort; stay silent on failure
    }
  }
}
