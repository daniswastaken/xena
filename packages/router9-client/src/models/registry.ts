/**
 * Model registry — cached listing + capability notes from probing.
 * Probe evidence lives in docs/vision-models.md; this module only reflects it.
 */
import { loadConfig, type Router9Config } from "../config.js";
import type { ModelInfo } from "../types.js";

let cache: { at: number; models: ModelInfo[] } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

export async function listModels(
  config: Router9Config = loadConfig(),
  forceRefresh = false,
): Promise<ModelInfo[]> {
  if (!forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;
  const res = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) throw new Error(`listModels failed: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
  const models = (json.data ?? []).map((m) => ({ id: m.id, owned_by: m.owned_by }));
  cache = { at: Date.now(), models };
  return models;
}

export function isVisionCapable(modelId: string): boolean {
  // Verified empirically (docs/vision-models.md): oc/x-preview-f-free accepts
  // image_url parts. Extend this list as more probes pass.
  return modelId === "oc/x-preview-f-free";
}
