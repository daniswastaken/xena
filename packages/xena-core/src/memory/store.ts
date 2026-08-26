/**
 * Transcript persistence — SQLite (node:sqlite, zero deps) with one row per
 * session; messages stored as a JSON column. Legacy per-day JSON files are
 * imported once on first sight. Diary + facts stay as files (human-editable).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
  private readonly db: DatabaseSync;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    mkdirSync(baseDir, { recursive: true });
    this.db = new DatabaseSync(join(baseDir, "transcripts.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        messages TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
    `);
    this.importLegacyJsonFiles();
  }

  async load(sessionId: string): Promise<StoredTranscript | null> {
    const row = this.db
      .prepare("SELECT id, started_at, updated_at, messages FROM sessions WHERE id = ?")
      .get(sessionId) as
      | { id: string; started_at: string; updated_at: string; messages: string }
      | undefined;
    if (!row) return null;
    return {
      meta: { id: row.id, startedAt: row.started_at, updatedAt: row.updated_at },
      messages: JSON.parse(row.messages) as ChatMessage[],
    };
  }

  async save(transcript: StoredTranscript): Promise<void> {
    const now = new Date().toISOString();
    const meta = transcript.meta;
    this.db
      .prepare(
        `INSERT INTO sessions (id, started_at, updated_at, messages) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, messages = excluded.messages`,
      )
      .run(meta.id, meta.startedAt || now, now, JSON.stringify(transcript.messages));
  }

  async listAll(): Promise<StoredTranscript[]> {
    const rows = this.db
      .prepare("SELECT id, started_at, updated_at, messages FROM sessions ORDER BY updated_at")
      .all() as Array<{ id: string; started_at: string; updated_at: string; messages: string }>;
    return rows.map((row) => ({
      meta: { id: row.id, startedAt: row.started_at, updatedAt: row.updated_at },
      messages: JSON.parse(row.messages) as ChatMessage[],
    }));
  }

  /** Deletes sessions not modified within `days`. Returns count removed. */
  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = this.db.prepare("DELETE FROM sessions WHERE updated_at < ?").run(cutoff);
    return Number(result.changes);
  }

  /** Releases the SQLite file handle (Windows locks open DBs). */
  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }

  /**
   * One-time import of pre-SQLite per-day JSON transcripts. Files already
   * present in the DB are skipped, so this is cheap after the first run.
   */
  private importLegacyJsonFiles(): void {
    let names: string[];
    try {
      names = readdirSync(this.baseDir);
    } catch {
      return;
    }
    const known = new Set(
      (this.db.prepare("SELECT id FROM sessions").all() as Array<{ id: string }>).map((r) => r.id),
    );
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(
          readFileSync(join(this.baseDir, name), "utf8"),
        ) as StoredTranscript;
        if (!parsed?.meta?.id || known.has(parsed.meta.id)) continue;
        if (!Array.isArray(parsed.messages)) continue;
        this.db
          .prepare("INSERT OR IGNORE INTO sessions (id, started_at, updated_at, messages) VALUES (?, ?, ?, ?)")
          .run(
            parsed.meta.id,
            parsed.meta.startedAt || nowIso(),
            parsed.meta.updatedAt || nowIso(),
            JSON.stringify(parsed.messages),
          );
      } catch {
        // unreadable legacy file — skip
      }
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
