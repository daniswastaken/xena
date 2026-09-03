/**
 * Translation for TTS output: EN (or any language) → JA so the ja-JP
 * Nanami Edge voice speaks natural Japanese while UI stays in the
 * original language.
 *
 * Chain: Google gtx (fast, best quality) → MyMemory (free fallback) →
 * original text. gtx is keyless and rate-limits hard per-IP (429); the
 * MyMemory rung keeps JP voice alive when it does. Results are cached —
 * free-tier etiquette, repeated replies never re-hit the network.
 */

const CACHE_LIMIT = 128;
const cache = new Map<string, string>();

/** Short in-process TTL so a re-said line avoids the network entirely. */
const CACHE_TTL_MS = 10 * 60_000;
const ttlStamps = new Map<string, number>();

export async function translateToJapanese(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const cached = cache.get(trimmed);
  if (cached !== undefined && Date.now() - (ttlStamps.get(trimmed) ?? 0) < CACHE_TTL_MS) {
    return cached;
  }

  const translated =
    (await viaGoogleGtx(trimmed)) ?? (await viaMyMemory(trimmed)) ?? trimmed;

  cache.set(trimmed, translated);
  ttlStamps.set(trimmed, Date.now());
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
      ttlStamps.delete(oldest);
    }
  }
  return translated;
}

/** Keyless Google translate endpoint — best quality, 429s under load. */
async function viaGoogleGtx(text: string): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Array<[string, string]>>;
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0].map((chunk) => chunk[0]).join("");
      if (translated.trim()) return translated;
    }
  } catch {
    // offline / timeout / rate-limited — try next rung
  }
  return null;
}

/** MyMemory free tier — no key, ~1000 words/day per IP, generous for TTS lines. */
async function viaMyMemory(text: string): Promise<string | null> {
  try {
    // MyMemory mangles long queries; TTS lines are short (persona caps ~25
    // words) but slice defensively anyway.
    const q = encodeURIComponent(text.slice(0, 500));
    const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|ja`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { responseData?: { translatedText?: string } };
    const translated = data.responseData?.translatedText ?? "";
    // MyMemory returns errors as uppercase service messages — reject those.
    if (translated.trim() && !/^[A-Z\s:'-]+$/.test(translated.trim())) return translated;
  } catch {
    // last rung failed — caller falls back to original text
  }
  return null;
}
