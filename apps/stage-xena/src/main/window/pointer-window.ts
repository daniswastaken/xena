/**
 * AI Pointer window: Xena's own cursor — a small transparent always-on-top
 * overlay showing an animated pointer at screen coordinates. Fully
 * click-through, never focusable, auto-hides after a dwell.
 */
import { BrowserWindow } from "electron";
import { join } from "node:path";
import { CHANNELS } from "../ipc/channels.js";

const SIZE = 72;
const DWELL_MS = 9000;

export class PointerWindow {
  readonly win: BrowserWindow;
  private hideTimer: NodeJS.Timeout | null = null;
  private travelTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      x: -SIZE * 2,
      y: -SIZE * 2,
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
    this.win.loadFile(join(__dirname, "../renderer/pointer.html"));
    this.win.setIgnoreMouseEvents(true);
  }

  /** Centers the pointer on absolute screen coords, gliding there smoothly. */
  pointAt(x: number, y: number, label?: string): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.travelTimer) clearInterval(this.travelTimer);
    this.win.show();
    this.win.webContents.send(CHANNELS.pointerShow, { label: label ?? "" });

    // Glide: ease-in-out tween from current position (~420ms, 60fps steps).
    const from = this.win.getBounds();
    const startX = from.x;
    const startY = from.y;
    const endX = Math.round(x - SIZE / 2);
    const endY = Math.round(y - SIZE / 2);
    const dist = Math.hypot(endX - startX, endY - startY);
    if (dist < 40) {
      this.win.setPosition(endX, endY, false);
    } else {
      const durationMs = Math.min(650, 220 + dist * 0.35);
      const steps = Math.max(8, Math.round(durationMs / 16));
      let step = 0;
      this.travelTimer = setInterval(() => {
        step++;
        const t = Math.min(1, step / steps);
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // quad in-out
        this.win.setPosition(
          Math.round(startX + (endX - startX) * eased),
          Math.round(startY + (endY - startY) * eased),
          false,
        );
        if (t >= 1) {
          if (this.travelTimer) clearInterval(this.travelTimer);
          this.travelTimer = null;
        }
      }, 16);
    }

    this.hideTimer = setTimeout(() => {
      this.win.hide();
      this.hideTimer = null;
    }, DWELL_MS + Math.min(650, 220 + dist * 0.35));
  }

  hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.travelTimer) clearInterval(this.travelTimer);
    this.travelTimer = null;
    this.win.hide();
  }
}
