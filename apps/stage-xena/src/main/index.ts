/**
 * Xena main process entry.
 */
import { app, globalShortcut, session } from "electron";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { createAvatarWindow } from "./window/overlay.js";
import { BarWindow } from "./window/bar-window.js";
import { PointerWindow } from "./window/pointer-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/tray.js";
import { loadConfig } from "@xena/router9-client";
import { chatCompleteFailover } from "@xena/router9-client";
import { MemoryStore, MemoryRecall, renderRecallContext, extractEmotion, buildSystemPrompt } from "@xena/xena-core";
import { SettingsStore, defaultSettingsPath } from "./settings/store.js";
import { ProactiveScheduler } from "./proactive/scheduler.js";
import { speakReply } from "./tts/speak.js";
import { ShakeDetector } from "./input/shake-detector.js";
import { GazeTracker } from "./input/gaze-tracker.js";
import { GlanceTimer } from "./ambient/glance.js";import { CHANNELS } from "./ipc/channels.js";

/** Folder names under assets/live2d/ that contain a *.model3.json. */
function scanLive2dModels(baseDir: string): string[] {
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && readdirSync(join(baseDir, e.name)).some((f) => f.endsWith(".model3.json")))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// Rebrand: present as "Xena" (not bare Electron) in the OS shell, taskbar
// grouping, and process metadata.
app.setName("Xena");
app.setAppUserModelId("com.xena.app");

// Weak iGPU target: keep Chromium from spawning extra GPU processes when possible.
app.commandLine.appendSwitch("disable-gpu-sandbox");
// Suppress noisy AMD DirectComposition error from child GPU process.
process.env.ELECTRON_ENABLE_LOGGING = "0";
process.env.ELECTRON_ENABLE_STACK_DUMPING = "0";

// Mic access for push-to-talk voice input (bar window only).
app.on("session-created", (ses) => {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "clipboard-sanitized-write");
  });
});

// Tray companion must never die to an async straggler.
process.on("unhandledRejection", () => undefined);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const config = loadConfig();
  const settings = new SettingsStore(defaultSettingsPath(join(process.cwd(), "data")));

  let bar: BarWindow | null = null;
  let shake: ShakeDetector | null = null;
