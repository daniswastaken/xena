/**
 * Google Translate service for TTS output.
 * Translates English (or any language) text into Japanese at system level
 * so ja-JP Edge-TTS speaks natural Japanese while UI stays in original language.
 */

export async function translateToJapanese(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return trimmed;

    const data = (await res.json()) as Array<Array<[string, string]>>;
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0].map((chunk) => chunk[0]).join("");
      if (translated.trim()) return translated;
    }
  } catch {
    // Fallback to original text if offline, timeout, or rate-limited
  }

  return trimmed;
}
