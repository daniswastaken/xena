/**
 * Xena voice — free Microsoft Edge read-aloud TTS (no API key).
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { ProsodyOptions } from "msedge-tts";

export const DEFAULT_VOICE = "en-US-AriaNeural";

export const VOICES = [
  "en-US-AriaNeural",
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-GB-SoniaNeural",
  "en-GB-RyanNeural",
  "ja-JP-NanamiNeural",
  "ja-JP-KeitaNeural",
] as const;

export type VoiceId = (typeof VOICES)[number];

/**
 * Per-mood prosody — the voice acts the emotion instead of flat-reading.
 * Relative SSML values; subtle by design so it never sounds cartoonish.
 */
const MOOD_PROSODY: Record<string, ProsodyOptions> = {
  happy: { rate: "+8%", pitch: "+10%" },
  smug: { rate: "-4%", pitch: "-5%" },
  surprised: { rate: "+14%", pitch: "+16%" },
  annoyed: { rate: "+6%", pitch: "-6%" },
  sleepy: { rate: "-16%", pitch: "-9%", volume: "soft" },
  sad: { rate: "-14%", pitch: "-8%", volume: "soft" },
};

let client: MsEdgeTTS | null = null;
let clientVoice = "";

async function getClient(voice: string): Promise<MsEdgeTTS> {
  if (client && clientVoice === voice) return client;
  if (client) {
    try {
      await client.close();
    } catch {
      // stale socket — ignore
    }
  }
  client = new MsEdgeTTS();
  // 24kHz/96kbit: highest bitrate the Edge endpoint accepts (48kHz formats
  // are disabled upstream). Crisper than the old 48kbit default.
  await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  clientVoice = voice;
  return client;
}

/** Synthesizes text to a base64-encoded MP3 in the given voice (+ mood prosody). */
export async function speakToBase64(
  text: string,
  voice: string = DEFAULT_VOICE,
  mood?: string,
): Promise<string> {
  const tts = await getClient(voice);
  const prosody = mood ? MOOD_PROSODY[mood] : undefined;
  const { audioStream } = await tts.toStream(text, prosody);
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("base64");
}

export async function closeTts(): Promise<void> {
  await client?.close();
  client = null;
  clientVoice = "";
}
