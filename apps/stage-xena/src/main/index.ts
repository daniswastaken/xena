/**
 * Xena main process entry.
 */
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
import { app, globalShortcut } from "electron";
import { join } from "node:path";
import { dataDir, envDir } from "./paths.js";
import { createAvatarWindow } from "./window/overlay.js";
import { BarWindow } from "./window/bar-window.js";
import { PointerWindow } from "./window/pointer-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/tray.js";
import { loadInferenceConfig, refreshInPlace, supervisor, resetInference, NineRouterChild, applyRuntimeOverrides, setEnvDir } from "@xena/inference-gateway";
import { chatCompleteFailover } from "@xena/inference-gateway";
import { MemoryStore, MemoryRecall, renderRecallContext, extractEmotion, buildSystemPrompt } from "@xena/xena-core";
import { SettingsStore, defaultSettingsPath } from "./settings/store.js";
import { ProactiveScheduler } from "./proactive/scheduler.js";
import { speakReply } from "./tts/speak.js";
import { ShakeDetector } from "./input/shake-detector.js";
import { GazeTracker } from "./input/gaze-tracker.js";
import { GlanceTimer } from "./ambient/glance.js";import { CHANNELS } from "./ipc/channels.js";
import { ipcMain } from "electron";
import { SetupFlow } from "./setup/setup.js";

/** The one and only Live2D model directory name (Mao). */
const LIVE2D_MODEL = "mao";

// Rebrand: present as "Xena" (not bare Electron) in the OS shell, taskbar
// grouping, and process metadata.
app.setName("Xena");
app.setAppUserModelId("com.xena.app");

// Weak iGPU target: keep Chromium from spawning extra GPU processes when possible.
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("log-level", "3");

// Suppress noisy AMD DirectComposition error from child GPU process.
process.env.ELECTRON_ENABLE_LOGGING = "0";
process.env.ELECTRON_ENABLE_STACK_DUMPING = "0";

// Tray companion must never die to an async straggler.
process.on("unhandledRejection", () => undefined);

// Sandbox/driver debug surface: CDP on 9223 when XENA_CDP=1.
if (process.env.XENA_CDP === "1") {
  app.commandLine.appendSwitch("remote-debugging-port", "9223");
}

