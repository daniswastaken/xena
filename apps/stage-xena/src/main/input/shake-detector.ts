/**
 * Cursor-shake detection: rapid back-and-forth mouse movement summons
 * the bar at the cursor. Polls at ~80ms — negligible CPU on weak hardware.
 */
import { screen } from "electron";

interface Point {
  x: number;
  y: number;
  t: number;
}

const POLL_MS = 80;
const WINDOW_MS = 700;
const MIN_REVERSALS = 4;
const MIN_TRAVEL = 80;
const MIN_SEGMENT = 8;
const DEBOUNCE_MS = 2500;

export class ShakeDetector {
  private timer: NodeJS.Timeout | null = null;
  private trail: Point[] = [];
  private lastFire = 0;

  constructor(private readonly onShake: (x: number, y: number) => void) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = Date.now();
    const p = screen.getCursorScreenPoint();
    this.trail.push({ x: p.x, y: p.y, t: now });
    while (this.trail.length > 0 && now - (this.trail[0] as Point).t > WINDOW_MS) {
      this.trail.shift();
    }
    if (this.trail.length < 6) return;
    if (now - this.lastFire < DEBOUNCE_MS) return;

    // Count direction flips on the dominant axis; ignore sub-threshold noise.
    const pts = this.trail as Point[];
    let dx = 0;
    let dy = 0;
    for (let i = 1; i < pts.length; i++) {
      dx += Math.abs(pts[i]!.x - pts[i - 1]!.x);
      dy += Math.abs(pts[i]!.y - pts[i - 1]!.y);
    }
    const axis: "x" | "y" = dy > dx ? "y" : "x";
    const other: "x" | "y" = axis === "x" ? "y" : "x";

    let reversals = 0;
    let travel = 0;
    let lastSign = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i]![axis] - pts[i - 1]![axis];
      travel += Math.abs(d) + Math.abs(pts[i]![other] - pts[i - 1]![other]);
      if (Math.abs(d) < MIN_SEGMENT) continue;
      const s = Math.sign(d);
      if (lastSign !== 0 && s !== lastSign) reversals++;
      lastSign = s;
    }

    if (reversals >= MIN_REVERSALS && travel >= MIN_TRAVEL) {
      this.lastFire = now;
      this.trail = [];
      // Trail is up to POLL_MS stale — read the cursor fresh at trigger time.
      const cur = screen.getCursorScreenPoint();
      this.onShake(cur.x, cur.y);
    }
  }
}
