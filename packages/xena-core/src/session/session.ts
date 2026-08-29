/**
 * Conversation session: assembles system prompt + recalled memory +
 * trimmed history, streams completions with provider failover,
 * persists the transcript.
 */
import { streamChatFailover, type ChatMessage } from "@xena/inference-gateway";
import type { InferenceConfig } from "@xena/inference-gateway";
import { buildSystemPrompt } from "../persona/prompt.js";
import { MemoryStore, type StoredTranscript } from "../memory/store.js";
import { MemoryRecall, renderRecallContext } from "../memory/recall.js";
import { FactsStore } from "../memory/facts.js";

export interface SessionEvents {
  onToken?: (fullText: string) => void;
  onError?: (error: Error) => void;
  /** Reasoning-model deltas before content starts (thinking indicator). */
  onReasoning?: (delta: string) => void;
}

export interface SessionOptions {
  sessionId: string;
  storeDir: string;
  config?: InferenceConfig;
  /** max non-system messages kept in the request context */
  historyLimit?: number;
  /** override the text model from config */
  model?: string;
  /** when set, recall also scores nightly diary entries */
  diaryDir?: string;
  /** when set, /remember facts are injected authoritatively */
  factsPath?: string;
}

const DEFAULT_HISTORY_LIMIT = 24;

export class Session {
  readonly id: string;
  private messages: ChatMessage[] = [];
  private readonly baseSystem: string;
  private readonly store: MemoryStore;
  private readonly recall: MemoryRecall;
  private readonly facts: FactsStore | null;
  private readonly historyLimit: number;
  private readonly model: string | undefined;
  private readonly config: InferenceConfig;
  private controller: AbortController | null = null;

  constructor(options: SessionOptions, config: InferenceConfig) {
    this.id = options.sessionId;
    this.config = config;
    this.store = new MemoryStore(options.storeDir);
    this.recall = new MemoryRecall(this.store, options.diaryDir);
    this.facts = options.factsPath ? new FactsStore(options.factsPath) : null;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.model = options.model ?? config.textModel;
    this.baseSystem = buildSystemPrompt();
  }

  static async open(
    options: SessionOptions,
    config: InferenceConfig,
  ): Promise<{ session: Session; transcript: StoredTranscript | null }> {
    const session = new Session(options, config);
    const transcript = await session.store.load(session.id);
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
    const system = await this.assembledSystemPrompt(userText);
    const payload = [system, ...this.trimmedHistory()];
    let accumulated = "";
    this.controller = new AbortController();
    try {
      const { full } = await streamChatFailover(
        payload,
        {
          model: this.model,
          maxTokens: 150,
          signal: this.controller.signal,
          onReasoning: (delta) => events.onReasoning?.(delta),
        },
        (delta) => {
          accumulated += delta;
          events.onToken?.(accumulated);
        },
        this.config,
      );
      await this.append({ role: "assistant", content: full });
      return full;
    } catch (error) {
      events.onError?.(error instanceof Error ? error : new Error(String(error)));
      return accumulated;
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

  /**
   * System prompt enriched with relevant fragments of past conversations.
   * Recall failure must never break the chat.
   */
  private async assembledSystemPrompt(userText: string): Promise<ChatMessage> {
    let content = this.baseSystem;
    try {
      if (this.facts) {
        const factsBlock = await this.facts.renderPromptBlock();
        if (factsBlock) content += `\n\n${factsBlock}`;
      }
      const hits = await this.recall.recall(userText, { excludeSessionId: this.id });
      const block = renderRecallContext(hits);
      if (block) content += `\n\n${block}`;
    } catch {
      // no recall — plain prompt
    }
    return { role: "system", content };
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
