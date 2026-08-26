/**
 * Voice playback: plays TTS mp3, drives the mouth for the duration.
 * Accepts any mouth facade (PNG flap, Live2D stage, or both).
 */
export interface Mouth {
  start(): void;
  stop(): void;
}

let current: HTMLAudioElement | null = null;

/** Stops any in-flight TTS playback (barge-in / echo prevention). */
export function stopPlayback(): void {
  if (current) {
    current.pause();
    current = null;
  }
}

export function initVoice(mouth: Mouth): void {
  window.xena.onTtsAudio((base64) => {
    stopPlayback();
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    current = audio;
    audio.addEventListener("play", () => mouth.start());
    const stop = (): void => {
      if (current === audio) {
        current = null;
        mouth.stop();
      }
    };
    audio.addEventListener("ended", stop);
    audio.addEventListener("error", stop);
    void audio.play().catch(stop);
  });
}
