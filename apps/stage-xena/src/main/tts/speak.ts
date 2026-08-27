/**
 * TTS relay: synthesize assistant replies, ship base64 mp3 to renderer.
 * Free Edge read-aloud — no API key, no token burn. Mood acts the emotion.
 */
import { speakToBase64 } from "@xena/tts";
import { translateToJapanese } from "./translate.js";

export async function speakReply(
  text: string,
  _mood?: string,
): Promise<string> {
  // Strip markdown-ish noise that reads badly aloud.
  const clean = text.replace(/[*_`#>]/g, "").slice(0, 600);
  const jaText = await translateToJapanese(clean);
  return speakToBase64(jaText);
}
