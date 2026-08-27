/**
 * Vision helpers — build image messages and ask questions about images.
 * Images travel as base64 data URLs in OpenAI `image_url` format.
 */
import { loadConfig, type Router9Config } from "../config.js";
import { visionCompleteFailover } from "../chat/failover.js";
import type { ChatMessage, ImageUrlPart, TextPart } from "../types.js";

export function imageDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

export function buildImageMessage(question: string, dataUrl: string): ChatMessage {
  const text: TextPart = { type: "text", text: question };
  const image: ImageUrlPart = { type: "image_url", image_url: { url: dataUrl } };
  return { role: "user", content: [text, image] };
}

export async function askAboutImage(
  question: string,
  dataUrl: string,
  config: Router9Config = loadConfig(),
  systemPrompt?: string,
): Promise<string> {
  const result = await visionCompleteFailover(
    [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      buildImageMessage(question, dataUrl),
    ],
    // Vision upstreams are reasoning-style; needs generous token budget.
    { maxTokens: 600 },
    config,
  );
  return result.content;
}
