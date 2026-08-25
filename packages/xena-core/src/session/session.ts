/**
 * Conversation session: assembles system prompt + trimmed history,
 * streams completions, persists the transcript.
 */
import { streamChat } from "@xena/router9-client";
import type { ChatMessage, Router9Config } from "@xena/router9-client";
import { buildSystemPrompt } from "../persona/prompt.js";
import { MemoryStore, type StoredTranscript } from "../memory/store.js";

export interface SessionEvents {
  onToken?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export interface SessionOptions {
  sessionId: string;
  storeDir: string;
  config?: Router9Config;
  /** max non-system messages kept in the request context */
  historyLimit?: number;
  /** override the text model from config */
  model?: string;
}

const DEFAULT_HISTORY_LIMIT = 24;

export class Session {
  readonly id: string;
  private messages: ChatMessage[] = [];
  private readonly system: ChatMessage;
  private readonly store: MemoryStore;
  private readonly historyLimit: number;
  private readonly model: string;
  private controller: AbortController | null = null;

  constructor(options: SessionOptions, config: Router9Config) {
    this.id = options.sessionId;
    this.store = new MemoryStore(options.storeDir);
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.model = options.model ?? config.textModel;
    this.system = { role: "system", content: buildSystemPrompt() };
  }

  static async open(
    options: SessionOptions,
    config: Router9Config,
  ): Promise<{ session: Session; transcript: StoredTranscript | null }> {
    const session = new Session(options, config);
    const store = new MemoryStore(options.storeDir);
    const transcript = await store.load(session.id);
    if (transcript) session.messages = transcript.messages;
    return { session, transcript };
  }

  history(): ReadonlyArray<ChatMessage> {
    return this.messages;
  }

  /** Appends a message and persists. */
  async append(message: ChatMessage): Promise<void> {
    this.messages.push(message);
    await this.persist();
  }

  async send(userText: string, events: SessionEvents = {}): Promise<string> {
    await this.append({ role: "user", content: userText });
    const payload = [this.system, ...this.trimmedHistory()];
    let full = "";
    this.controller = new AbortController();
    try {
      full = await streamChat(
        payload,
        { model: this.model, maxTokens: 700, signal: this.controller.signal },
        (delta) => {
          full += delta;
          events.onToken?.(full);
        },
      );
      await this.append({ role: "assistant", content: full });
      return full;
    } catch (error) {
      events.onError?.(error instanceof Error ? error : new Error(String(error)));
      return full;
    } finally {
      this.controller = null;
    }
  }

  abort(): void {
    this.controller?.abort();
  }

  /** Wipes conversation history (in memory + on disk). */
  async reset(): Promise<void> {
    this.abort();
    this.messages = [];
    await this.persist();
  }

  private trimmedHistory(): ChatMessage[] {
    return this.messages.slice(-this.historyLimit);
  }

  private async persist(): Promise<void> {
    const now = new Date().toISOString();
    await this.store.save({
      meta: { id: this.id, startedAt: now, updatedAt: now },
      messages: this.messages,
    });
  }
}
