/**
 * Nightly diary: end-of-day summarization of the day's transcript into a
 * compact, in-character memory file (data/diary/YYYY-MM-DD.md).
 * Diaries are dense facts — recall scores them alongside raw transcripts,
 * giving Xena durable long-term memory without embeddings.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chatCompleteFailover } from "@xena/inference-gateway";
import type { InferenceConfig } from "@xena/inference-gateway";
import { buildSystemPrompt } from "../persona/prompt.js";
import type { MemoryStore, StoredTranscript } from "./store.js";

const DIARY_PROMPT = `Below is today's conversation transcript with the user.
Write a short diary entry (3-6 bullet lines, max ~80 words) capturing durable facts
about the user: preferences, projects, people, schedule, mood patterns, running jokes.
Facts only — no filler, no greetings. Prefix the entry with a line "DIARY <date>".
Skip the diary entirely (reply with just "SKIP") if nothing durable happened.

Transcript:
`;

export class Diary {
  constructor(
    private readonly store: MemoryStore,
    private readonly diaryDir: string,
  ) {}

  /** Summarizes a finished session into its diary file. Returns the path or null. */
  async writeForSession(
    sessionId: string,
    config: InferenceConfig,
  ): Promise<string | null> {
    const transcript = await this.store.load(sessionId);
    if (!transcript || transcript.messages.length < 4) return null;
    const text = renderTranscript(transcript);
    if (text.length < 80) return null;

    let entry: string;
    try {
      const result = await chatCompleteFailover(
        [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: DIARY_PROMPT + text.slice(-6000) },
        ],
        { maxTokens: 300, temperature: 0.4 },
        config,
      );
      entry = result.content.trim();
    } catch {
      return null; // best-effort — no diary tonight
    }
    if (entry === "" || /^skip\b/i.test(entry)) return null;

    const date = sessionId.replace(/^default-/, "") || new Date().toISOString().slice(0, 10);
    const body = entry.startsWith("DIARY") ? entry : `DIARY ${date}\n${entry}`;
    await mkdir(this.diaryDir, { recursive: true });
    const file = join(this.diaryDir, `${date}.md`);
    await writeFile(file, body + "\n", "utf8");
    return file;
  }

  /** Loads all diary entries, newest last. */
  async listAll(): Promise<Array<{ date: string; body: string }>> {
    let names: string[];
    try {
      names = await readdir(this.diaryDir);
    } catch {
      return [];
    }
    const out: Array<{ date: string; body: string }> = [];
    for (const name of names.sort()) {
      if (!name.endsWith(".md")) continue;
      try {
        const body = await readFile(join(this.diaryDir, name), "utf8");
        out.push({ date: name.replace(/\.md$/, ""), body });
      } catch {
        // unreadable — skip
      }
    }
    return out;
  }
}

function renderTranscript(transcript: StoredTranscript): string {
  return transcript.messages
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : "[media]"}`)
    .join("\n");
}
