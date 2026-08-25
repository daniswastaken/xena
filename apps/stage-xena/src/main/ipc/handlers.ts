/**
 * IPC handlers: chat streaming relay, vision ask, TTS relay.
 * Renderer never fetches directly — everything goes through here.
 */
import { ipcMain } from "electron";
import { Session } from "@xena/xena-core";
import { MemoryStore } from "@xena/xena-core";
import { askAboutImage, type Router9Config } from "@xena/router9-client";
import { CHANNELS } from "./channels.js";
import { captureScreenDataUrl } from "../capture/screenshot.js";
import { speakReply } from "../tts/speak.js";
import type { SettingsStore } from "../settings/store.js";
import type { ProactiveScheduler } from "../proactive/scheduler.js";
import type { BarWindow } from "../window/bar-window.js";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");

/** One session per calendar day — history rotates daily. */
function todaySessionId(): string {
  return `default-${new Date().toISOString().slice(0, 10)}`;
}

export function registerIpcHandlers(
  config: Router9Config,
  settings: SettingsStore,
  scheduler: ProactiveScheduler,
  bar: BarWindow,
  avatarWin: () => Electron.BrowserWindow,
): void {
  let currentSessionId = todaySessionId();
  let currentModel = "";

  function openSession(): Promise<Session> {
    return settings.get().then(({ textModel }) => {
      currentModel = textModel;
      return Session.open(
        { sessionId: currentSessionId, storeDir: DATA_DIR, model: textModel || undefined },
        config,
      ).then((r) => r.session);
    });
  }

  /** Reopens the session when the calendar day or model changed. */
  async function getSession(): Promise<Session> {
    if (currentSessionId !== todaySessionId()) {
      currentSessionId = todaySessionId();
      sessionReady = openSession();
    }
    return sessionReady;
  }

  let sessionReady: Promise<Session> = openSession();

  // Hygiene: drop transcripts older than 30 days, fire-and-forget.
  void new MemoryStore(DATA_DIR).pruneOlderThan(30).catch(() => undefined);

  async function maybeSpeak(text: string): Promise<void> {
    const { voiceEnabled } = await settings.get();
    if (!voiceEnabled || text.trim() === "") return;
    try {
      const audio = await speakReply(text);
      avatarWin().webContents.send(CHANNELS.ttsAudio, audio);
    } catch {
      // Voice is best-effort — never break chat over TTS failure.
    }
  }

  ipcMain.handle(CHANNELS.chatSend, async (_event, text: unknown) => {
    if (typeof text !== "string" || text.trim() === "") throw new Error("empty message");
    scheduler.noteActivity();
    scheduler.setBusy(true);
    try {
      const session = await getSession();
      const reply = await session.send(text.trim(), {
        onToken: (full) => bar.win.webContents.send(CHANNELS.chatToken, full),
        onError: (error) => bar.win.webContents.send(CHANNELS.chatError, error.message),
      });
      bar.win.webContents.send(CHANNELS.chatDone, true);
      await maybeSpeak(reply);
    } finally {
      scheduler.setBusy(false);
    }
  });

  ipcMain.handle(CHANNELS.chatAbort, async () => {
    const session = await sessionReady;
    session.abort();
  });

  ipcMain.handle(CHANNELS.chatClear, async () => {
    const session = await getSession();
    await session.reset();
  });

  ipcMain.on(CHANNELS.noteActivity, () => {
    scheduler.noteActivity();
  });

  ipcMain.on(CHANNELS.barDismissed, () => {
    bar.hide();
  });

  ipcMain.handle(CHANNELS.visionAsk, async (_event, question: unknown) => {
    const q =
      typeof question === "string" && question.trim() !== ""
        ? question.trim()
        : "What am I looking at?";
    scheduler.noteActivity();
    const dataUrl = await captureScreenDataUrl();
    const answer = await askAboutImage(q, dataUrl, config);
    await maybeSpeak(answer);
    return answer;
  });
}
