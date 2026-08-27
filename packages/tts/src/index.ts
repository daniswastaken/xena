/**
 * Xena voice — free Microsoft Edge read-aloud TTS (no API key).
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { ProsodyOptions } from "msedge-tts";

export const DEFAULT_VOICE = "ja-JP-NanamiNeural";

/**
 * Xena speaks exclusively in JP Nanami. Her voice is always the "happy" read
 * regardless of the expression driving her face — one consistent gremlin voice.
 */
const XENA_PROSODY: ProsodyOptions = { rate: "+8%", pitch: "+10%" };

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

/** Synthesizes text to a base64-encoded MP3 in Xena's voice (always JP Nanami, happy read). */
export async function speakToBase64(
  text: string,
  _voice: string = DEFAULT_VOICE,
  _mood?: string,
): Promise<string> {
  const tts = await getClient(DEFAULT_VOICE);
  const { audioStream } = await tts.toStream(text, XENA_PROSODY);
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
