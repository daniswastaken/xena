/**
 * Gaze tracking: polls the cursor and reports its position relative to the
 * avatar so the Live2D model can watch the user. Polls at 120ms and only
 * emits when the cursor moved meaningfully — negligible CPU.
 */
import { screen } from "electron";
import type { BrowserWindow } from "electron";
import { CHANNELS } from "../ipc/channels.js";

const POLL_MS = 120;
const MIN_DELTA = 0.02; // normalized units

export class GazeTracker {
  private timer: NodeJS.Timeout | null = null;
  private last = { dx: 0, dy: 0 };
  /** When set, Mao looks here instead of the cursor until the expiry. */
  private override: { dx: number; dy: number; until: number } | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly isEnabled: () => Promise<boolean>,
  ) {}

  /** Makes the model glance at an absolute screen point for a while. */
  lookAtPoint(x: number, y: number, holdMs = 3500): void {
    this.override = this.pointToGaze(x, y, holdMs);
    const win = this.getWindow();
    if (this.override && win && !win.isDestroyed()) {
      win.webContents.send(CHANNELS.gazeUpdate, {
        dx: this.override.dx,
        dy: this.override.dy,
        hold: holdMs,
      });
    }
  }

  /** Ends any gaze override; cursor tracking resumes. */
  releaseOverride(): void {
    this.override = null;
  }

  private pointToGaze(x: number, y: number, holdMs: number): { dx: number; dy: number; until: number } {
    const win = this.getWindow();
    const b = win && !win.isDestroyed() ? win.getBounds() : { x: 0, y: 0, width: 188, height: 188 };
    const faceX = b.x + b.width / 2;
    const faceY = b.y + b.height * 0.35;
    const span = screen.getPrimaryDisplay().workArea.width;
    const dx = Math.max(-1, Math.min(1, (x - faceX) / (span / 2)));
    const dy = Math.max(-1, Math.min(1, (y - faceY) / (span / 2)));
    return { dx, dy, until: Date.now() + holdMs };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    if (!(await this.isEnabled())) return;
    if (this.override && Date.now() < this.override.until) return; // holding a glance
    this.override = null;
    const cursor = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // Avatar's face sits near the window's top-center.
    const faceX = b.x + b.width / 2;
    const faceY = b.y + b.height * 0.35;
    const span = screen.getPrimaryDisplay().workArea.width;
    const dx = Math.max(-1, Math.min(1, (cursor.x - faceX) / (span / 2)));
    const dy = Math.max(-1, Math.min(1, (cursor.y - faceY) / (span / 2)));
    if (Math.abs(dx - this.last.dx) < MIN_DELTA && Math.abs(dy - this.last.dy) < MIN_DELTA) return;
    this.last = { dx, dy };
    win.webContents.send(CHANNELS.gazeUpdate, { dx, dy });
  }
}
