/**
 * Summon bar: Spotlight-style single-line input. The reply display lives
 * in its own chat window — this surface is input + status feedback only.
 */
import { xena } from "./composables/use-xena-api.js";
import { startCapture, stopCapture, onRecordingStoppedBySilence } from "./composables/use-mic.js";
import { stopPlayback } from "./composables/use-voice.js";

const FADE_AFTER_ANSWER_MS = 8000;
const FADE_IDLE_MS = 10000;

const wrap = document.getElementById("bar-wrap") as HTMLElement;
const input = document.getElementById("bar-input") as HTMLInputElement;
const dot = document.getElementById("bar-dot") as HTMLElement;
const status = document.getElementById("bar-status") as HTMLDivElement;

function setStatus(text: string, isError = false): void {
  const effective = text.trim() === "" ? "" : text;
  status.textContent = effective;
  status.classList.toggle("hidden", effective === "");
  status.classList.toggle("error", isError);
  xena.requestBarResize(effective === "" ? 72 : 96);
}

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
  justShownAt = Date.now();
  setInteractive(true);
  xena.requestBarResize(72);
  scheduleFade(FADE_IDLE_MS);
  const focusInput = () => {
    input.focus();
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch {}
    setInteractive(true);
  };
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
  setStatus("");
  pendingQueue.length = 0;
  // Esc during a recording cancels it — audio is discarded, not sent.
  if (recording) {
    recording = false;
    dot.classList.remove("thinking");
    stopCapture();
  }
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

/** Submit-dismiss: hide the bar entirely while she works — the bubble's
 *  dots are the loading indicator. Keeps busy state + queue intact;
 *  unlike Esc/hide() it never aborts the stream. */
function dismissForReply(): void {
  wrap.classList.add("hidden");
  wrap.classList.remove("fading");
  setStatus("");
  dot.classList.remove("busy");
  setInteractive(false);
  xena.barDismissed();
}

function friendlyError(message: string): string {
  // Main maps known failure kinds to plain lines; this is the last-resort
  // net so a stray raw message still reads as Xena, not as a stack trace.
  if (/fetch failed|ECONNREFUSED|network|HTTP \d{3}|Router9|router9|gemini|pollinations/i.test(message)) {
    return "That didn't work — try again in a moment.";
  }
  return message;
}

const HELP_TEXT = [
  "Commands:",
  "/look <question> — share your screen and ask about it",
  "Ask how to do something and I'll guide you step by step on screen",
  "/remember <fact> — I'll keep this permanently",
  "/forget <keyword> — drop matching facts",
  "/stats — today's conversation stats",
  "/clear — wipe today's conversation",
  "/help — this list",
].join("\n");

// Messages typed while a reply streams queue up (max 2) and send after.
const pendingQueue: string[] = [];

async function submit(raw: string): Promise<void> {
  const text = raw.trim();
  if (text === "") return;
  // Typing while recording: the typed message wins, audio is discarded.
  if (recording) {
    recording = false;
    dot.classList.remove("thinking");
    stopCapture();
  }
  if (busy) {
    if (pendingQueue.length < 2) {
      pendingQueue.push(text);
      setStatus("queued — will send after this reply");
    }
    return;
  }
  input.value = "";
  if (history[history.length - 1] !== text) history.push(text);
  if (history.length > 20) history.shift();
  historyIndex = -1;
  historyDraft = "";
  xena.noteActivity();
  cancelFade();
  setBusy(true);

  if (text === "/clear") {
    await xena.clearChat();
    setBusy(false);
    setStatus("Fresh start. What do you need?");
    scheduleFade(FADE_AFTER_ANSWER_MS);
    return;
  }

  if (text === "/help") {
    setBusy(false);
    setStatus(HELP_TEXT);
    scheduleFade(FADE_AFTER_ANSWER_MS + 4000);
    return;
  }

  if (text === "/stats") {
    try {
      const stats = await xena.getStats();
      setBusy(false);
      setStatus(stats);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    } catch (err) {
      setBusy(false);
      setStatus(friendlyError((err as Error).message), true);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    }
    return;
  }

  if (text.startsWith("/forget ")) {
    try {
      const confirmation = await xena.forget(text.slice(8));
      setBusy(false);
      setStatus(confirmation);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    } catch (err) {
      setBusy(false);
      setStatus(friendlyError((err as Error).message), true);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    }
    return;
  }

  if (text.startsWith("/remember ")) {
    try {
      const confirmation = await xena.remember(text.slice(10));
      setBusy(false);
      setStatus(confirmation);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    } catch (err) {
      setBusy(false);
      setStatus(friendlyError((err as Error).message), true);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    }
    return;
  }

  // /look results display in the chat window (main broadcasts).

  // Streaming paths: the bar gets out of the way — the bubble takes over
  // with the animated dots. Instant commands below keep the bar visible.
  dismissForReply();

  try {
    if (text.startsWith("/look")) {
      await xena.askVision(text.slice(5).trim() || "What am I looking at?");
    } else {
      await xena.sendChat(text);
    }
  } catch (err) {
    setBusy(false);
    show();
    setStatus(friendlyError((err as Error).message), true);
    scheduleFade(FADE_AFTER_ANSWER_MS);
    return;
  }
  // chatDone clears this when the reply was broadcast; when the broadcast
  // was skipped (stream busy), clear the status here instead.
  setBusy(false);
  setStatus("");
}

