/**
 * Avatar renderer: the Live2D stage (Mao) with TTS-synced mouth flap,
 * cursor gaze, and mood expressions. The main process decides everything;
 * the renderer is fully passive.
 */
import { Live2DStage } from "./modules/avatar/live2d/stage.js";
import { initVoice } from "./composables/use-voice.js";
import { xena } from "./composables/use-xena-api.js";
import { cleanForDisplay } from "@xena/xena-core/persona";
import {
  showBubble,
  setThinking,
  setMood,
  scheduleBubbleFade,
  cancelBubbleFade,
  armAutoFade,
  hideBubble,
  setSetupActive,
} from "./modules/avatar/bubble.js";

const live2dRoot = document.getElementById("live2d-root") as HTMLElement;
let l2d: Live2DStage | null = null;
let l2dModelDir = "";

async function applyLive2d(enabled: boolean, model: string): Promise<void> {
  // Convention: folder "mao" -> mao/Mao.model3.json.
  const pascal = model.charAt(0).toUpperCase() + model.slice(1);
  const modelDir = `./assets/live2d/${model}/${pascal}.model3.json`;
  if (!enabled) {
    if (l2d !== null) {
      l2d.destroy();
      l2d = null;
    }
    live2dRoot.style.display = "none";
    return;
  }
  if (l2d !== null && l2dModelDir === modelDir) return;
  // Fresh mount (also covers model switches).
  if (l2d !== null) {
    l2d.destroy();
    l2d = null;
  }
  l2d = new Live2DStage(modelDir);
  l2dModelDir = modelDir;
  live2dRoot.style.display = "block";
  try {
    await l2d.mount(live2dRoot);
  } catch (error) {
    console.error("[live2d] mount failed:", error);
    l2d.destroy();
    l2d = null;
    live2dRoot.style.display = "none";
  }
}

xena.onLive2d((config) => void applyLive2d(config.enabled, config.model));
void xena
  .getLive2d()
  .then((config) => void applyLive2d(config.enabled, config.model))
  .catch(() => undefined);

let ttsPlaying = false;
let audioPending = false;
let pendingText: string | null = null;
let lastReplyChars = 0;
let fallbackTimer: number | null = null;

