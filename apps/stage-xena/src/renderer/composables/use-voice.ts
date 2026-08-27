/**
 * Voice playback: plays TTS mp3, drives the Live2D mouth for the duration.
 */
export interface Mouth {
  start(): void;
  stop(): void;
  onAudioReceived?(): void;
}

let current: HTMLAudioElement | null = null;
let currentStopCallback: (() => void) | null = null;

/** Stops any in-flight TTS playback (barge-in / echo prevention). */
export function stopPlayback(): void {
  if (current) {
    current.pause();
    current = null;
  }
  if (currentStopCallback) {
    const cb = currentStopCallback;
    currentStopCallback = null;
    cb();
  }
}

export function initVoice(mouth: Mouth): void {
  window.xena.onTtsAudio((base64) => {
    stopPlayback();
    mouth.onAudioReceived?.();
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    current = audio;

    const stop = (): void => {
      if (current === audio || currentStopCallback === stop) {
        current = null;
        currentStopCallback = null;
        mouth.stop();
      }
    };
    currentStopCallback = stop;

    audio.addEventListener("play", () => mouth.start());
    audio.addEventListener("ended", stop);
    audio.addEventListener("error", stop);
    void audio.play().catch(stop);
  });
}
