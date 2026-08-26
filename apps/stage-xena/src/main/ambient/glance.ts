/**
 * Ambient screen glances (opt-in, default OFF): every GLANCE_INTERVAL_MS,
 * capture the screen and let the vision model make ONE short observation,
 * delivered as a visible proactive comment — the user always sees exactly
 * what was captured. Quiet hours + busy gate respected.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { visionCompleteFailover, type Router9Config } from "@xena/router9-client";
import { captureScreenDataUrl } from "../capture/screenshot.js";
import { CHANNELS } from "../ipc/channels.js";

const GLANCE_INTERVAL_MS = Number(process.env.XENA_TEST_GLANCE_MS) || 30 * 60_000;
const QUIET_HOURS = { start: 23, end: 8 };

const GLANCE_PROMPT =
  "In ONE short sentence (max 14 words), make a light observation about what is on this screen. " +
  "Do not address the user directly, do not ask questions, do not read out private text verbatim.";

export class GlanceTimer {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly getWindow: () => Electron.BrowserWindow,
    private readonly config: Router9Config,
    private readonly isEnabled: () => Promise<boolean>,
    private readonly isBusy: () => boolean,
    private readonly onSpeak: (text: string) => Promise<void>,
    private readonly diaryDir?: string,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), GLANCE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.isBusy()) return;
    if (!(await this.isEnabled())) return;
    const hour = new Date().getHours();
    if (hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end) return;

    try {
      const dataUrl = await captureScreenDataUrl();
      const result = await visionCompleteFailover(
        [
          {
            role: "user",
            content: [
              { type: "text", text: GLANCE_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        { maxTokens: 300 },
        this.config,
      );
      const observation = result.content.trim();
      if (observation === "") return;
      this.getWindow().webContents.send(CHANNELS.chatProactive, observation);
      await this.onSpeak(observation);
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
