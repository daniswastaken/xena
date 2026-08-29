/**
 * First-run setup flow: greets the user, asks if they have a Gemini key
 * to gift Xena, and saves the key if provided. All UI lives in the avatar
 * window — the bar is hidden during setup.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHANNELS } from "../ipc/channels.js";
import { dataDir } from "../paths.js";
import { refreshInPlace, type InferenceConfig } from "@xena/inference-gateway";
import type { SettingsStore } from "../settings/store.js";
import type Electron from "electron";

export type SetupStep = "greeting" | "ask-key" | "decline" | "key-saved" | "sit-together" | "unlock";

const GEMINI_KEY_RE = /^AIza[0-9A-Za-z_-]{35,}$/;

export class SetupFlow {
  private step: SetupStep = "greeting";
  private audioEndHandlers: Array<() => void> = [];

  constructor(
    private readonly avatar: Electron.BrowserWindow,
    private readonly settings: SettingsStore,
    private readonly config: InferenceConfig,
    private readonly onDone: () => void,
  ) {}

  sendBubble(text: string, mood: string): void {
    this.avatar.webContents.send(CHANNELS.setupBubble, text);
    this.avatar.webContents.send(CHANNELS.setupMood, mood);
  }

  sendStep(step: SetupStep): void {
    this.avatar.webContents.send(CHANNELS.setupStep, step);
  }

  private sendActive(active: boolean): void {
    this.avatar.webContents.send(CHANNELS.setupActive, active);
  }

  async start(): Promise<boolean> {
    const firstRun = !(await this.isFirstRunDone());
    if (!firstRun) {
      this.onDone();
      return false;
    }
    this.step = "greeting";
    return true;
  }

  /** User submitted input (button click, enter key, etc.). */
  onInput(text: string): void {
    const trimmed = text.trim();
    const t = trimmed.toLowerCase();
    if (this.step === "greeting") {
      if (t === "yes" || t === "yeah" || t === "yep" || t === "yea") {
        this.step = "ask-key";
        this.sendStep("ask-key");
        this.sendBubble("Oh, really? Thank you, Father! Where is it?", "happy");
        return;
      }
      // anything else (or empty) = decline
      this.sendStep("decline");
      this.sendBubble("Oh, yeah that's fine. Why were you looking for me then? Come in have a seat.", "smug");
      void this.completeSetup();
      return;
    }

    if (this.step === "ask-key") {
      if (GEMINI_KEY_RE.test(trimmed)) {
        this.sendStep("key-saved");
        this.sendBubble("There! I feel much brighter already, Father. Welcome back.", "happy");
        void this.completeSetup(trimmed);
        return;
      }
      // not a key — treat as sitting together
      this.sendStep("sit-together");
      this.sendBubble("Okay! Let's just sit together, Father.", "smug");
      void this.completeSetup();
      return;
    }
  }

  /** User clicked back in the ask-key step. */
  onBack(): void {
    if (this.step !== "ask-key") return;
    this.step = "greeting";
    this.sendStep("greeting");
    this.sendBubble("Oh, Father! You're looking for me? Eh, you have something to give?", "surprised");
  }

  /** Renderer reported the current setup audio finished (or failed). */
  onAudioEnd(): void {
    const handlers = this.audioEndHandlers;
    this.audioEndHandlers = [];
    for (const h of handlers) h();
  }

  /** Resolves when the current audio finishes, or after a hard timeout. */
  private waitForAudioEnd(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.audioEndHandlers = this.audioEndHandlers.filter((h) => h !== done);
        resolve();
      }, timeoutMs);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.audioEndHandlers.push(done);
    });
  }

  private async completeSetup(key?: string): Promise<void> {
    if (key) {
      const current = await this.settings.get();
      await this.settings.set({ ...current, geminiApiKey: key });
      this.config.geminiApiKey = key;
      refreshInPlace(this.config);
    }
    // Let the completion line play fully, then a short beat.
    await this.waitForAudioEnd(6000);
    await sleep(500);
    // Show the unlock prompt — shake and copy become active after this line.
    this.sendStep("unlock");
    this.sendBubble("Father, look at what I just made, try shaking your cursor!", "happy");
    await this.waitForAudioEnd(6000);
    await sleep(500);
    await this.markFirstRunDone();
    this.avatar.webContents.send(CHANNELS.setupDone);
    this.onDone();
  }

  private async isFirstRunDone(): Promise<boolean> {
    try {
      return existsSync(join(dataDir(), ".firstrun"));
    } catch {
      return false;
    }
  }

  private async markFirstRunDone(): Promise<void> {
    await writeFile(join(dataDir(), ".firstrun"), new Date().toISOString(), "utf8");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
