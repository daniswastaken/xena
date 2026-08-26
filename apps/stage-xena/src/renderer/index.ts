/**
 * Avatar renderer: sprite states + TTS-synced mouth flap + mood emotes.
 * Fully passive — the main process decides everything.
 */
import { MouthFlap } from "./modules/avatar/mouth-flap.js";
import { EmoteStage } from "./modules/avatar/emotes.js";
import { Liveliness } from "./modules/avatar/liveliness.js";
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

const stage = new EmoteStage({
  idle: "./assets/idle.png",
  talk: "./assets/talk.png",
  blink: "./assets/blink.png",
});
void stage.preload();

const flap = new MouthFlap(stage);
const liveliness = new Liveliness(() => flap.state === "talking");
liveliness.start();

// --- Live2D (experimental, tray-toggled) -----------------------------------
const avatarImg = document.getElementById("avatar") as HTMLImageElement;
const live2dRoot = document.getElementById("live2d-root") as HTMLElement;
let l2d: Live2DStage | null = null;
let l2dModelDir = "";

function showPng(): void {
  live2dRoot.style.display = "none";
  avatarImg.style.display = "";
  liveliness.start();
}

async function applyLive2d(enabled: boolean, model: string): Promise<void> {
  // Convention: folder "hiyori" -> hiyori/Hiyori.model3.json.
  const pascal = model.charAt(0).toUpperCase() + model.slice(1);
  const modelDir = `./assets/live2d/${model}/${pascal}.model3.json`;
  if (!enabled) {
    if (l2d !== null) {
      l2d.destroy();
      l2d = null;
      showPng();
    }
    return;
  }
  if (l2d !== null && l2dModelDir === modelDir) return;
  // Fresh mount (also covers model switches).
  if (l2d !== null) {
    l2d.destroy();
    l2d = null;
  }
  liveliness.stop();
  l2d = new Live2DStage(modelDir);
  l2dModelDir = modelDir;
  live2dRoot.style.display = "block";
  avatarImg.style.display = "none";
  try {
    await l2d.mount(live2dRoot);
  } catch (error) {
    console.error("[live2d] mount failed:", error);
    l2d.destroy();
    l2d = null;
    showPng();
  }
}

xena.onLive2d((config) => void applyLive2d(config.enabled, config.model));
void xena
  .getLive2d()
  .then((config) => void applyLive2d(config.enabled, config.model))
  .catch(() => undefined);

// Voice drives both the PNG flap and the Live2D mouth simultaneously;
// whichever stage is visible reacts. While SHE talks, she holds eye
// contact instead of following the cursor — turn-taking gaze.
let ttsPlaying = false;
initVoice({
  start: () => {
    flap.start();
    ttsPlaying = true;
    l2d?.setGaze(0, 0);
    l2d?.setTalking(true);
  },
  stop: () => {
    flap.stop();
    ttsPlaying = false;
    l2d?.setTalking(false);
  },
});

// Mood tags from replies drive the face; on decay return to whatever
// state the flap logic is currently in and drop the face to neutral.
xena.onEmote((emotion) => {
  setMood(emotion);
  stage.setEmotion(emotion, () => {
    if (flap.state === "idle") flap.stop();
    else flap.start();
    l2d?.resetExpression();
  });
  // Live2D: mood flourish (expression + motion).
  if (emotion !== "" && l2d?.ready) l2d.playMoodFlourish(emotion);
});

// Mao watches the user's cursor (Live2D only) — unless she's talking.
xena.onGaze(({ dx, dy }) => {
  if (!ttsPlaying) l2d?.setGaze(dx, dy);
});

// Reply events render as speech bubbles anchored to Mao.
let lastReplyChars = 0;
xena.onChatToken((full) => {
  cancelBubbleFade();
  armAutoFade();
  lastReplyChars = full.length;
  showBubble(cleanForDisplay(full));
});

xena.onChatThinking((active) => {
  if (active) setThinking(true);
});

xena.onChatProvider((p) => setProviderNote(p));

xena.onChatDone(() => {
  setThinking(false);
  scheduleBubbleFade(Math.min(28_000, 8000 + 20 * lastReplyChars));
});

xena.onChatError((message) => {
  showBubble(message, true);
  scheduleBubbleFade(8000);
});

xena.onProactive((text) => {
  showBubble(cleanForDisplay(text));
  armAutoFade();
});

// Random blinks while idle.
const scheduleBlink = (): void => {
  window.setTimeout(() => {
    flap.blinkOnce();
    scheduleBlink();
  }, 2400 + Math.random() * 4200);
};
scheduleBlink();

// Occasional unprompted mood flickers while idle — she has moods even
// when nobody is talking to her. Sometimes it's just a stretch/gesture
// with no face change at all.
const IDLE_EMOTES = ["happy", "smug", "sleepy"];
const scheduleIdleEmote = (): void => {
  window.setTimeout(() => {
    if (flap.state === "idle" && stage.emotion === null) {
      if (Math.random() < 0.45 && l2d?.ready) {
        // gesture-only beat: motion, face stays neutral
        l2d.playIdleGesture();
      } else {
        const mood = IDLE_EMOTES[Math.floor(Math.random() * IDLE_EMOTES.length)]!;
        stage.setEmotion(mood, () => {
          if (flap.state === "idle") flap.stop();
          l2d?.resetExpression();
        });
        if (l2d?.ready) l2d.playMoodFlourish(mood);
      }
    }
    scheduleIdleEmote();
  }, 5 * 60_000 + Math.random() * 7 * 60_000);
};
scheduleIdleEmote();
