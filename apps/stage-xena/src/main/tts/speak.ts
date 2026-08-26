/**
 * TTS relay: synthesize assistant replies, ship base64 mp3 to renderer.
 * Free Edge read-aloud — no API key, no token burn. Mood acts the emotion.
 */
import { speakToBase64, DEFAULT_VOICE } from "@xena/tts";

export async function speakReply(
  text: string,
  voice: string = DEFAULT_VOICE,
  mood?: string,
): Promise<string> {
  // Strip markdown-ish noise that reads badly aloud.
  const clean = text.replace(/[*_`#>]/g, "").slice(0, 600);
  return speakToBase64(clean, voice, mood);
}
