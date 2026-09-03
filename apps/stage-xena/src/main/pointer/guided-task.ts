/** Interactive screen guidance: plan one visible action, wait for its result, repeat. */
import { nativeImage, screen } from "electron";
import { buildSystemPrompt, extractEmotion, extractFactTags } from "@xena/xena-core";
import { visionCompleteFailover, type InferenceConfig } from "@xena/inference-gateway";
import { captureScreenDataUrl } from "../capture/screenshot.js";
import { CHANNELS } from "../ipc/channels.js";
import type { PointerWindow } from "../window/pointer-window.js";

const STEP_TIMEOUT_MS = 90_000;
const POLL_MS = 1_000;
const MAX_STEPS = 10;

export interface GuidedTaskHooks {
  send(text: string): void;
  sendDone(): void;
  emote(mood: string): void;
  speak(text: string, mood?: string): Promise<void>;
  append(role: "user" | "assistant", text: string): Promise<void>;
}

interface Plan {
  status: "continue" | "done" | "clarify" | "unknown";
  target: string | null;
  instruction: string;
  x: number | null;
  y: number | null;
}

export function looksLikeGuidedTask(text: string): boolean {
  return (
    /\b(?:how do i|how can i|how to|where do i|what do i click|show me how|teach me how|walk me through|guide me|help me (?:open|launch|find|navigate|create|set|change|use))\b/i.test(text) ||
    /^(?:please\s+)?(?:open|launch|navigate to|show me where|find and click)\b/i.test(text.trim())
  );
}

export class GuidedTask {
  private cancelled = false;

  constructor(
    private readonly config: InferenceConfig,
    private readonly pointer: PointerWindow,
    private readonly hooks: GuidedTaskHooks,
  ) {}

  cancel(): void {
    this.cancelled = true;
    this.pointer.hide();
  }

  async run(goal: string): Promise<void> {
    this.cancelled = false;
    await this.hooks.append("user", `[guided task] ${goal}`);
    let previousCapture: string | null = null;

    try {
      for (let step = 0; step < MAX_STEPS && !this.cancelled; step++) {
        const dataUrl = await this.captureWithoutPointer();
        const plan = await this.plan(goal, dataUrl, step, previousCapture !== null);
        if (this.cancelled) return;

        if (plan.status === "done" || plan.status === "clarify" || plan.status === "unknown") {
          await this.finish(plan.instruction || fallbackFor(plan.status));
          return;
        }
        if (!plan.target || !plan.instruction) {
          await this.finish("[annoyed] I couldn't work out the next step. Tell me what you see, Father.");
          return;
        }

        const coords =
          plan.x !== null && plan.y !== null
            ? { x: plan.x, y: plan.y }
            : await this.refineCoords(plan.target, dataUrl);
        if (!coords) {
          await this.finish(`[surprised] I know the next step, but my cursor drifted — which ${plan.target} do you see, Father?`);
          return;
        }
        const bounds = screen.getPrimaryDisplay().bounds;
        // Establish baseline without Xena's overlay. Pointer itself cannot
        // count as the user's screen change.
        previousCapture = await this.captureWithoutPointer();
        void this.pointer.pointAt(
          bounds.x + coords.x * bounds.width,
          bounds.y + coords.y * bounds.height,
          plan.target,
          0,
        ).catch(() => undefined);
        // Pointer movement and Xena's instruction run concurrently.
        await this.say(plan.instruction);
        const changed = await this.waitForScreenChange(previousCapture);
        if (!changed && !this.cancelled) {
          await this.finish("[sleepy] I didn't see your screen change. Did that step work, Father?");
          return;
        }
      }
      if (!this.cancelled) await this.finish("[annoyed] This is taking too many steps. Tell me where you got stuck, Father.");
    } finally {
      this.pointer.finish();
    }
  }