function clearFallbackTimer(): void {
  if (fallbackTimer !== null) {
    window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

function revealPendingTextImmediate(): void {
  clearFallbackTimer();
  audioPending = false;
  setThinking(false);
  if (pendingText !== null && pendingText.trim() !== "") {
    showBubble(pendingText);
    scheduleBubbleFade(Math.min(28_000, 8000 + 20 * pendingText.length));
  }
}

initVoice({
  onAudioReceived: () => {
    audioPending = true;
    clearFallbackTimer();
    cancelBubbleFade();
  },
  start: () => {
    clearFallbackTimer();
    audioPending = false;
    ttsPlaying = true;
    l2d?.setGaze(0, 0);
    l2d?.setTalking(true);

    if (pendingText !== null && pendingText.trim() !== "") {
      setThinking(false);
      showBubble(pendingText);
    }
    cancelBubbleFade();
  },
  stop: () => {
    ttsPlaying = false;
    l2d?.setTalking(false);
    l2d?.setAudioLevel(0);
    if (pendingText !== null && pendingText.trim() !== "") {
      scheduleBubbleFade(3000);
      pendingText = null;
    }
  },
  onLevel: (level) => {
    // Real audio loudness drives the mouth — the JP lip-sync fix.
    l2d?.setAudioLevel(level);
  },
});

// Mood tags from replies drive Mao's face; on decay she returns to neutral.
let currentEmotion = "";
let emotionResetTimer: number | null = null;
xena.onEmote((emotion) => {
  currentEmotion = emotion;
  setMood(emotion);
  l2d?.setMood(emotion);
  if (emotionResetTimer !== null) {
    window.clearTimeout(emotionResetTimer);
    emotionResetTimer = null;
  }
  if (emotion !== "") {
    emotionResetTimer = window.setTimeout(() => {
      emotionResetTimer = null;
      currentEmotion = "";
    }, 12_000);
  }
});

// Cursor position feed — the stage's random gaze engine decides when to
// actually track (AIRI-style: mostly free-roam, periodic engage windows).
// `hold` marks a forced glance (pointer targets etc.).
xena.onGaze(({ dx, dy, hold }) => {
  if (hold && hold > 0) l2d?.forceTrack(hold);
  l2d?.setGaze(dx, dy);
});

// Reply events render as speech bubbles anchored to Mao.
xena.onChatToken((full) => {
  cancelBubbleFade();
  const cleaned = cleanForDisplay(full);
  pendingText = cleaned;
  lastReplyChars = cleaned.length;
  // Hold thinking dots while streaming & waiting for TTS audio.
  setThinking(true);
});

xena.onChatThinking((active) => {
  if (active) setThinking(true);
});

xena.onChatDone(() => {
  clearFallbackTimer();
  // Grace window: if TTS `start` fires within 5 s, it reveals the text in
  // sync with the audio. If TTS never starts (voice disabled, or Edge TTS
  // failed mid-flight), the timer is the safety net that unsticks the dots.
  // Audio-in-flight (audioPending) is handled the same way — start() still
  // wins the race, and if start never fires we fall back gracefully.
  fallbackTimer = window.setTimeout(() => {
    revealPendingTextImmediate();
  }, 5000);
});

xena.onChatError((payload) => {
  clearFallbackTimer();
  audioPending = false;
  pendingText = null;
  // Persona line arrives pre-mapped in main; raw provider detail never does.
  showBubble(payload.line, true);
  scheduleBubbleFade(8000);
});

xena.onProactive((text) => {
  cancelBubbleFade();
  const cleaned = cleanForDisplay(text);
  pendingText = cleaned;
  lastReplyChars = cleaned.length;
  setThinking(true);
  clearFallbackTimer();
  fallbackTimer = window.setTimeout(() => {
    revealPendingTextImmediate();
  }, 1200);
});

// First-run setup flow: per-step audio + mood mirror + yes/no + key input,
// all anchored under the bubble inside the avatar window. Main lifts
// click-through during setup so these buttons receive real clicks.
let setupActive = false;
let setupAudio: HTMLAudioElement | null = null;
const setupUi = document.getElementById("setup-ui") as HTMLElement;
const setupChoices = document.getElementById("setup-choices") as HTMLDivElement;
const setupKeyRow = document.getElementById("setup-key-row") as HTMLDivElement;
const setupKeyInput = document.getElementById("setup-key-input") as HTMLInputElement;
const setupBack = document.getElementById("setup-back") as HTMLSpanElement;
const setupYesBtn = document.getElementById("setup-yes") as HTMLButtonElement;
const setupNoBtn = document.getElementById("setup-no") as HTMLButtonElement;

const SETUP_AUDIO: Record<string, string> = {
  greeting: "./assets/setup/1-greeting.mp3",
  "ask-key": "./assets/setup/2-ask-key.mp3",
  "key-saved": "./assets/setup/3-key-saved.mp3",
  "sit-together": "./assets/setup/4-sit-together.mp3",
  decline: "./assets/setup/5-decline.mp3",
  unlock: "./assets/setup/6-unlock.mp3",
};

function playSetupAudio(key: keyof typeof SETUP_AUDIO): void {
  const src = SETUP_AUDIO[key];
  if (!src) return;
  setupAudio?.pause();
  try {
    setupAudio = new Audio(src);
    setupAudio.onended = () => xena.notifySetupAudioEnd();
    setupAudio.onerror = () => xena.notifySetupAudioEnd();
    void setupAudio.play().catch((err) => {
      console.error("[setup] audio failed:", err);
      xena.notifySetupAudioEnd();
    });
  } catch (err) {
    console.error("[setup] audio load failed:", err);
    xena.notifySetupAudioEnd();
  }
}

function repositionSetupUi(): void {
  const bubble = document.getElementById("bubble") as HTMLElement | null;
  if (!bubble || setupUi.classList.contains("hidden")) return;
  const bubbleWidth = bubble.offsetWidth;
  const setupTop = window.innerHeight - parseFloat(getComputedStyle(bubble).bottom) + 7;
  setupUi.style.top = `${setupTop}px`;
  setupKeyRow.style.width = `${bubbleWidth}px`;
}

xena.onSetupBegin(() => {
  setupActive = true;
  setSetupActive(true);
  cancelBubbleFade();
  setupUi.classList.remove("hidden");
  setupChoices.classList.remove("hidden");
  setupKeyRow.classList.add("hidden");
  playSetupAudio("greeting");
  requestAnimationFrame(() => repositionSetupUi());
});

xena.onSetupBubble((text) => {
  showBubble(text);
  requestAnimationFrame(() => repositionSetupUi());
});

xena.onSetupMood((mood) => {
  setMood(mood);
  l2d?.setMood(mood);
  currentEmotion = mood;
  if (emotionResetTimer !== null) {
    window.clearTimeout(emotionResetTimer);
    emotionResetTimer = null;
  }
});

xena.onSetupStep((step) => {
  playSetupAudio(step as keyof typeof SETUP_AUDIO);
  if (step === "greeting") {
    setupChoices.classList.remove("hidden");
    setupKeyRow.classList.add("hidden");
  } else if (step === "ask-key") {
    setupChoices.classList.add("hidden");
    setupKeyRow.classList.remove("hidden");
    window.setTimeout(() => setupKeyInput.focus(), 80);
  } else {
    setupChoices.classList.add("hidden");
    setupKeyRow.classList.add("hidden");
  }
  requestAnimationFrame(() => repositionSetupUi());
});

xena.onSetupDone(() => {
  setupActive = false;
  setSetupActive(false);
  setupAudio?.pause();
  setupAudio = null;
  setupUi.classList.add("hidden");
  setupKeyInput.value = "";
  hideBubble();
});

setupYesBtn.addEventListener("click", () => {
  if (setupActive) xena.submitSetup("yes");
});
setupNoBtn.addEventListener("click", () => {
  if (setupActive) xena.submitSetup("no");
});
setupKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (setupActive) xena.submitSetup(setupKeyInput.value);
  } else if (event.key === "Escape") {
    xena.backSetup();
  }
});
setupBack.addEventListener("click", () => xena.backSetup());
window.addEventListener("resize", () => {
  if (setupActive) repositionSetupUi();
});

// Occasional unprompted mood flickers / gestures while idle — she has
// moods even when nobody is talking to her.
const IDLE_MOODS = ["happy", "smug", "sleepy"];
const scheduleIdleEmote = (): void => {
  window.setTimeout(() => {
    if (setupActive) {
      scheduleIdleEmote();
      return;
    }
    if (l2d?.ready && !ttsPlaying && currentEmotion === "") {
      if (Math.random() < 0.45) {
        // gesture-only beat: motion, face stays neutral
        l2d.playIdleGesture();
      } else {
        const mood = IDLE_MOODS[Math.floor(Math.random() * IDLE_MOODS.length)]!;
        l2d.setMood(mood);
      }
    }
    scheduleIdleEmote();
  }, 5 * 60_000 + Math.random() * 7 * 60_000);
};
scheduleIdleEmote();
