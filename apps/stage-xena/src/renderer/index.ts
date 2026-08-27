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
  setProviderNote,
  setThinking,
  setMood,
  scheduleBubbleFade,
  cancelBubbleFade,
  armAutoFade,
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
    if (pendingText !== null && pendingText.trim() !== "") {
      scheduleBubbleFade(3000);
      pendingText = null;
    }
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

// Mao watches the user's cursor — unless she's talking.
xena.onGaze(({ dx, dy }) => {
  if (!ttsPlaying) l2d?.setGaze(dx, dy);
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

xena.onChatProvider((p) => setProviderNote(p));

xena.onChatDone(() => {
  clearFallbackTimer();
  if (ttsPlaying || audioPending) {
    // Audio is playing or on its way over IPC — hold until onplay / stop handles it.
    return;
  }
  // Fallback: if voice is disabled or TTS audio doesn't arrive within 1200ms, reveal text.
  fallbackTimer = window.setTimeout(() => {
    revealPendingTextImmediate();
  }, 1200);
});

xena.onChatError((message) => {
  clearFallbackTimer();
  audioPending = false;
  pendingText = null;
  showBubble(message, true);
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

// Occasional unprompted mood flickers / gestures while idle — she has
// moods even when nobody is talking to her.
const IDLE_MOODS = ["happy", "smug", "sleepy"];
const scheduleIdleEmote = (): void => {
  window.setTimeout(() => {
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
