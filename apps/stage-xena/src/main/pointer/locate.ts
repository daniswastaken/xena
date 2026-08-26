/**
 * Vision locate: given a target description, capture the screen and ask the
 * vision model for normalized center coordinates of that target.
 */
import { visionCompleteFailover, type Router9Config } from "@xena/router9-client";
import { captureScreenDataUrl } from "../capture/screenshot.js";

export interface ScreenPoint {
  x: number;
  y: number;
}

const LOCATE_PROMPT = (target: string) =>
  `Locate "${target}" on this screenshot. Reply with ONLY a JSON object: ` +
  `{"x": <0..1 left-to-right>, "y": <0..1 top-to-bottom>} for the center of the element, ` +
  `or {"error":"not found"} if it is not visible. No other text.`;

const LOCATE_RETRY_PROMPT = (target: string) =>
  `Look carefully at this screenshot, including the taskbar, desktop icons, and window edges. ` +
  `Locate "${target}". Reply with ONLY a JSON object: ` +
  `{"x": <0..1>, "y": <0..1>} for its center, or {"error":"not found"}. No other text.`;

export async function locateOnScreen(
  target: string,
  config: Router9Config,
): Promise<ScreenPoint | null> {
  const dataUrl = await captureScreenDataUrl();
  // Vision locate is nondeterministic on small targets — one guided retry,
  // all attempts sharing a single 45s budget (reasoning vision models are slow).
  const deadline = AbortSignal.timeout(90_000);
  const first = await locateOnce(dataUrl, LOCATE_PROMPT(target), config, deadline);
  return first ?? locateOnce(dataUrl, LOCATE_RETRY_PROMPT(target), config, deadline);
}

async function locateOnce(
  dataUrl: string,
  prompt: string,
  config: Router9Config,
  signal: AbortSignal,
): Promise<ScreenPoint | null> {
  const result = await visionCompleteFailover(
    [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    {
      maxTokens: 200,
      // Per-attempt cap: a hung provider fails over instead of eating the budget.
      signal: AbortSignal.any([AbortSignal.timeout(45_000), signal]),
    },
    config,
  );
  const text = result.content.trim();
  // Tolerate code fences around the JSON.
  const match = /\{[^{}]*\}/.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { x?: number; y?: number; error?: string };
    if (typeof parsed.error === "string") return null;
    const { x, y } = parsed;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > 1 ||
      y < 0 ||
      y > 1
    ) {
      return null;
    }
    return { x, y };
  } catch {
    return null;
  }
}


