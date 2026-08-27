/**
 * AI Pointer renderer: fullscreen overlay; glides the cursor SVG to the
 * requested local coordinates with a CSS transform transition, ripples on
 * arrival, spins out when told to hide.
 */
import { xena } from "./composables/use-xena-api.js";

const root = document.getElementById("pointer-root") as HTMLElement;
const cursor = root.querySelector(".cursor") as HTMLElement;
const labelEl = root.querySelector(".label") as HTMLElement;

let cx = 0;
let cy = 0;
let hasMoved = false;
let dwellTimer: number | null = null;

function travelMs(x: number, y: number): number {
  const d = Math.hypot(x - cx, y - cy);
  return Math.min(650, 220 + d * 0.35);
}

xena.onPointerShow(({ x, y, label, dwellMs }) => {
  if (dwellTimer) window.clearTimeout(dwellTimer);
  root.classList.remove("leaving");
  root.classList.remove("hidden");

  const t = travelMs(x, y);
  if (hasMoved) {
    cursor.style.transition = `transform ${t}ms cubic-bezier(0.33, 1, 0.68, 1)`;
  } else {
    cursor.style.transition = "none";
  }
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  cx = x;
  cy = y;
  hasMoved = true;

  // "click here" affordance on every arrival.
  root.classList.remove("arriving");
  void root.offsetWidth; // restart the animation
  root.classList.add("arriving");
  window.setTimeout(() => root.classList.remove("arriving"), 750);

  if (label) {
    labelEl.textContent = label;
    labelEl.classList.remove("hidden");
  } else {
    labelEl.classList.add("hidden");
  }

  if (dwellMs > 0) {
    dwellTimer = window.setTimeout(() => root.classList.add("hidden"), dwellMs + t);
  }
});

xena.onPointerHide(() => {
  if (dwellTimer) window.clearTimeout(dwellTimer);
  root.classList.remove("arriving");
  root.classList.add("leaving");
});
