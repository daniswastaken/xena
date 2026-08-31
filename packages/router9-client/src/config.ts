/**
 * Provider connection config.
 * Reads .env from the repo root (walks up from cwd) — no dotenv dep needed.
 *
 * Provider priority (primary → secondary → tertiary):
 *   1. Gemini  — free AI Studio key; text + vision in one model
 *   2. 9Router — OpenAI-compatible gateway; used for reasoning (oc/big-pickle)
 *                and as a catch-all free-tier fallback
 *   3. 9Router free oc/* models — last resort within the same gateway
 *
 * Gemini is primary because it's a general-purpose chat model (not a cold coding
 * model like oc/big-pickle) AND it handles both text and vision in one pool,
 * so one free key covers two capabilities.
 */
import { readDotEnv } from "./paths.js";

export interface Router9Config {
  /** 9Router base URL (e.g. http://localhost:20129/v1). */
  baseUrl: string;
  /** 9Router API key. */
  apiKey: string;
  /** Primary text + chat model (Gemini). */
  geminiChatModel: string;
  /** Primary vision model (Gemini — same key, same pool). */
  geminiVisionModel: string;
  /** Google AI Studio free Gemini key — primary provider. */
  geminiApiKey: string | null;
  /** 9Router secondary text model (e.g. oc/big-pickle for reasoning). */
  textModel: string;
  /** 9Router secondary vision model. */
  visionModel: string;
  /** 9Router free-tier text models as last resort. */
  fallbackTextModels: string[];
  /** 9Router free-tier vision-capable models as last resort. */
  fallbackVisionModels: string[];
}

const DEFAULTS = {
  baseUrl: "http://localhost:20129/v1",
  geminiChatModel: "gemini-flash-latest",
  geminiVisionModel: "gemini-flash-latest",
  textModel: "oc/big-pickle",
  visionModel: "oc/x-preview-f-free",
  fallbackTextModels: ["oc/laguna-s-2.1-free", "oc/mimo-v2.5-free"],
  fallbackVisionModels: ["oc/mimo-v2.5-free"],
} as const;

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let cached: Router9Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Router9Config {
  if (cached) return cached;
  const file = readDotEnv();
  const apiKey = env.ROUTER9_API_KEY ?? file.ROUTER9_API_KEY;
  if (!apiKey) throw new Error("ROUTER9_API_KEY not set (.env or environment)");
  cached = {
    baseUrl: (env.ROUTER9_BASE_URL ?? file.ROUTER9_BASE_URL ?? DEFAULTS.baseUrl).replace(/\/+$/, ""),
    apiKey,
    geminiApiKey: env.XENA_GEMINI_API_KEY ?? file.XENA_GEMINI_API_KEY ?? null,
    geminiChatModel: env.XENA_GEMINI_CHAT_MODEL ?? file.XENA_GEMINI_CHAT_MODEL ?? DEFAULTS.geminiChatModel,
    geminiVisionModel: env.XENA_GEMINI_VISION_MODEL ?? file.XENA_GEMINI_VISION_MODEL ?? DEFAULTS.geminiVisionModel,
    textModel: env.XENA_TEXT_MODEL ?? file.XENA_TEXT_MODEL ?? DEFAULTS.textModel,
    visionModel: env.XENA_VISION_MODEL ?? file.XENA_VISION_MODEL ?? DEFAULTS.visionModel,
    fallbackTextModels:
      parseList(env.XENA_FALLBACK_TEXT_MODELS ?? file.XENA_FALLBACK_TEXT_MODELS) ||
      [...DEFAULTS.fallbackTextModels],
    fallbackVisionModels:
      parseList(env.XENA_FALLBACK_VISION_MODELS ?? file.XENA_FALLBACK_VISION_MODELS) ||
      [...DEFAULTS.fallbackVisionModels],
  };
  return cached;
}
