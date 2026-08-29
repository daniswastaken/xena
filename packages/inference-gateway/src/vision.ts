/**
 * Vision helpers — same shapes as router9-client's, wired to the gateway chain.
 */
import type { InferenceConfig } from "./config.js";
import { visionCompleteFailover, type FailoverOptions } from "./chain.js";
import type { ChatMessage } from "@xena/router9-client";
import { Router9Error } from "@xena/router9-client";

export function imageDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

export function buildImageMessage(question: string, dataUrl: string): ChatMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: question },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
  };
}

export async function askAboutImage(
  question: string,
  dataUrl: string,
  config: InferenceConfig,
  systemPrompt?: string,
): Promise<string> {
  const result = await visionCompleteFailover(
    [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      buildImageMessage(question, dataUrl),
    ],
    { maxTokens: 120 },
    config,
  );
  return result.content;
}

// Router9Error re-export keeps `instanceof` checks working for callers
// that inspect errors directly (scripts, tests).
export { Router9Error };
