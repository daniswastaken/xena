/**
 * Push-to-talk capture: mic PCM -> 16kHz mono WAV base64.
 * Lives in the bar renderer; started/stopped via Ctrl+Alt+V.
 */
const SAMPLE_RATE = 16000;

let context: AudioContext | null = null;
let stream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let chunks: Float32Array[] = [];
/** Voice-activity state: auto-stop after SILENCE_STOP_MS of quiet. */
let lastVoiceAt = 0;
let heardVoice = false;
let silenceTimer: number | null = null;
let onSilence: (() => void) | null = null;

const SILENCE_STOP_MS = 1600;
const RMS_THRESHOLD = 0.015;
/** Hard cap: background noise can defeat the silence watchdog. */
const MAX_RECORDING_MS = 30_000;
let recordingStartedAt = 0;

/**
 * Arms the silence watchdog: recording auto-stops once the user has
 * spoken and then stayed quiet — no second keypress needed.
 */
export function onRecordingStoppedBySilence(cb: () => void): void {
  onSilence = cb;
}

function noteActivity(level: number): void {
  if (level > RMS_THRESHOLD) {
    lastVoiceAt = Date.now();
    heardVoice = true;
  }
}

function armSilenceWatch(): void {
  if (silenceTimer !== null) return;
  recordingStartedAt = Date.now();
  const timer = window.setInterval(() => {
    if (!stream) return;
    // Hard cap beats the silence watchdog when ambient noise never quiets.
    if (Date.now() - recordingStartedAt >= MAX_RECORDING_MS) {
      const cb = onSilence;
      window.clearInterval(timer);
      silenceTimer = null;
      heardVoice = false;
      cb?.();
      return;
    }
    if (!heardVoice) return;
    if (Date.now() - lastVoiceAt >= SILENCE_STOP_MS) {
      const cb = onSilence;
      window.clearInterval(timer);
      silenceTimer = null;
      heardVoice = false;
      cb?.();
    }
  }, 250);
  silenceTimer = timer;
}

function disarmSilenceWatch(): void {
  if (silenceTimer !== null) {
    window.clearInterval(silenceTimer);
    silenceTimer = null;
  }
  heardVoice = false;
}

export async function startCapture(): Promise<void> {
  if (stream) return;
  chunks = [];
  lastVoiceAt = Date.now();
  disarmSilenceWatch();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: SAMPLE_RATE, echoCancellation: true, noiseSuppression: true },
  });
  context = context ?? new AudioContext({ sampleRate: SAMPLE_RATE });
  if (context.state === "suspended") await context.resume();
  source = context.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but dependency-free and fine for 16k mono.
  processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    noteActivity(Math.sqrt(sum / data.length));
  };
  source.connect(processor);
  processor.connect(context.destination); // required to keep the node alive
  armSilenceWatch();
}

export function stopCapture(): string | null {
  if (!stream || !context) return null;
  disarmSilenceWatch();
  source?.disconnect();
  processor?.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  processor = null;
  source = null;

  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total === 0) {
    void context.close();
    context = null;
    return null;
  }
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    pcm.set(c, offset);
    offset += c.length;
  }
  const wav = encodeWav(pcm, SAMPLE_RATE);
  void context.close();
  context = null;
  chunks = [];
  return arrayBufferToBase64(wav);
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (pos: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let pos = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    pos += 2;
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
