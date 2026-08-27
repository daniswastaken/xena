/**
 * Emotion expression protocol for the avatar.
 * The model MAY lead a reply with one bracketed mood tag — e.g. "[happy] ..." —
 * which drives the avatar's face. Tags are presentation metadata: stripped
 * from everything the user reads or hears, kept in transcripts so the model
 * sees its own convention in history.
 */

export const EMOTIONS = ["happy", "smug", "surprised", "annoyed", "sleepy", "sad"] as const;

export type Emotion = (typeof EMOTIONS)[number];

const TAG_RE = new RegExp(`\\[(${EMOTIONS.join("|")})\\]`, "gi");

export interface EmotionParseResult {
  /** Text with all mood tags removed and trimmed. */
  clean: string;
  /** First recognized tag, or null when none present. */
  emotion: Emotion | null;
}

export function isEmotion(value: string): value is Emotion {
  return (EMOTIONS as readonly string[]).includes(value);
}

export function extractEmotion(text: string): EmotionParseResult {
  TAG_RE.lastIndex = 0;
  const first = TAG_RE.exec(text);
  const emotion = first ? (first[1]!.toLowerCase() as Emotion) : null;
  // Collapse space runs the removal leaves behind, but keep line structure.
  const clean = text
    .replace(TAG_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { clean, emotion };
}

// --- Fact tag protocol ------------------------------------------------------

const FACT_RE = /\[fact:\s*([^\]]+)\]/gi;

export interface FactParseResult {
  /** Text with all fact tags removed and trimmed. */
  clean: string;
  /** Durable facts the model curated from the conversation. */
  facts: string[];
}

export function extractFactTags(text: string): FactParseResult {
  const facts: string[] = [];
  const clean = text
    .replace(FACT_RE, (_match, captured: string) => {
      facts.push(captured.trim());
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { clean, facts };
}

/** Full presentation cleanup: mood tags + fact tags + roleplay action asterisks. */
export function cleanForDisplay(text: string): string {
  const noActions = text.replace(/\*[^*]+\*/g, "").trim();
  return extractFactTags(extractEmotion(noActions).clean).clean;
}
