/**
 * Xena voice — free Microsoft Edge read-aloud TTS (no API key).
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const XENA_VOICE = "en-US-AriaNeural";

let client: MsEdgeTTS | null = null;

async function getClient(): Promise<MsEdgeTTS> {
  if (!client) {
    client = new MsEdgeTTS();
    await client.setMetadata(XENA_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  }
  return client;
}

/** Synthesizes text to a base64-encoded MP3. */
export async function speakToBase64(text: string): Promise<string> {
  const tts = await getClient();
  const { audioStream } = await tts.toStream(text);
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("base64");
}

export async function closeTts(): Promise<void> {
  await client?.close();
  client = null;
}
