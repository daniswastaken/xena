/**
 * Tray icon: the settings surface. Voice, idle comments, shake trigger,
 * chat summon, inference status + restart, quit.
 */
import { app, Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import type { SettingsStore } from "../settings/store.js";
import type { BarWindow } from "../window/bar-window.js";

export interface Live2dTrayHooks {
  /** folder names under assets/live2d/ with a model3.json */
  live2dModels: string[];
  /** called after any live2d setting change so main can push to renderer */
  onLive2dChange: () => void;
}

export interface InferenceTrayHooks {
  /** One-line technical diagnostics (allowed raw detail here). */
  statusLine: () => string;
  /** Full self-recovery: clear penalties, re-read config, respawn child. */
  onRestart: () => void;
}

export function createTray(
  bar: BarWindow,
  assetsDir: string,
  settings: SettingsStore,
  live2d: Live2dTrayHooks,
  inference?: InferenceTrayHooks,
): Tray {
  const icon = nativeImage.createFromPath(join(assetsDir, "app-icon.png")).resize({ width: 16 });
  const tray = new Tray(icon);
  tray.setToolTip("Xena — Ctrl+Alt+X or shake cursor");

  const rebuild = async (): Promise<void> => {
    const { voiceEnabled, proactiveEnabled, shakeEnabled, avatarEnabled, autostartEnabled, ambientEnabled, voiceInputEnabled } =
      await settings.get();
    const inferenceItems = inference
      ? ([
          { type: "separator" } as Electron.MenuItemConstructorOptions,
          {
            label: `Inference: ${inference.statusLine()}`,
            enabled: false,
          },
          {
            label: "Restart inference",
            click: () => inference.onRestart(),
          },
        ] as Electron.MenuItemConstructorOptions[])
      : [];
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Summon bar (Ctrl+Alt+X)",
          click: () => bar.summonCorner(),
        },
        { type: "separator" },
        {
          label: `Voice: ${voiceEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings.set({ voiceEnabled: !voiceEnabled }).then(() => void rebuild());
          },
        },
        {
          label: `Idle comments: ${proactiveEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings.set({ proactiveEnabled: !proactiveEnabled }).then(() => void rebuild());
          },
        },
        {
          label: `Ambient screen glances: ${ambientEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings.set({ ambientEnabled: !ambientEnabled }).then(() => void rebuild());
          },
        },
        {
          label: `Cursor-shake summon: ${shakeEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings.set({ shakeEnabled: !shakeEnabled }).then(() => void rebuild());
          },
        },
        {
          label: `Avatar: ${avatarEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings
              .set({ avatarEnabled: !avatarEnabled })
              .then(() => {
                live2d.onLive2dChange();
                return rebuild();
              })
              .catch(() => undefined);
          },
        },
        {
          label: `Start with Windows: ${autostartEnabled ? "ON" : "OFF"}`,
          click: () => {
            const next = !autostartEnabled;
            app.setLoginItemSettings({ openAtLogin: next });
            void settings.set({ autostartEnabled: next }).then(() => void rebuild());
          },
        },
        {
          label: `Voice input (Ctrl+Alt+V): ${voiceInputEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings.set({ voiceInputEnabled: !voiceInputEnabled }).then(() => void rebuild());
          },
        },
        ...inferenceItems,
        { type: "separator" },
        { label: "Quit Xena", role: "quit" },
      ]),
    );
  };
  void rebuild();

  // Left-click shows context menu on Windows (right-click is default elsewhere).
  tray.on("click", () => tray.popUpContextMenu());

  return tray;
}
