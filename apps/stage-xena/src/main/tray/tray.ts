/**
 * Tray icon: the settings surface. Voice, idle comments, shake trigger,
 * text model picker, chat summon, quit.
 */
import { Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
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

export function createTray(
  bar: BarWindow,
  assetsDir: string,
  settings: SettingsStore,
  configTextModel: string,
): Tray {
  const icon = nativeImage.createFromPath(join(assetsDir, "idle.png")).resize({ width: 16 });
  const tray = new Tray(icon);
  tray.setToolTip("Xena — Ctrl+Alt+X or shake cursor");

  const rebuild = async (): Promise<void> => {
    const { voiceEnabled, proactiveEnabled, shakeEnabled, textModel } = await settings.get();
    const effective = textModel || configTextModel;
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
          label: `Cursor-shake summon: ${shakeEnabled ? "ON" : "OFF"}`,
          click: () => {
            void settings.set({ shakeEnabled: !shakeEnabled }).then(() => void rebuild());
          },
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

  // Left-click summons the bar.
  tray.on("click", () => bar.summonCorner());
  return tray;
}
