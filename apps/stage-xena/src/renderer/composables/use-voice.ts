/**
 * Voice playback: plays TTS mp3, drives the Live2D mouth from REAL audio
 * levels (WebAudio analyser) — the flap tracks the actual sound, no more
 * fixed-phase sine drift.
 */
export interface Mouth {
  start(): void;
  stop(): void;
  onAudioReceived?(): void;
  /** Audio-driven lip-sync: normalized loudness 0..1, called per frame. */
  onLevel?(level: number): void;
}

let current: HTMLAudioElement | null = null;
let currentStopCallback: (() => void) | null = null;
let analyserCtx: AudioContext | null = null;
let analyserSrc: MediaElementAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let levelData: Uint8Array<ArrayBuffer> | null = null;
let levelTimer: number | null = null;
let levelSink: Mouth | null = null;

/** Stops any in-flight TTS playback (barge-in / echo prevention). */
export function stopPlayback(): void {
  if (current) {
    current.pause();
    current = null;
  }
  stopLevelFeed();
  if (currentStopCallback) {
    const cb = currentStopCallback;
    currentStopCallback = null;
    cb();
  }
}

function stopLevelFeed(): void {
  if (levelTimer !== null) {
    window.clearInterval(levelTimer);
    levelTimer = null;
  }
  analyser = null;
  analyserSrc = null;
  levelData = null;
}

function startLevelFeed(mouth: Mouth, audio: HTMLAudioElement): void {
  try {
    analyserCtx = analyserCtx ?? new AudioContext();
    if (analyserCtx.state === "suspended") void analyserCtx.resume();
    // One source node per audio element (elements can only be wired once).
    analyserSrc = analyserCtx.createMediaElementSource(audio);
    analyser = analyserCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.2;
    analyserSrc.connect(analyser);
    // createMediaElementSource reroutes element audio INTO the graph —
    // without this link the element plays silence into a dead end.
    analyser.connect(analyserCtx.destination);
    levelData = new Uint8Array(analyser.frequencyBinCount);
    levelSink = mouth;
    let last = 0;
    levelTimer = window.setInterval(() => {
      if (!analyser || !levelData || !levelSink) return;
      analyser.getByteTimeDomainData(levelData);
      // RMS of the waveform, normalized — quiet speech ~0.05, loud ~0.9.
      let sum = 0;
      for (let i = 0; i < levelData.length; i++) {
        const v = (levelData[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / levelData.length);
      // Perceptual curve: expand the quiet band, cap the top.
      const level = Math.min(1, rms * 3.2);
      // Small hysteresis so micro silences don't flick the mouth shut.
      last = level > last ? level : last * 0.6 + level * 0.4;
      levelSink.onLevel?.(last);
    }, 30); // ~33 fps — matches the 30 fps Live2D ticker.
  } catch {
    // Analyser wiring failed — the synthetic flap still works.
    stopLevelFeed();
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
        stopLevelFeed();
        mouth.stop();
      }
    };
    currentStopCallback = stop;

    audio.addEventListener("play", () => {
      startLevelFeed(mouth, audio);
      mouth.start();
    });
    audio.addEventListener("ended", stop);
    audio.addEventListener("error", (e) => {
      console.error("[voice] audio error:", (e.currentTarget as HTMLAudioElement)?.error);
      stop();
    });
    void audio.play().catch((err) => {
      console.error("[voice] play() rejected:", err);
      stop();
    });
  });
}
