/**
 * Transcript persistence — JSON file, one session per file.
 * Upgrade path: SQLite behind the same interface.
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChatMessage } from "@xena/router9-client";

export interface SessionMeta {
  id: string;
  startedAt: string;
  updatedAt: string;
}

export interface StoredTranscript {
  meta: SessionMeta;
  messages: ChatMessage[];
}

export class MemoryStore {
  constructor(private readonly baseDir: string) {}

  private pathFor(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.json`);
  }

  async load(sessionId: string): Promise<StoredTranscript | null> {
    try {
      const raw = await readFile(this.pathFor(sessionId), "utf8");
      return JSON.parse(raw) as StoredTranscript;
    } catch {
      return null;
    }
  }

  async save(transcript: StoredTranscript): Promise<void> {
    const file = this.pathFor(transcript.meta.id);
    await mkdir(dirname(file), { recursive: true });
    transcript.meta.updatedAt = new Date().toISOString();
    await writeFile(file, JSON.stringify(transcript, null, 2), "utf8");
  }

  /** Deletes transcript files not modified within `days`. Returns count removed. */
  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60_000;
    let removed = 0;
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return 0;
    }
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const file = join(this.baseDir, name);
      try {
        const raw = await readFile(file, "utf8");
        const parsed = JSON.parse(raw) as StoredTranscript;
        const stamp = Date.parse(parsed.meta?.updatedAt ?? "");
        if (!Number.isNaN(stamp) && stamp < cutoff) {
          await unlink(file);
          removed++;
        }
      } catch {
        // unreadable file — leave it alone
      }
    }
    return removed;
  }
}
