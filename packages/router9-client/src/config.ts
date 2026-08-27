/**
 * Router9 connection config.
 * Reads .env from the repo root (walks up from cwd) — no dotenv dep needed.
 *
 * Free-only failover: instead of routing to a paid OpenRouter key on 9Router
 * failures, the chain falls through to other 9Router free-tier models within
 * the SAME gateway. All requests stay free and on `oc/*` providers.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Router9Config {
  baseUrl: string;
  apiKey: string;
  /** Primary text model. */
  textModel: string;
  /** Primary vision model. */
  visionModel: string;
  /** Free 9Router text models tried in order when the primary fails. */
  fallbackTextModels: string[];
  /** Free 9Router vision-capable models (incl. text models that accept images). */
  fallbackVisionModels: string[];
}

const DEFAULTS = {
  baseUrl: "http://localhost:20129/v1",
  textModel: "oc/big-pickle",
  visionModel: "oc/x-preview-f-free",
  fallbackTextModels: ["oc/laguna-s-2.1-free", "oc/mimo-v2.5-free"],
  fallbackVisionModels: ["oc/mimo-v2.5-free"],
} as const;

function readDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    try {
      const raw = readFileSync(join(dir, ".env"), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && m[1] && m[2] !== undefined && !(m[1] in out)) out[m[1]] = m[2];
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
