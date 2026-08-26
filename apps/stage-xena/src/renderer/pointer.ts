/**
 * AI Pointer renderer: shows the pulsing cursor when told to.
 */
import { xena } from "./composables/use-xena-api.js";

const root = document.getElementById("pointer-root") as HTMLElement;
const labelEl = root.querySelector(".label") as HTMLElement;

xena.onPointerShow(({ label }) => {
  root.classList.remove("hidden");
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
});
