/**
 * Inference error taxonomy. Adapters throw raw HTTP errors; the chain walk
 * classifies the final failure into exactly one kind. UI layers map kinds
 * to persona lines — raw provider detail (status codes, hostnames) never
 * reaches the bubble.
 */
export type InferenceErrorKind =
  | "aborted"
  | "all-down"
  | "quota"
  | "timeout"
  | "empty"
  | "stt"
  | "unknown";

export class InferenceError extends Error {
  readonly kind: InferenceErrorKind;
  /** Raw technical detail — console/tray diagnostics only, never the bubble. */
  readonly detail: string;

  constructor(kind: InferenceErrorKind, detail: string, message?: string) {
    super(message ?? `inference failed (${kind})`);
    this.name = "InferenceError";
    this.kind = kind;
    this.detail = detail;
  }
}
