/**
 * Avatar renderer: sprite states + TTS-synced mouth flap. Fully passive.
 */
import { MouthFlap } from "./modules/avatar/mouth-flap.js";
import { initVoice } from "./composables/use-voice.js";

const flap = new MouthFlap("./assets/idle.png", "./assets/talk.png", "./assets/blink.png");
initVoice(flap);

// Random blinks while idle.
const scheduleBlink = (): void => {
  window.setTimeout(() => {
    flap.blinkOnce();
    scheduleBlink();
  }, 2400 + Math.random() * 4200);
};
scheduleBlink();