let gaze: GazeTracker | null = null;

  app.on("second-instance", () => {
    bar?.summonCorner();
  });

  app.whenReady().then(() => {
    const { win: avatar } = createAvatarWindow();
    bar = new BarWindow(() => void maybeGreetBack());

    // Welcome-back: after 30+ min away, greet on corner summon (max 1/10min).
    let lastGreetAt = 0;
    const ABSENCE_MS = Number(process.env.XENA_TEST_ABSENCE_MS) || 30 * 60_000;
    const GREET_COOLDOWN_MS = Number(process.env.XENA_TEST_ABSENCE_MS) ? 0 : 10 * 60_000;
    async function maybeGreetBack(): Promise<void> {
      try {
        if (scheduler.isBusy()) return;
        if (scheduler.timeSinceInteractionMs() < ABSENCE_MS) {
          // Short absence: just a wave (max once per 10 minutes).
          if (Date.now() - lastGreetAt > 10 * 60_000) {
            lastGreetAt = Date.now();
            avatar.webContents.send(CHANNELS.avatarEmote, "happy");
          }
          return;
        }
        if (Date.now() - lastGreetAt < GREET_COOLDOWN_MS) return;
        lastGreetAt = Date.now();
        const minutes = Math.round(scheduler.timeSinceInteractionMs() / 60_000);
        const hour = new Date().getHours();
        const tod = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
        const result = await chatCompleteFailover(
          [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content:
                `The user just summoned you after ${minutes} minutes away, ${tod} time. ` +
                "Greet them back in ONE short line (max 10 words).",
            },
          ],
          { maxTokens: 500, temperature: 1.0 },
          config,
        );
        const { clean, emotion } = extractEmotion(result.content.trim());
        if (clean === "") return;
        avatar.webContents.send(CHANNELS.avatarEmote, emotion ?? "");
        avatar.webContents.send(CHANNELS.chatProactive, clean);
        const { voiceEnabled } = await settings.get();
        if (voiceEnabled) {
          const audio = await speakReply(clean, emotion ?? undefined).catch(() => null);
          if (audio) avatar.webContents.send("tts:audio", audio);
        }
      } catch {
        // greeting is best-effort
      }
    }

  const scheduler = new ProactiveScheduler(
    () => avatar,
      settings,
      config,
      async (comment, mood) => {
        const { voiceEnabled } = await settings.get();
        if (!voiceEnabled) return;
        const audio = await speakReply(comment, mood).catch(() => null);
        if (audio) avatar.webContents.send("tts:audio", audio);
      },
      async () => {
        // Flavor idle comments with a memory fragment about the last topic.
        const dataDir = join(process.cwd(), "data");
        const store = new MemoryStore(dataDir);
        const sessions = await store.listAll();
        const latest = sessions
          .sort((a, b) => (b.meta?.updatedAt ?? "").localeCompare(a.meta?.updatedAt ?? ""))
          [0];
        const lastUser = [...(latest?.messages ?? [])]
          .reverse()
          .find((m) => m.role === "user");
        if (!latest || !lastUser || typeof lastUser.content !== "string") return "";
        const hits = await new MemoryRecall(store, join(dataDir, "diary")).recall(
          lastUser.content,
          { excludeSessionId: latest.meta?.id, topK: 2 },
        );
        return renderRecallContext(hits);
      },
    );
    const gazeInstance = new GazeTracker(
      () => avatar,
      async () => (await settings.get()).avatarEnabled,
    );
    gazeInstance.start();
    gaze = gazeInstance;
    registerIpcHandlers(config, settings, scheduler, bar, () => avatar, new PointerWindow(), gaze);
    scheduler.start();
    const glances = new GlanceTimer(
      () => avatar,
      config,
      async () => (await settings.get()).ambientEnabled,
      () => scheduler.isBusy(),
      async (observation, mood) => {
        const { voiceEnabled } = await settings.get();
        if (!voiceEnabled) return;
        const audio = await speakReply(observation, mood).catch(() => null);
        if (audio) avatar.webContents.send("tts:audio", audio);
      },
      join(process.cwd(), "data", "diary"),
    );
    glances.start();

    shake = new ShakeDetector((x, y) => {
      void settings.get().then(({ shakeEnabled }) => {
        if (shakeEnabled) bar?.summonAtCursor(x, y);
      });
    });
    shake.start();

    const live2dModels = scanLive2dModels(join(__dirname, "../renderer/assets/live2d"));
    const pushLive2d = (): void => {
      void settings.get().then(({ avatarEnabled, live2dModel }) => {
        const model = live2dModel || live2dModels[0] || "hiyori";
        avatar.webContents.send("avatar:live2d", { enabled: avatarEnabled, model });
      });
    };

    createTray(bar, join(__dirname, "../renderer/assets"), settings, {
      live2dModels,
      onLive2dChange: pushLive2d,
    });
    // Restore persisted Live2D preference once the renderer is up.
    pushLive2d();

    // Ctrl+Alt+V — push-to-talk voice input toggle.
    let voiceRecording = false;
    globalShortcut.register("Control+Alt+V", () => {
      void settings.get().then(({ voiceInputEnabled }) => {
        if (!voiceInputEnabled) return;
        voiceRecording = !voiceRecording;
        // While listening, Mao looks at you instead of the cursor.
        if (voiceRecording) gaze?.lookAtUser(120_000);
        else gaze?.releaseOverride();
        bar?.win.webContents.send(CHANNELS.voiceRecordSet, voiceRecording);
      });
    });

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
    gaze?.stop();
  });

  app.on("window-all-closed", () => {
    // Tray app: keep running unless user quits from tray.
  });
}

