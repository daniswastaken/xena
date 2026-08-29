/**
 * Error presentation — maps classified InferenceError kinds to Xena-voice
 * surface lines. Raw provider detail (status codes, hostnames, body
 * snippets) NEVER crosses this boundary; it goes to console.error only.
 *
 * Surfaces:
 *   bubble   : persona line, mood drives the face via avatarEmote
 *   bar      : plain short line for /look, /stats, voice paths
 *   OS toast : plain English, recovery reassurance, no provider names
 *   tray     : technical diagnostics allowed (supervisor.describe())
 */
import { InferenceError, type InferenceErrorKind } from "@xena/inference-gateway";

export interface SurfaceLine {
  /** Persona-voice line for the bubble. */
  line: string;
  /** Mood tag for the face (drives avatarEmote). */
  mood: string;
}

const BUBBLE: Record<InferenceErrorKind, SurfaceLine | null> = {
  aborted: null, // user's own stop — silence
  "all-down": { line: "...my thoughts feel far away right now. Give me a moment, Father.", mood: "sleepy" },
  quota: { line: "I've talked myself hoarse today — gimme a minute to catch my breath.", mood: "annoyed" },
  timeout: { line: "That one slipped away from me... ask me again?", mood: "sleepy" },
  empty: { line: "Huh. Nothing came to me just now — try once more?", mood: "surprised" },
  stt: { line: "I couldn't hear that clearly — try again?", mood: "annoyed" },
  unknown: { line: "Something went sideways in my head. Try again in a moment.", mood: "annoyed" },
};

const GUIDED_TASK: SurfaceLine = {
  line: "I lost my footing here — say *continue* when you're ready.",
  mood: "annoyed",
};

const NOTIFY: Record<InferenceErrorKind, string> = {
  aborted: "",
  "all-down": "Xena can't reach her thoughts right now — she'll recover on her own and keep trying.",
  quota: "Xena's free AI quota is stretched thin — she'll recover automatically in a few minutes.",
  timeout: "Xena's thoughts are moving slowly — she'll recover on her own.",
  empty: "Xena's providers returned nothing just now — she'll retry automatically.",
  stt: "Xena couldn't make out the audio.",
  unknown: "Something went wrong in Xena's head — she'll recover on her own.",
};

const BAR: Record<InferenceErrorKind, string> = {
  aborted: "",
  "all-down": "Couldn't think right now — try again in a moment.",
  quota: "Free AI quota is stretched — try again in a few minutes.",
  timeout: "Took too long — try again.",
  empty: "Got nothing back — try again.",
  stt: "Couldn't catch that — try again or type it instead.",
  unknown: "That didn't work — try again in a moment.",
};

/** Extract the classified kind from any thrown error. */
export function errorKind(error: unknown): InferenceErrorKind {
  if (error instanceof InferenceError) return error.kind;
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "unknown";
}

/** Bubble line for a failed reply; null = stay silent (abort). */
export function bubbleLine(error: unknown): SurfaceLine | null {
  return BUBBLE[errorKind(error)];
}

/** Fixed line for guided-task collapse (its own flavor of failure). */
export function guidedTaskLine(): SurfaceLine {
  return GUIDED_TASK;
}

/** Plain-English toast body; empty = no toast. */
export function notifyLine(error: unknown): string {
  return NOTIFY[errorKind(error)];
}

/** Short plain bar line; empty = silent. */
export function barLine(error: unknown): string {
  return BAR[errorKind(error)];
}

/** Raw technical detail — console only, never a UI surface. */
export function rawDetail(error: unknown): string {
  if (error instanceof InferenceError) return `${error.kind}: ${error.detail}`;
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
