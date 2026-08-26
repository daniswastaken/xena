/**
 * Avatar window: transparent, frameless, always-on-top, permanently pinned
 * bottom-right and fully click-through. The avatar never moves.
 */
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { CHANNELS } from "../ipc/channels.js";

export const WINDOW_WIDTH = 460;
export const WINDOW_HEIGHT = 400;
export const AVATAR_MARGIN = 0;

export interface AvatarHome {
  x: number;
  y: number;
}

export function createAvatarWindow(): { win: BrowserWindow; home: AvatarHome } {
  const { workArea } = screen.getPrimaryDisplay();
  const home: AvatarHome = {
    x: workArea.x + workArea.width - WINDOW_WIDTH - AVATAR_MARGIN,
    y: workArea.y + workArea.height - WINDOW_HEIGHT - AVATAR_MARGIN,
  };
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: home.x,
    y: home.y,
    transparent: true,
    frame: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    roundedCorners: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(join(__dirname, "../renderer/index.html"));
  win.once("ready-to-show", () => win.showInactive());
  // Click-through by default; the bubble surface flips interactivity
  // on hover (scroll/select/copy) via the renderer.
  win.setIgnoreMouseEvents(true, { forward: true });
  void win.webContents.ipc.on(CHANNELS.setClickThrough, (_e, interactive: unknown) => {
    if (typeof interactive === "boolean") {
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    }
  });
  // Always-on companion: a crashed renderer comes back on its own.
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload();
    }, 1500);
  });
  return { win, home };
}
