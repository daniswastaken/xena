/**
 * AI Pointer window: a transparent overlay covering the target display. The
 * cursor is a DOM element inside it, glided with CSS transforms
 * (GPU-composited) instead of per-frame window moves. Fully click-through,
 * never focusable.
 */
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { CHANNELS } from "../ipc/channels.js";

const DWELL_MS = 9000;
const EXIT_MS = 520;

export class PointerWindow {
  readonly win: BrowserWindow;
  private readonly ready: Promise<void>;
  private hideTimer: NodeJS.Timeout | null = null;

  constructor() {
    const b = screen.getPrimaryDisplay().bounds;
    this.win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      icon: join(__dirname, "../renderer/assets/app-icon.png"),
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
      focusable: false,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.setIgnoreMouseEvents(true);
    this.ready = this.win.loadFile(join(__dirname, "../renderer/pointer.html"));
  }

  /** Show the cursor at absolute screen coords; renderer glides it there. */
  async pointAt(x: number, y: number, label?: string, dwellMs = DWELL_MS): Promise<void> {
    await this.ready;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    // Cover the display the target lives on. Windows clamps hidden windows to
    // the work area, so show first, then size to the full display (incl. taskbar).
    const b = screen.getDisplayNearestPoint({ x, y }).bounds;
    this.win.show();
    const cur = this.win.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
      this.win.setBounds(b);
    }
    this.win.webContents.send(CHANNELS.pointerShow, {
      x: x - b.x,
      y: y - b.y,
      label: label ?? "",
      dwellMs,
    });
  }

  /** Spin the pointer out after a guided task ends. */
  finish(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.win.webContents.send(CHANNELS.pointerHide);
      this.hideTimer = setTimeout(() => {
        this.win.hide();
        this.hideTimer = null;
      }, EXIT_MS);
    }, 200);
  }

  hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.win.webContents.send(CHANNELS.pointerHide);
    this.win.hide();
  }
}
