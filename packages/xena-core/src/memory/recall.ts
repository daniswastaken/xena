/**
 * Keyword-scored recall over past session transcripts.
 * Pure local scoring (term overlap + recency) — no embeddings, no extra
 * inference calls. Surfaces relevant fragments from earlier conversations
 * so Xena "remembers" across sessions.
 */
import { MemoryStore } from "./store.js";
import { Diary } from "./diary.js";
import type { ChatMessage } from "@xena/router9-client";

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "that",
  "this", "have", "has", "was", "were", "what", "when", "where", "who", "how",
  "why", "can", "could", "would", "should", "will", "shall", "does", "did",
  "about", "into", "over", "under", "again", "then", "them", "they", "there",
  "here", "from", "just", "like", "some", "more", "than", "also", "been",
  "being", "its", "it's", "i'm", "i've", "don't", "doesn't", "didn't",
]);

export interface RecallHit {
  sessionId: string;
  updatedAt: string;
  /** Best matching message content, trimmed around the first hit. */
  snippet: string;
  score: number;
}

export interface RecallOptions {
  excludeSessionId?: string;
  topK?: number;
}

function tokenize(text: string): string[] {
  const stripped = text.toLowerCase().replace(/'s(\W|$)/g, "$1");
  return stripped
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function snippetAround(content: string, terms: Set<string>, maxLen = 280): string {
  const lower = content.toLowerCase();
  let anchor = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (anchor === -1 || idx < anchor)) anchor = idx;
  }
  if (anchor === -1) return content.slice(0, maxLen);
  const start = Math.max(0, anchor - 100);
  const end = Math.min(content.length, start + maxLen);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

function scoreText(text: string, terms: string[]): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let score = 0;
  for (const term of terms) {
    const c = counts.get(term);
    if (c) score += 1 + Math.min(c - 1, 3) * 0.25;
  }
  return score;
}

function scoreMessage(message: ChatMessage, terms: string[]): number {
  const s = scoreText(typeof message.content === "string" ? message.content : "", terms);
  // slight preference toward user-authored lines
  return message.role === "user" ? s * 1.15 : s;
}

function scoreLine(line: string, terms: string[]): number {
  return scoreText(line, terms);
}

function recencyBonus(updatedAt: string, now: number): number {
  const stamp = Date.parse(updatedAt);
  if (Number.isNaN(stamp)) return 0;
  const ageDays = (now - stamp) / 86_400_000;
  if (ageDays <= 1) return 1.5;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.5;
  return 0;
}

export class MemoryRecall {
  private readonly diary: Diary | null = null;

  constructor(
    private readonly store: MemoryStore,
    diaryDir?: string,
  ) {
    if (diaryDir) this.diary = new Diary(store, diaryDir);
  }

  async recall(query: string, options: RecallOptions = {}): Promise<RecallHit[]> {
    const topK = options.topK ?? 3;
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];

    const now = Date.now();
    const hits: RecallHit[] = [];

    // Diary entries: dense curated facts, scored per line.
    if (this.diary) {
      try {
        for (const entry of await this.diary.listAll()) {
          for (const line of entry.body.split("\n")) {
            const trimmed = line.replace(/^[-*\s]+/, "").trim();
            if (trimmed.length < 12) continue;
            const raw = scoreLine(trimmed, terms);
            if (raw <= 0) continue; // no term overlap — skip despite density bonus
            const s = raw + 1.25; // density bonus: curated facts outrank raw chat
            hits.push({
              sessionId: `diary-${entry.date}`,
              updatedAt: entry.date,
              snippet: trimmed.slice(0, 280),
              score: s + recencyBonus(entry.date, now),
            });
          }
        }
      } catch {
        // diaries are optional
      }
    }

    for (const transcript of await this.store.listAll()) {
      if (options.excludeSessionId && transcript.meta?.id === options.excludeSessionId) continue;
      let bestScore = 0;
      let bestSnippet = "";
      for (const message of transcript.messages) {
        const s = scoreMessage(message, terms);
        if (s > bestScore) {
          bestScore = s;
          bestSnippet = snippetAround(
            typeof message.content === "string" ? message.content : "",
            new Set(terms),
          );
        }
      }
      if (bestScore > 0 && bestSnippet.trim() !== "") {
        hits.push({
          sessionId: transcript.meta?.id ?? "unknown",
          updatedAt: transcript.meta?.updatedAt ?? "",
          snippet: bestSnippet.replace(/\s+/g, " ").trim(),
          score: bestScore + recencyBonus(transcript.meta?.updatedAt ?? "", now),
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

/** Renders recall hits as a system-prompt context block. */
export function renderRecallContext(hits: RecallHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits.map((h) => `- (${h.updatedAt.slice(0, 10)}) ${h.snippet}`);
  return [
    "[fragments from earlier conversations — may be relevant, never claim certain knowledge of them]",
    ...lines,
  ].join("\n");
}