// Debug log: mirror console lines to userData/xena-main.log when XENA_LOG=1
// (packaged runs have no visible console — sandbox/driver E2E needs traces).
if (process.env.XENA_LOG === "1") {
  const { appendFileSync } = require("node:fs") as typeof import("node:fs");
  const logPath = join(app.getPath("userData"), "xena-main.log");
  const tee = (orig: (...data: unknown[]) => void, tag: string): ((...data: unknown[]) => void) => {
    return (...data: unknown[]) => {
      orig(...data);
      try {
        const parts = data.map((d) => {
          if (typeof d === "string") return d;
          if (d instanceof Error) return `${d.name}: ${d.message}\n${d.stack ?? ""}`;
          try {
            return JSON.stringify(d);
          } catch {
            return String(d);
          }
        });
        appendFileSync(logPath, `[${new Date().toISOString()}] [${tag}] ${parts.join(" ")}\n`);
      } catch {
        /* best-effort */
      }
    };
  };
  console.log = tee(console.log.bind(console), "log");
  console.error = tee(console.error.bind(console), "error");
  try {
    appendFileSync(logPath, `=== Xena main start ${new Date().toISOString()} ===\n`);
  } catch {
    /* best-effort */
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Packaged boot: .env lives next to the installed exe — point the reader
  // there before the first load (dev keeps walking up to the repo root).
  setEnvDir(envDir());
  const config = loadInferenceConfig();
  const settings = new SettingsStore(defaultSettingsPath(dataDir()));
  // Persisted Gemini key (from first-run setup) overlays file/env values;
  // process env still wins (dev machines, power users).
  console.log(`[inference] settings path: ${defaultSettingsPath(dataDir())}`);
  void settings.get().then((persisted) => {
    const before = config.geminiApiKey;
    applyRuntimeOverrides(config, { geminiApiKey: persisted.geminiApiKey });
    console.log(
      `[inference] gemini key: env=${process.env.XENA_GEMINI_API_KEY ? "yes" : "no"} settings=${persisted.geminiApiKey ? "yes" : "no"} applied=${before ? "yes" : "no"} -> ${config.geminiApiKey ? "active" : "none"}`,
    );
  });

  let bar: BarWindow | null = null;
  let shake: ShakeDetector | null = null;
  let gaze: GazeTracker | null = null;
  // Xena owns the 9Router gateway now: spawn with the app, kill with it.
  let nineRouter: NineRouterChild | null = null;

  let setupActive = false;
  app.on("second-instance", () => {
    bar?.summonCorner();
  });

  app.whenReady().then(async () => {
    const { win: avatar } = createAvatarWindow();
    bar = new BarWindow(() => void maybeGreetBack());

    // Scheduler + gaze FIRST: the setup-flow onDone callback fires
    // synchronously for non-first-run boots and touches the scheduler, so it
    // must exist before SetupFlow is constructed. (Declaring it after the
    // setup block was a TDZ ReferenceError that aborted the whole boot chain
    // on every machine that already had .firstrun — no IPC handlers, no
    // tray, "Xena can't reach her brain".)
    let schedulerStarted = false;
    const startScheduler = (): void => {
      if (schedulerStarted) return;
      schedulerStarted = true;
      scheduler.start();
    };

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
        const dir = dataDir();
        const store = new MemoryStore(dir);
        const sessions = await store.listAll();
        const latest = sessions
          .sort((a, b) => (b.meta?.updatedAt ?? "").localeCompare(a.meta?.updatedAt ?? ""))
          [0];
        const lastUser = [...(latest?.messages ?? [])]
          .reverse()
          .find((m) => m.role === "user");
        if (!latest || !lastUser || typeof lastUser.content !== "string") return "";
        const hits = await new MemoryRecall(store, join(dir, "diary")).recall(
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

    // Register IPC handlers BEFORE the setup flow runs: renderer pages load
    // immediately and probe channels (live2d-get) — a missing handler logged
    // an error and any early chat send was dropped during boot.
    registerIpcHandlers(config, settings, scheduler, bar, () => avatar, new PointerWindow(), gaze);

    // First-run setup flow. All UI lives in the avatar window — bar stays hidden
    // until the flow finishes (or is skipped on non-first-run).
    const setup = new SetupFlow(avatar, settings, config, () => {
      // onDone is the only place we start the scheduler — whether first run or not.
      // For non-first-run, called immediately by setup.start().
      setupActive = false;
      avatar.setIgnoreMouseEvents(true, { forward: true });
      startScheduler();
    });
    // Wire IPC before starting setup.
    ipcMain.on(CHANNELS.setupSubmit, (_e, text: unknown) => {
      if (typeof text === "string") setup.onInput(text);
    });
    ipcMain.on(CHANNELS.setupBack, () => setup.onBack());
    ipcMain.on(CHANNELS.setupAudioEnd, () => setup.onAudioEnd());
    // 9Router child is independent of setup — start it now.
    nineRouter = new NineRouterChild(config, {
      onState: (state) => console.log(`[inference] 9router child: ${state}`),
    });
    nineRouter.start();
    // Begin setup logic — resolves firstRun and calls onDone for non-first-run.
    const firstRun = await setup.start();
    if (firstRun) {
      setupActive = true;
      // Setup needs the yes/no + key input clickable — temporarily lift
      // click-through from the avatar window so its DOM receives mouse events.
      avatar.setIgnoreMouseEvents(false);
    }
    // Wait for the avatar page to fully load before firing the greeting so its
    // setup listeners are subscribed before the first IPC arrives.
    avatar.webContents.on("did-finish-load", () => {
      avatar.webContents.send(CHANNELS.setupBegin);
      setup.sendStep("greeting");
      setup.sendBubble("Oh, Father! You're looking for me? Eh, you have something to give?", "surprised");
    });

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
      join(dataDir(), "diary"),
    );
    void glances;
    // Unified initiative clock: every 5-7 min either an ambient glance or
    // an AI-initiated comment (coin flip, per-feature settings gate each).
    scheduler.setGlanceHook(() => glances.glanceNow());

    shake = new ShakeDetector((x, y) => {
      void settings.get().then(({ shakeEnabled }) => {
        if (setupActive) return;
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


