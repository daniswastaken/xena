/**
 * Speech bubble: Xena's replies render here, anchored to her head.
 * Hover makes it interactive (scroll/select/copy); otherwise click-through.
 */
import { xena } from "../../composables/use-xena-api.js";

const bubble = document.getElementById("bubble") as HTMLElement;
const nameEl = document.getElementById("bubble-name") as HTMLDivElement;
const reasonEl = document.getElementById("bubble-reason") as HTMLDivElement;
const textEl = document.getElementById("bubble-text") as HTMLDivElement;
const copyBtn = document.getElementById("bubble-copy") as HTMLButtonElement;

let fadeTimer: number | null = null;
let autoFadeTimer: number | null = null;
let outTimer: number | null = null;
let interactiveNow = false;

function setInteractive(on: boolean): void {
  if (on === interactiveNow) return;
  interactiveNow = on;
  xena.setClickThrough(on);
  copyBtn.classList.toggle("hidden", !on || textEl.textContent === "");
}

/** Bring the bubble on stage, cancelling any in-flight exit animation. */
function presentBubble(): void {
  if (outTimer !== null) {
    window.clearTimeout(outTimer);
    outTimer = null;
  }
  bubble.classList.remove("out");
  bubble.classList.remove("hidden");
}

export function showBubble(text: string, isError = false): void {
  const effective = text.trim() === "" ? "" : text;
  textEl.innerHTML = effective === "" ? "" : renderMarkdown(effective);
  textEl.classList.toggle("error", isError);
  bubble.classList.remove("thinking");
  nameEl.classList.remove("hidden");
  reasonEl.classList.add("hidden");
  if (effective !== "") presentBubble();
  else bubble.classList.add("hidden");
  copyBtn.classList.toggle("hidden", !interactiveNow || effective === "");
  textEl.scrollTop = textEl.scrollHeight;
}

/** Reasoning indicator: italic "thinking..." while she works.
 *  Off clears the reasoning without touching the text. */
export function setThinking(on: boolean): void {
  if (!on) {
    bubble.classList.remove("thinking");
    reasonEl.classList.add("hidden");
    return;
  }
  if (bubble.classList.contains("thinking")) return;
  textEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  textEl.classList.remove("error");
  nameEl.classList.add("hidden");
  reasonEl.textContent = "thinking...";
  reasonEl.classList.remove("hidden");
  bubble.classList.add("thinking");
  presentBubble();
  copyBtn.classList.add("hidden");
}

/** Mood accent: bubble border tints with her current emotion. */
export function setMood(emotion: string): void {
  if (emotion === "") bubble.removeAttribute("data-mood");
  else bubble.setAttribute("data-mood", emotion);
}

/** Reading-time fade: 8s base + 20ms/char, capped at 28s. Supersedes the
 *  idle auto-fade — otherwise the 12s leash kills long replies early. */
export function scheduleBubbleFade(delayMs: number): void {
  if (autoFadeTimer !== null) {
    window.clearTimeout(autoFadeTimer);
    autoFadeTimer = null;
  }
  if (fadeTimer !== null) window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => hideBubble(), delayMs);
}

export function cancelBubbleFade(): void {
  if (fadeTimer !== null) {
    window.clearTimeout(fadeTimer);
    fadeTimer = null;
  }
}

export function hideBubble(): void {
  if (fadeTimer !== null) {
    window.clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  if (autoFadeTimer !== null) {
    window.clearTimeout(autoFadeTimer);
    autoFadeTimer = null;
  }
  if (bubble.classList.contains("hidden") || outTimer !== null) return;
  bubble.classList.add("out");
  // Wait out the exit animation before the display:none swap.
  outTimer = window.setTimeout(() => {
    outTimer = null;
    bubble.classList.remove("out");
    bubble.classList.add("hidden");
    setInteractive(false);
  }, 150);
}

/** Arms the 12s no-activity fade (proactive/glance one-shots). */
export function armAutoFade(): void {
  if (autoFadeTimer !== null) window.clearTimeout(autoFadeTimer);
  autoFadeTimer = window.setTimeout(() => hideBubble(), 12_000);
}

function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/(https?:\/\/[^\s<]+)/g, (m) => {
      const safe = m.replace(/[.,!?]+$/, "");
      const trail = m.slice(safe.length);
      return `<a href="#" data-url="${safe}">${safe}</a>${trail}`;
    })
    .replace(/\n/g, "<br>");
}

textEl.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest("a[data-url]") as HTMLAnchorElement | null;
  if (a) {
    e.preventDefault();
    void xena.openExternal(a.dataset.url ?? "");
  }
});

copyBtn.addEventListener("click", () => {
  const text = textEl.textContent ?? "";
  if (text === "") return;
  void navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "copied!";
    window.setTimeout(() => {
      copyBtn.textContent = "copy";
    }, 1200);
  });
});

// Hover-interactivity over the bubble only.
document.addEventListener("mousemove", (event) => {
  const target = event.target as Element | null;
  setInteractive(target !== null && (bubble.contains(target) || target === copyBtn));
  if (interactiveNow) {
    // Scrolling keeps the bubble alive.
    if (autoFadeTimer !== null) armAutoFade();
  }
});
