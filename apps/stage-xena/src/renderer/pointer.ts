/**
 * AI Pointer renderer: fullscreen overlay; the cursor SVG always enters at
 * the display center and glides to the requested local coordinates with a
 * CSS transform transition, ripples on arrival, spins out when told to hide.
 */
import { xena } from "./composables/use-xena-api.js";

const root = document.getElementById("pointer-root") as HTMLElement;
const cursor = root.querySelector(".cursor") as HTMLElement;
const labelEl = root.querySelector(".label") as HTMLElement;

let cx = 0;
let cy = 0;
let hasEntered = false;
let dwellTimer: number | null = null;

function travelMs(x: number, y: number): number {
  const d = Math.hypot(x - cx, y - cy);
  return Math.min(650, 220 + d * 0.35);
}

xena.onPointerShow(({ x, y, label, dwellMs }) => {
  if (dwellTimer) window.clearTimeout(dwellTimer);
  root.classList.remove("leaving");
  root.classList.remove("hidden");

  if (!hasEntered) {
    // Always enter from screen center and glide — never teleport in.
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    cx = w / 2;
    cy = h / 2;
    cursor.style.transition = "none";
    cursor.style.transform = `translate(${cx}px, ${cy}px)`;
    void cursor.offsetWidth; // flush the center position before the glide
    hasEntered = true;
  }

  const t = travelMs(x, y);
  cursor.style.transition = `transform ${t}ms cubic-bezier(0.33, 1, 0.68, 1)`;
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  cx = x;
  cy = y;

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
  // Next appearance starts a fresh center-to-target glide.
  hasEntered = false;
});
