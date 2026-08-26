/**
 * User-taught facts ("/remember <fact>"). Curated, authoritative memory —
 * injected whole into the system prompt (bounded), unlike scored recall.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface Fact {
  text: string;
  createdAt: string;
}

const MAX_FACTS = 64;

export class FactsStore {
  constructor(private readonly filePath: string) {}

  async listAll(): Promise<Fact[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { facts?: Fact[] };
      return Array.isArray(parsed.facts) ? parsed.facts : [];
    } catch {
      return [];
    }
  }

  async add(text: string): Promise<Fact> {
    const fact: Fact = { text, createdAt: new Date().toISOString() };
    const facts = await this.listAll();
    facts.push(fact);
    // Oldest facts fall off when the cap is hit — prompt space is finite.
    const trimmed = facts.slice(-MAX_FACTS);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ facts: trimmed }, null, 2), "utf8");
    return fact;
  }

  /** Replaces the full fact list (used by /forget). */
  async rewrite(facts: Fact[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ facts }, null, 2), "utf8");
  }

  /** Renders the system-prompt block; empty string when no facts. */
  async renderPromptBlock(): Promise<string> {
    const facts = await this.listAll();
    if (facts.length === 0) return "";
    const lines = facts.slice(-12).map((f) => `- ${f.text}`);
    return [
      "[facts the user explicitly asked you to remember — treat as authoritative]",
      ...lines,
    ].join("\n");
  }
}
