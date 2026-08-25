/**
 * Summon bar: Spotlight-style single-line input with inline streaming
 * answers. Bottom-anchored so it hugs the avatar below. Auto-fades on
 * idle or after an answer settles.
 */
import { xena } from "./composables/use-xena-api.js";

const FADE_AFTER_ANSWER_MS = 8000;
const FADE_IDLE_MS = 10000;

const wrap = document.getElementById("bar-wrap") as HTMLElement;
const input = document.getElementById("bar-input") as HTMLInputElement;
const dot = document.getElementById("bar-dot") as HTMLElement;
const answer = document.getElementById("answer") as HTMLDivElement;

let fadeTimer: number | null = null;
let busy = false;
let interactiveNow = false;

function setInteractive(on: boolean): void {
  if (on === interactiveNow) return;
  interactiveNow = on;
  xena.setClickThrough(on);
}

function cancelFade(): void {
  if (fadeTimer !== null) {
    window.clearTimeout(fadeTimer);
    fadeTimer = null;
  }
}

function scheduleFade(delayMs: number): void {
  cancelFade();
  fadeTimer = window.setTimeout(() => {
    wrap.classList.add("fading");
    fadeTimer = window.setTimeout(hide, 240);
  }, delayMs);
}

function show(): void {
  cancelFade();
  wrap.classList.remove("hidden", "fading");
  // Bar is visible now, make window interactive so it can receive focus.
  justShownAt = Date.now();
  setInteractive(true);
  xena.requestBarResize(72);
  scheduleFade(FADE_IDLE_MS);
  const focusInput = () => {
    input.focus();
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch {}
    // If focus was stolen (shake case), re-assert click-through.
    setInteractive(true);
  };
  // rAF ensures layout applied after display:none removal, then focus.
  requestAnimationFrame(() => {
    focusInput();
    window.setTimeout(focusInput, 30);
    window.setTimeout(focusInput, 100);
    window.setTimeout(focusInput, 250);
    window.setTimeout(focusInput, 500);
  });
}

function hide(): void {
  if (wrap.classList.contains("hidden")) return;
  if (busy) void xena.abortChat();
  cancelFade();
  wrap.classList.add("hidden");
  wrap.classList.remove("fading");
  answer.classList.add("hidden");
  answer.textContent = "";
  input.value = "";
  busy = false;
  dot.classList.remove("busy");
  setInteractive(false);
  xena.barDismissed();
}

function setBusy(on: boolean): void {
  busy = on;
  dot.classList.toggle("busy", on);
  if (on) cancelFade();
}

function syncWindowSize(): void {
  // Idle: just the bar (72px). With answer: bar + gap + answer height.
  if (answer.classList.contains("hidden")) {
    xena.requestBarResize(72);
    return;
  }
  const h = Math.min(280, answer.scrollHeight);
  xena.requestBarResize(72 + 8 + h + 12);
}

function showAnswer(text: string, isError = false): void {
  answer.textContent = text;
  answer.classList.toggle("hidden", text === "");
  answer.classList.toggle("error", isError);
  syncWindowSize();
}

function friendlyError(message: string): string {
  if (/fetch failed|ECONNREFUSED|network/i.test(message)) {
    return "Can't reach 9Router (localhost:20129). Start it with the `9router` command, then retry.";
  }
  return message;
}

async function submit(raw: string): Promise<void> {
  const text = raw.trim();
  if (text === "" || busy) return;
  input.value = "";
  xena.noteActivity();
  cancelFade();
  setBusy(true);
  answer.classList.remove("error");

  if (text === "/clear") {
    await xena.clearChat();
    setBusy(false);
    showAnswer("Fresh start. What do you need?");
    scheduleFade(FADE_AFTER_ANSWER_MS);
    return;
  }

  if (text.startsWith("/look")) {
    const question = text.slice(5).trim() || "What am I looking at?";
    try {
      const result = await xena.askVision(question);
      setBusy(false);
      showAnswer(result);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    } catch (err) {
      setBusy(false);
      showAnswer(friendlyError((err as Error).message), true);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    }
    return;
  }

  try {
    await xena.sendChat(text);
  } catch (err) {
    setBusy(false);
    showAnswer(friendlyError((err as Error).message), true);
    scheduleFade(FADE_AFTER_ANSWER_MS);
  }
}

let justShownAt = 0;

// Keep window interactive for a grace period after show so the
// focus-steal/mousemove race can't re-enable click-through before
// the first keystroke lands.
document.addEventListener("mousemove", (event) => {
  if (wrap.classList.contains("hidden")) {
    setInteractive(false);
    return;
  }
  if (Date.now() - justShownAt < 600) {
    setInteractive(true);
    return;
  }
  const target = event.target as Element | null;
  setInteractive(target !== null && wrap.contains(target));
});

xena.onSummon(() => show());

// If OS focus arrives late, keep input focused while bar visible.
window.addEventListener("focus", () => {
  if (!wrap.classList.contains("hidden")) {
    requestAnimationFrame(() => input.focus());
  }
});

xena.onChatToken((full) => {
  setBusy(false);
  showAnswer(full);
  answer.scrollTop = answer.scrollHeight;
});

xena.onChatDone(() => {
  setBusy(false);
  scheduleFade(FADE_AFTER_ANSWER_MS);
});

xena.onChatError((message) => {
  setBusy(false);
  showAnswer(friendlyError(message), true);
  scheduleFade(FADE_AFTER_ANSWER_MS);
});

xena.onProactive((text) => {
  show();
  showAnswer(text);
  scheduleFade(FADE_AFTER_ANSWER_MS);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void submit(input.value);
  } else if (event.key === "Escape") {
    hide();
  } else {
    xena.noteActivity();
    scheduleFade(FADE_IDLE_MS);
  }
});
