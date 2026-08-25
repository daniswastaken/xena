/**
 * Xena main process entry.
 */
import { app, globalShortcut } from "electron";
import { join } from "node:path";
import { createAvatarWindow } from "./window/overlay.js";
import { BarWindow } from "./window/bar-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/tray.js";
import { loadConfig } from "@xena/router9-client";
import { SettingsStore, defaultSettingsPath } from "./settings/store.js";
import { ProactiveScheduler } from "./proactive/scheduler.js";
import { speakReply } from "./tts/speak.js";
import { ShakeDetector } from "./input/shake-detector.js";

// Weak iGPU target: keep Chromium from spawning extra GPU processes when possible.
app.commandLine.appendSwitch("disable-gpu-sandbox");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const config = loadConfig();
  const settings = new SettingsStore(defaultSettingsPath(join(process.cwd(), "data")));

  let bar: BarWindow | null = null;
  let shake: ShakeDetector | null = null;

  app.on("second-instance", () => {
    bar?.summonCorner();
  });

  app.whenReady().then(() => {
    const { win: avatar, home } = createAvatarWindow();
    bar = new BarWindow(home);

    const scheduler = new ProactiveScheduler(
      () => bar!.win,
      settings,
      config,
      async (comment) => {
        const { voiceEnabled } = await settings.get();
        if (!voiceEnabled) return;
        const audio = await speakReply(comment).catch(() => null);
        if (audio) avatar.webContents.send("tts:audio", audio);
      },
    );
    registerIpcHandlers(config, settings, scheduler, bar, () => avatar);
    scheduler.start();

    shake = new ShakeDetector((x, y) => {
      void settings.get().then(({ shakeEnabled }) => {
        if (shakeEnabled) bar?.summonAtCursor(x, y);
      });
    });
    shake.start();

    createTray(bar, join(__dirname, "../renderer/assets"), settings, config.textModel);

    // Ctrl+Alt+X — global summon. XENA_NO_HOTKEY=1 disables (debug).
    if (process.env.XENA_NO_HOTKEY !== "1") {
      globalShortcut.register("Control+Alt+X", () => {
        bar?.summonCorner();
      });
    }
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    shake?.stop();
  });

  app.on("window-all-closed", () => {
    // Tray app: keep running unless user quits from tray.
  });
}
