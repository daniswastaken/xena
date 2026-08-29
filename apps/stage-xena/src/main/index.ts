/**
 * Xena main process entry.
 */
import { app, globalShortcut } from "electron";
import { join } from "node:path";
import { createAvatarWindow } from "./window/overlay.js";
import { BarWindow } from "./window/bar-window.js";
import { PointerWindow } from "./window/pointer-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/tray.js";
import { loadInferenceConfig, refreshInPlace, supervisor, resetInference, NineRouterChild } from "@xena/inference-gateway";
import { chatCompleteFailover } from "@xena/inference-gateway";
import { MemoryStore, MemoryRecall, renderRecallContext, extractEmotion, buildSystemPrompt } from "@xena/xena-core";
import { SettingsStore, defaultSettingsPath } from "./settings/store.js";
import { ProactiveScheduler } from "./proactive/scheduler.js";
import { speakReply } from "./tts/speak.js";
import { ShakeDetector } from "./input/shake-detector.js";
import { GazeTracker } from "./input/gaze-tracker.js";
import { GlanceTimer } from "./ambient/glance.js";import { CHANNELS } from "./ipc/channels.js";

/** The one and only Live2D model directory name (Mao). */
const LIVE2D_MODEL = "mao";

// Rebrand: present as "Xena" (not bare Electron) in the OS shell, taskbar
// grouping, and process metadata.
app.setName("Xena");
app.setAppUserModelId("com.xena.app");

// Weak iGPU target: keep Chromium from spawning extra GPU processes when possible.
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("log-level", "3");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Suppress noisy AMD DirectComposition error from child GPU process.
process.env.ELECTRON_ENABLE_LOGGING = "0";
process.env.ELECTRON_ENABLE_STACK_DUMPING = "0";

// Tray companion must never die to an async straggler.
process.on("unhandledRejection", () => undefined);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const config = loadInferenceConfig();
  const settings = new SettingsStore(defaultSettingsPath(join(process.cwd(), "data")));

  let bar: BarWindow | null = null;
  let shake: ShakeDetector | null = null;
  let gaze: GazeTracker | null = null;
  // Xena owns the 9Router gateway now: spawn with the app, kill with it.
  let nineRouter: NineRouterChild | null = null;

  app.on("second-instance", () => {
    bar?.summonCorner();
  });

  app.whenReady().then(() => {
    const { win: avatar } = createAvatarWindow();
    bar = new BarWindow(() => void maybeGreetBack());

    // Unified launch: inference comes up with Xena. Gemini/Pollinations are
    // plain HTTPS (instantly up); the 9Router child is spawned + supervised.
    nineRouter = new NineRouterChild(config, {
      onState: (state) => console.log(`[inference] 9router child: ${state}`),
    });
    nineRouter.start();

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
          { maxTokens: 70, temperature: 1.0 },
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
    // Glances are initiatives fired by the unified scheduler clock.
    const glances = new GlanceTimer(
      () => avatar,
      config,
      () => scheduler.isBusy(),
      async (observation, mood) => {
        const { voiceEnabled } = await settings.get();
        if (!voiceEnabled) return;
        const audio = await speakReply(observation, mood).catch(() => null);
        if (audio) avatar.webContents.send("tts:audio", audio);
      },
      join(process.cwd(), "data", "diary"),
    );
    void glances;
    // Unified initiative clock: every 5-7 min either an ambient glance or
    // an AI-initiated comment (coin flip, per-feature settings gate each).
    scheduler.setGlanceHook(() => glances.glanceNow());
    scheduler.start();

    shake = new ShakeDetector((x, y) => {
      void settings.get().then(({ shakeEnabled }) => {
        if (shakeEnabled) bar?.summonAtCursor(x, y);
      });
    });
    shake.start();

    const pushLive2d = (): void => {
      void settings.get().then(({ avatarEnabled }) => {
        avatar.webContents.send("avatar:live2d", { enabled: avatarEnabled, model: LIVE2D_MODEL });
      });
    };

    createTray(bar, join(__dirname, "../renderer/assets"), settings, {
      onLive2dChange: pushLive2d,
    }, {
      statusLine: () =>
        `${supervisor.describe()}${nineRouter && nineRouter.currentState !== "disabled" ? ` | child: ${nineRouter.currentState}` : ""}`,
      onRestart: () => {
        // Self-recovery: clear penalties/evictions, re-read .env in place,
        // respawn the child. Never restarts Xena itself.
        refreshInPlace(config);
        resetInference();
        nineRouter?.dispose();
        nineRouter = new NineRouterChild(config, {
          onState: (state) => console.log(`[inference] 9router child: ${state}`),
        });
        nineRouter.start();
      },
    });
    // Restore persisted Live2D preference once the renderer is up.
    pushLive2d();

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
    nineRouter?.dispose();
  });

  app.on("window-all-closed", () => {
    // Tray app: keep running unless user quits from tray.
  });
}

