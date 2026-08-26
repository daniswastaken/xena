/**
 * Router9 connection config.
 * Reads .env from the repo root (walks up from cwd) — no dotenv dep needed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface FallbackProviderConfig {
  baseUrl: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
}

export interface Router9Config {
  baseUrl: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
  /** Optional failover provider (OpenRouter) — active only when its key is set. */
  fallback: FallbackProviderConfig | null;
}

const DEFAULTS = {
  baseUrl: "http://localhost:20129/v1",
  textModel: "oc/big-pickle",
  visionModel: "oc/x-preview-f-free",
  fallbackBaseUrl: "https://openrouter.ai/api/v1",
  fallbackTextModel: "stealth/ox-alpha",
  fallbackVisionModel: "minimax/minimax-m3:free",
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
    fallback: buildFallback(env, file),
  };
  return cached;
}

function buildFallback(env: NodeJS.ProcessEnv, file: Record<string, string>): FallbackProviderConfig | null {
  const key = env.OPENROUTER_API_KEY ?? file.OPENROUTER_API_KEY ?? "";
  if (key.trim() === "") return null;
  return {
    baseUrl: (
      env.OPENROUTER_BASE_URL ?? file.OPENROUTER_BASE_URL ?? DEFAULTS.fallbackBaseUrl
    ).replace(/\/+$/, ""),
    apiKey: key,
    textModel: env.XENA_FALLBACK_TEXT_MODEL ?? file.XENA_FALLBACK_TEXT_MODEL ?? DEFAULTS.fallbackTextModel,
    visionModel: env.XENA_FALLBACK_VISION_MODEL ?? file.XENA_FALLBACK_VISION_MODEL ?? DEFAULTS.fallbackVisionModel,
  };
}