  private async plan(goal: string, dataUrl: string, step: number, afterAction: boolean): Promise<Plan> {
    const phase = afterAction
      ? "The user completed a visible screen change. Re-evaluate the new screen and choose the next action."
      : "This is the starting screen. Infer the first practical action even if the final destination is not visible yet.";
    const prompt = `${phase}
Goal: ${goal}
Step: ${step + 1} of ${MAX_STEPS}

Act as an interactive desktop tutor. Use visual reasoning, not word matching. Plan the next action that moves toward the goal on an arbitrary Windows desktop or application. The target may be a launcher, icon, menu, button, field, or other visible control. Never claim the final destination is missing merely because it is not on this screen. For a text field, instruction should include what to type and how to submit it, so one step produces a visible result.

Return ONLY JSON, no markdown:
{"status":"continue|done|clarify|unknown","target":"short visible target description or null","x":0.0,"y":0.0,"instruction":"one human-readable sentence Xena should say"}

CRITICAL: you MUST always include "x" and "y" as normalized decimals from 0.0 to 1.0 (left-to-right, top-to-bottom) for the CENTER of the target element. Never omit them when a target is named. If no target is visible, use status "unknown" or "clarify".

Use continue when the user must perform another visible action. Use done only when the goal is visibly complete. Use clarify when the screen is ambiguous and ask a specific question. Use unknown when you genuinely do not know how to proceed. Instructions must tell Father exactly what to do; Xena's cursor points at target. Never click, type, or control the user's computer yourself.`;
    try {
      const result = await visionCompleteFailover(
        [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        { maxTokens: 700, signal: AbortSignal.timeout(60_000) },
        this.config,
      );
      return parseGuidedPlan(result.content);
    } catch {
      return { status: "unknown", target: null, x: null, y: null, instruction: "[sad] I had a little hiccup reaching my vision brain, Father. Try asking again." };
    }
  }

  /**
   * Resolve screen coordinates for a named target when the planner omitted
   * them. Loops through the provider chain several times — the free vision
   * models frequently return HTTP-200-empty, and one call is not enough.
   */
  private async refineCoords(target: string, dataUrl: string): Promise<{ x: number; y: number } | null> {
    const bounds = screen.getPrimaryDisplay().bounds;
    const prompt = `On this screen, where is the center of "${target}"? Consider desktop icons, taskbar, active windows, menus, and controls. Reply with ONLY JSON: {"x":0.0,"y":0.0} as normalized coordinates (0..1, x left-to-right, y top-to-bottom), or {"error":"not found"}.`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
          { maxTokens: 400, signal: AbortSignal.timeout(45_000) },
          this.config,
        );
        const coords = parseCoords(result.content, bounds.width, bounds.height);
        if (coords) return coords;
      } catch {
        /* retry */
      }
      await delay(900);
    }
    return null;
  }

  private async waitForScreenChange(baseline: string): Promise<boolean> {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (!this.cancelled && Date.now() < deadline) {
      await delay(POLL_MS);
      const current = await captureScreenDataUrl();
      if (screenChanged(baseline, current)) {
        await delay(1_200);
        return true;
      }
    }
    return false;
  }

  private async captureWithoutPointer(): Promise<string> {
    this.pointer.hide();
    await delay(120);
    try {
      return await captureScreenDataUrl();
    } finally {
      // Caller immediately repositions it when another action exists.
    }
  }

  private async say(raw: string): Promise<void> {
    const parsed = extractEmotion(raw);
    const mood = parsed.emotion;
    // Fact tags are protocol metadata — never displayed, never spoken.
    const { clean } = extractFactTags(parsed.clean);
    if (clean === "") return;
    if (mood) this.hooks.emote(mood);
    this.hooks.send(clean);
    await this.hooks.append("assistant", clean);
    await this.hooks.speak(clean, mood ?? undefined);
  }

  private async finish(text: string): Promise<void> {
    await this.say(text);
    this.hooks.sendDone();
  }
}

export function screenChanged(before: string, after: string): boolean {
  const a = nativeImage.createFromDataURL(before).resize({ width: 96, height: 54 }).toBitmap();
  const b = nativeImage.createFromDataURL(after).resize({ width: 96, height: 54 }).toBitmap();
  if (a.length !== b.length || a.length === 0) return true;
  let changed = 0;
  let totalDelta = 0;
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
    totalDelta += delta;
    if (delta > 72) changed++;
  }
  return changed / pixels > 0.012 || totalDelta / pixels > 10;
}

export function parseGuidedPlan(raw: string): Plan {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return { status: "unknown", target: null, x: null, y: null, instruction: "[sad] I don't know how to guide this yet, Father." };
  try {
    const value = JSON.parse(match[0]) as Partial<Plan> & { x?: number | string; y?: number | string };
    const status = value.status;
    if (status !== "continue" && status !== "done" && status !== "clarify" && status !== "unknown") {
      throw new Error("invalid status");
    }
    const target = typeof value.target === "string" ? value.target.trim() : null;
    const instruction = typeof value.instruction === "string" ? value.instruction.trim() : "";
    // Accept 0..1 normalized, pixel values (converted below), or strings.
    const x = coerceCoord(value.x);
    const y = coerceCoord(value.y);
    return { status, target, x, y, instruction };
  } catch {
    return { status: "unknown", target: null, x: null, y: null, instruction: "[sad] I don't know how to guide this yet, Father." };
  }
}

/** Parse a coordinate that may be a normalized decimal, a pixel value, or a string. */
function coerceCoord(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value).trim());
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return n;
  // Possibly pixel coordinates on a typical screen — normalize loosely.
  if (n > 1 && n < 5000) return Math.min(1, n / 1920);
  return null;
}

/**
 * Extract normalized x,y from a vision reply. Accepts {"x":..,"y":..} with
 * normalized or pixel values, and tolerates stray prose around the JSON.
 */
function parseCoords(raw: string, _width: number, _height: number): { x: number; y: number } | null {
  const match = /\{[^{}]*\}/.exec(raw);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as { x?: number | string; y?: number | string; error?: string };
    if (value.error) return null;
    const x = coerceCoord(value.x);
    const y = coerceCoord(value.y);
    if (x === null || y === null) return null;
    return { x, y };
  } catch {
    return null;
  }
}

function fallbackFor(status: Plan["status"]): string {
  if (status === "done") return "[happy] That task is finished, Father.";
  if (status === "clarify") return "[surprised] Tell me which option you want, Father.";
  return "[sad] I don't know how to guide this yet, Father.";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
