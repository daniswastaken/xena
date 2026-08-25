/**
 * Voice playback: plays TTS mp3, drives mouth flap for the duration.
 */
import type { MouthFlap } from "../modules/avatar/mouth-flap.js";

let current: HTMLAudioElement | null = null;

export function initVoice(flap: MouthFlap): void {
  window.xena.onTtsAudio((base64) => {
    if (current) {
      current.pause();
      current = null;
    }
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    current = audio;
    audio.addEventListener("play", () => flap.start());
    const stop = (): void => {
      if (current === audio) {
        current = null;
        flap.stop();
      }
    };
    audio.addEventListener("ended", stop);
    audio.addEventListener("error", stop);
    void audio.play().catch(stop);
  });
}
