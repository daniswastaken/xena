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
import { readDotEnv } from "@xena/router9-client";
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
  geminiLiteModel: "gemini-flash-lite-latest",
  pollinationsTextModel: "openai-fast",
  pollinationsVisionModel: "",
} as const;

function parseBool(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

let cached: InferenceConfig | null = null;

/** Set by the app layer once at boot: dir containing .env for the packaged app. */
let runtimeEnvDir: string | undefined;

/** Point .env resolution at the installed app dir (next to Xena.exe). */
export function setEnvDir(dir: string | undefined): void {
  runtimeEnvDir = dir;
}

/**
 * Wraps router9-client's loadConfig (which owns the shared .env fields) and
 * layers the gateway fields on top. Cache can be dropped via resetInference.
 *
 * Priority for each field: process env > .env file > default. Packaged apps
 * have no repo .env — the app layer must call applyRuntimeOverrides() with
 * persisted settings (Gemini key from setup) after boot.
 */
export function loadInferenceConfig(env: NodeJS.ProcessEnv = process.env): InferenceConfig {
  if (cached) return cached;
  const file = readDotEnv(runtimeEnvDir);
  const base = loadBaseConfig(env, file);
  cached = {
    ...base,
    geminiLiteModel: env.XENA_GEMINI_LITE_MODEL ?? file.XENA_GEMINI_LITE_MODEL ?? "gemini-flash-lite-latest",
    pollinationsTextModel:
      env.XENA_POLLINATIONS_TEXT_MODEL ?? file.XENA_POLLINATIONS_TEXT_MODEL ?? DEFAULTS.pollinationsTextModel,
    pollinationsVisionModel:
      env.XENA_POLLINATIONS_VISION_MODEL ?? file.XENA_POLLINATIONS_VISION_MODEL ?? DEFAULTS.pollinationsVisionModel,
    nineRouterEnabled:
      parseBool(env.XENA_NINEROUTER_ENABLED ?? file.XENA_NINEROUTER_ENABLED) ?? true,
  };
  return cached;
}

/**
 * Overlay runtime values (persisted settings) onto a loaded config WITHOUT
 * reloading. Runs once at boot, before any request. Values already present
 * in the process env still win (dev machines).
 */
export function applyRuntimeOverrides(
  config: InferenceConfig,
  overrides: { geminiApiKey?: string | null },
): void {
  if (overrides.geminiApiKey && !process.env.XENA_GEMINI_API_KEY) {
    config.geminiApiKey = overrides.geminiApiKey;
  }
}

/** Drop the cached config — next loadInferenceConfig re-reads .env. */
export function invalidateConfigCache(): void {
  cached = null;
}

/**
 * Re-read .env INTO the same config object long-lived holders captured.
 * Xena's restart-inference action calls this so scheduler/glances/sessions
 * see fresh provider settings without being reconstructed. Values overlaid
 * at runtime (persisted settings, setup-entered key) survive the refresh.
 */
export function refreshInPlace(config: InferenceConfig): InferenceConfig {
  const overlaid = { geminiApiKey: config.geminiApiKey };
  const fresh = loadInferenceConfig();
  Object.assign(config, fresh);
  applyRuntimeOverrides(config, overlaid);
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
    geminiChatModel: env.XENA_GEMINI_CHAT_MODEL ?? file.XENA_GEMINI_CHAT_MODEL ?? "gemini-flash-latest",
    geminiVisionModel: env.XENA_GEMINI_VISION_MODEL ?? file.XENA_GEMINI_VISION_MODEL ?? "gemini-flash-latest",
    geminiApiKey: env.XENA_GEMINI_API_KEY ?? file.XENA_GEMINI_API_KEY ?? null,
    textModel: env.XENA_TEXT_MODEL ?? file.XENA_TEXT_MODEL ?? R9_DEFAULTS.textModel,
    visionModel: env.XENA_VISION_MODEL ?? file.XENA_VISION_MODEL ?? R9_DEFAULTS.visionModel,
    fallbackTextModels:
      list(env.XENA_FALLBACK_TEXT_MODELS ?? file.XENA_FALLBACK_TEXT_MODELS) || [...R9_DEFAULTS.fallbackTextModels],
    fallbackVisionModels:
      list(env.XENA_FALLBACK_VISION_MODELS ?? file.XENA_FALLBACK_VISION_MODELS) || [...R9_DEFAULTS.fallbackVisionModels],
  };
}
