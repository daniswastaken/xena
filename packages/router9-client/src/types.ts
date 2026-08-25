/**
 * Shared OpenAI-compatible API types for the 9Router gateway.
 * Kept minimal — only what Xena actually consumes.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImageUrlPart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type MessageContent = string | Array<TextPart | ImageUrlPart>;

export interface ChatMessage {
  role: ChatRole;
  content: MessageContent;
}

export interface ChatRequestOptions {
  /** e.g. "oc/big-pickle" */
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** AbortSignal to cancel an in-flight stream or request */
  signal?: AbortSignal;
}

export interface ChatChoiceMessage {
  role: "assistant";
  content: string | null;
  reasoning_content?: string | null;
}

export interface ChatCompletionResult {
  id: string;
  model: string;
  content: string;
  reasoning: string | null;
  finishReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface ModelInfo {
  id: string;
  owned_by?: string;
}

export class Router9Error extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Router9 ${status}: ${message}`);
    this.name = "Router9Error";
  }
}
