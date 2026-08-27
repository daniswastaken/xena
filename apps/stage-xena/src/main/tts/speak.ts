/**
 * TTS relay: synthesize assistant replies, ship base64 mp3 to renderer.
 * Free Edge read-aloud — no API key, no token burn. Mood acts the emotion.
 */
import { speakToBase64 } from "@xena/tts";

export async function speakReply(
  text: string,
  _mood?: string,
): Promise<string> {
  // Strip markdown-ish noise that reads badly aloud.
  const clean = text.replace(/[*_`#>]/g, "").slice(0, 600);
  return speakToBase64(clean);
}
