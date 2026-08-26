/**
 * Tray icon: the settings surface. Voice, idle comments, shake trigger,
 * text model picker, chat summon, quit.
 */
import { app, Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import { VOICES } from "@xena/tts";
import type { SettingsStore } from "../settings/store.js";
import type { BarWindow } from "../window/bar-window.js";

const TEXT_MODELS = [
  "oc/big-pickle",
  "oc/deepseek-v4-flash-free",
  "oc/x-preview-f-free",
  "oc/muse-spark-1.2-contributor-free",
  "oc/mimo-v2.5-free",
  "oc/hy3-free",
  "oc/nemotron-3-ultra-free",
  "oc/nemotron-3.5-lightning-free",
  "oc/laguna-s-2.1-free",
] as const;

export interface Live2dTrayHooks {
  /** folder names under assets/live2d/ with a model3.json */
  live2dModels: string[];
  /** called after any live2d setting change so main can push to renderer */
  onLive2dChange: () => void;
}

export function createTray(
  bar: BarWindow,
  assetsDir: string,
  settings: SettingsStore,
  configTextModel: string,
  live2d: Live2dTrayHooks,
): Tray {
  const icon = nativeImage.createFromPath(join(assetsDir, "tray-icon.png")).resize({ width: 16 });
  const tray = new Tray(icon);
  tray.setToolTip("Xena — Ctrl+Alt+X or shake cursor");

  const rebuild = async (): Promise<void> => {
    const { voiceEnabled, proactiveEnabled, shakeEnabled, live2dEnabled, live2dModel, autostartEnabled, ttsVoice, ambientEnabled, voiceInputEnabled, textModel } =
      await settings.get();
    const effective = textModel || configTextModel;
    const effectiveVoice = ttsVoice || VOICES[0];
    const effectiveL2d = live2dModel || live2d.live2dModels[0] || "hiyori";
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
          label: `Live2D avatar (experimental): ${live2dEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings
              .set({ live2dEnabled: !live2dEnabled })
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
          label: "Live2D model",
          submenu: live2d.live2dModels.map((name) => ({
            label: name,
            type: "radio" as const,
            checked: name === effectiveL2d,
            click: () => {
              void settings
                .set({ live2dModel: name })
                .then(() => {
                  live2d.onLive2dChange();
                  return rebuild();
                })
                .catch(() => undefined);
            },
          })),
        },
        {
          label: `Voice input (Ctrl+Alt+V): ${voiceInputEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings.set({ voiceInputEnabled: !voiceInputEnabled }).then(() => void rebuild());
          },
        },
        {
          label: "Voice",
          submenu: [
            ...VOICES.map((id) => ({
              label: id.replace("Neural", "").replace("en-US-", "").replace("en-GB-", "UK ").replace("ja-JP-", "JP "),
              type: "radio" as const,
              checked: id === effectiveVoice,
              click: () => {
                void settings.set({ ttsVoice: id }).then(() => void rebuild());
              },
            })),
          ],
        },
        {
          label: "Model",
          submenu: TEXT_MODELS.map((id) => ({
            label: id,
            type: "radio" as const,
            checked: id === effective,
            click: () => {
              void settings.set({ textModel: id }).then(() => void rebuild());
            },
          })),
        },
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