let justShownAt = 0;

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

window.addEventListener("focus", () => {
  if (!wrap.classList.contains("hidden")) {
    requestAnimationFrame(() => input.focus());
  }
});

// Reasoning dot: input-side liveliness while the model thinks.
xena.onChatThinking((active) => {
  dot.classList.toggle("thinking", active);
  if (active) setStatus("thinking…");
});

xena.onChatDone(() => {
  setBusy(false);
  dot.classList.remove("thinking");
  setStatus("");
  const next = pendingQueue.shift();
  if (next !== undefined) {
    void submit(next);
  }
});

xena.onChatError((payload) => {
  setBusy(false);
  dot.classList.remove("thinking");
  // Persona/short line arrives pre-mapped in main — no raw provider text.
  setStatus(payload.line, true);
  scheduleFade(FADE_AFTER_ANSWER_MS);
});

// Push-to-talk: Ctrl+Alt+V starts/stops capture; on stop the audio is
// transcribed and auto-submitted as a chat message.
let recording = false;
xena.onVoiceRecord((active) => {
  if (active === recording) return;
  recording = active;
  if (active) {
    // Barge-in: kill Xena's voice so the mic doesn't hear her own TTS.
    stopPlayback();
    void startCapture().then(() => {
      show();
      cancelFade(); // a long speech must not hit the 10s idle fade
      setStatus("listening… (speak, then pause — or Ctrl+Alt+V to stop)");
      dot.classList.add("thinking");
    }).catch(() => {
      setStatus("Microphone unavailable — check Windows privacy settings.", true);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    });
    return;
  }
  dot.classList.remove("thinking");
  const wav = stopCapture();
  void finishRecording(wav);
});

// Auto-stop: silence after speech ends the recording on its own.
onRecordingStoppedBySilence(() => {
  if (!recording) return;
  recording = false;
  dot.classList.remove("thinking");
  const wav = stopCapture();
  void finishRecording(wav);
});

function finishRecording(wav: string | null): void {
  if (wav === null) {
    setStatus("Didn't catch that — no audio recorded.", true);
    scheduleFade(FADE_AFTER_ANSWER_MS);
    return;
  }
  setStatus("transcribing…");
  void xena
    .sendVoiceAudio(wav)
    .then((text) => {
      if (text.trim() !== "") {
        setStatus(`you said: ${text}`);
        void submit(text);
      } else {
        setStatus("Heard nothing usable.", true);
        scheduleFade(FADE_AFTER_ANSWER_MS);
      }
    })
    .catch((err) => {
      setStatus(friendlyError((err as Error).message), true);
      scheduleFade(FADE_AFTER_ANSWER_MS);
    });
}

// Input history: up/down walks previously sent messages.
const history: string[] = [];
let historyIndex = -1;
let historyDraft = "";

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void submit(input.value);
  } else if (event.key === "Escape") {
    hide();
  } else if (event.key === "ArrowUp") {
    if (history.length === 0) return;
    event.preventDefault();
    if (historyIndex === -1) {
      historyDraft = input.value;
      historyIndex = history.length - 1;
    } else if (historyIndex > 0) {
      historyIndex--;
    }
    input.value = history[historyIndex] ?? "";
  } else if (event.key === "ArrowDown") {
    if (historyIndex === -1) return;
    event.preventDefault();
    historyIndex++;
    if (historyIndex >= history.length) {
      historyIndex = -1;
      input.value = historyDraft;
    } else {
      input.value = history[historyIndex] ?? "";
    }
  } else {
    xena.noteActivity();
    scheduleFade(FADE_IDLE_MS);
  }
});
