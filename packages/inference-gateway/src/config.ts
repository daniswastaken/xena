/**
 * Inference gateway config.
 * Reads .env from the repo root (walks up from cwd) — no dotenv dep needed.
 *
 * Provider priority (primary → last resort):
 *   1. Gemini (gemini-2.5-flash) — free AI Studio key, text + vision in one
 *   2. Gemini flash-lite — same key, higher free RPD headroom
 *   3. 9Router (oc/big-pickle) — reasoning rung, auto-spawned child
 *   4. 9Router free oc/* — existing free-tier last resorts
 *   5. Pollinations (openai-fast) — keyless, zero-config final net
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Router9Config } from "@xena/router9-client";

export interface InferenceConfig extends Router9Config {
  /** Gemini flash-lite rung (same key as primary). */
  geminiLiteModel: string;
  /** Pollinations text model (keyless final rung). */
  pollinationsTextModel: string;
  /** Pollinations vision-capable model, empty = vision chain ends at 9Router. */
  pollinationsVisionModel: string;
  /** Spawn/manage the 9Router child process (default true). */
  nineRouterEnabled: boolean;
}

const DEFAULTS = {
  geminiLiteModel: "gemini-2.5-flash-lite",
  pollinationsTextModel: "openai-fast",
  pollinationsVisionModel: "",
} as const;

function readDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    try {
      const raw = readFileSync(join(dir, ".env"), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && m[1] && m[2] !== undefined && !(m[1] in out)) out[m[1]!] = m[2]!;
      }
      break;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return out;
}

function parseBool(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

let cached: InferenceConfig | null = null;

/**
 * Wraps router9-client's loadConfig (which owns the shared .env fields) and
 * layers the gateway fields on top. Cache can be dropped via resetInference.
 */
export function loadInferenceConfig(env: NodeJS.ProcessEnv = process.env): InferenceConfig {
  if (cached) return cached;
  const file = readDotEnv();
  const base = loadBaseConfig(env, file);
  cached = {
    ...base,
    geminiLiteModel: env.XENA_GEMINI_LITE_MODEL ?? file.XENA_GEMINI_LITE_MODEL ?? DEFAULTS.geminiLiteModel,
    pollinationsTextModel:
      env.XENA_POLLINATIONS_TEXT_MODEL ?? file.XENA_POLLINATIONS_TEXT_MODEL ?? DEFAULTS.pollinationsTextModel,
    pollinationsVisionModel:
      env.XENA_POLLINATIONS_VISION_MODEL ?? file.XENA_POLLINATIONS_VISION_MODEL ?? DEFAULTS.pollinationsVisionModel,
    nineRouterEnabled:
      parseBool(env.XENA_NINEROUTER_ENABLED ?? file.XENA_NINEROUTER_ENABLED) ?? true,
  };
  return cached;
}

/** Drop the cached config — next loadInferenceConfig re-reads .env. */
export function invalidateConfigCache(): void {
  cached = null;
}

/**
 * Re-read .env INTO the same config object long-lived holders captured.
 * Xena's restart-inference action calls this so scheduler/glances/sessions
 * see fresh provider settings without being reconstructed.
 */
export function refreshInPlace(config: InferenceConfig): InferenceConfig {
  const fresh = loadInferenceConfig();
  Object.assign(config, fresh);
  return config;
}

/**
 * router9-client's loadConfig throws when ROUTER9_API_KEY is missing; the
 * gateway treats 9Router as optional, so reimplement the (small) parse
 * without that requirement.
 */
function loadBaseConfig(env: NodeJS.ProcessEnv, file: Record<string, string>): Router9Config {
  const R9_DEFAULTS = {
    baseUrl: "http://localhost:20129/v1",
    textModel: "oc/big-pickle",
    visionModel: "oc/x-preview-f-free",
    fallbackTextModels: ["oc/laguna-s-2.1-free", "oc/mimo-v2.5-free"],
    fallbackVisionModels: ["oc/mimo-v2.5-free"],
  } as const;
  const list = (value: string | undefined): string[] =>
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  return {
    baseUrl: (env.ROUTER9_BASE_URL ?? file.ROUTER9_BASE_URL ?? R9_DEFAULTS.baseUrl).replace(/\/+$/, ""),
    apiKey: env.ROUTER9_API_KEY ?? file.ROUTER9_API_KEY ?? "",
    geminiChatModel: env.XENA_GEMINI_CHAT_MODEL ?? file.XENA_GEMINI_CHAT_MODEL ?? "gemini-2.5-flash",
    geminiVisionModel: env.XENA_GEMINI_VISION_MODEL ?? file.XENA_GEMINI_VISION_MODEL ?? "gemini-2.5-flash",
    geminiApiKey: env.XENA_GEMINI_API_KEY ?? file.XENA_GEMINI_API_KEY ?? null,
    textModel: env.XENA_TEXT_MODEL ?? file.XENA_TEXT_MODEL ?? R9_DEFAULTS.textModel,
    visionModel: env.XENA_VISION_MODEL ?? file.XENA_VISION_MODEL ?? R9_DEFAULTS.visionModel,
    fallbackTextModels:
      list(env.XENA_FALLBACK_TEXT_MODELS ?? file.XENA_FALLBACK_TEXT_MODELS) || [...R9_DEFAULTS.fallbackTextModels],
    fallbackVisionModels:
      list(env.XENA_FALLBACK_VISION_MODELS ?? file.XENA_FALLBACK_VISION_MODELS) || [...R9_DEFAULTS.fallbackVisionModels],
  };
}
