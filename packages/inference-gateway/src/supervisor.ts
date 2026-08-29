/**
 * Provider/model supervisor — the self-recovery state machine.
 *
 * Layers of recovery:
 *   request level : chain walk advances to the next rung on any retryable
 *                   failure (implemented in chain.ts)
 *   model level   : 404 / empty / repeated 5xx marks a MODEL dead for a
 *                   cooldown window; chains are rebuilt excluding it
 *   provider level: consecutive failures mark the whole PROVIDER offline;
 *                   one success brings it back online
 *   process level : 9Router child respawn — child9router.ts
 *
 * resetInference() clears everything and re-reads config; wired to the tray
 * "Restart inference" action and auto-invoked on total chain failure.
 */
import type { InferenceConfig } from "./config.js";
import { loadInferenceConfig, invalidateConfigCache } from "./config.js";

export type ProviderId = "gemini" | "gemini-lite" | "router9" | "pollinations";

export interface ProviderHealth {
  online: boolean;
  /** Consecutive failures; resets on success. */
  consecutiveFailures: number;
  /** Epoch ms until which this provider is skipped. */
  cooldownUntil: number;
  lastError: string | null;
}

export interface ModelHealth {
  /** Epoch ms until which this model is skipped (404/empty eviction). */
  deadUntil: number;
  reason: string | null;
}

const PROVIDER_OFFLINE_THRESHOLD = 3;
const PROVIDER_COOLDOWN_MS = 5 * 60_000;
const MODEL_DEAD_MS = 10 * 60_000;

class SupervisorImpl {
  private readonly providers = new Map<ProviderId, ProviderHealth>();
  private readonly models = new Map<string, ModelHealth>();
  private onResetHooks: Array<() => void> = [];

  providerHealth(id: ProviderId): ProviderHealth {
    let h = this.providers.get(id);
    if (!h) {
      h = { online: true, consecutiveFailures: 0, cooldownUntil: 0, lastError: null };
      this.providers.set(id, h);
    }
    return h;
  }

  /** True when the provider should be skipped in the current chain walk. */
  providerSkipped(id: ProviderId): boolean {
    return !this.providerHealth(id).online || Date.now() < this.providerHealth(id).cooldownUntil;
  }

  noteProviderSuccess(id: ProviderId): void {
    const h = this.providerHealth(id);
    h.online = true;
    h.consecutiveFailures = 0;
    h.cooldownUntil = 0;
    h.lastError = null;
  }

  noteProviderFailure(id: ProviderId, reason: string): void {
    const h = this.providerHealth(id);
    h.consecutiveFailures++;
    h.lastError = reason;
    if (h.consecutiveFailures >= PROVIDER_OFFLINE_THRESHOLD) {
      h.online = false;
      h.cooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
    }
  }

  /** True when the model should be skipped (404/empty eviction window). */
  modelDead(provider: ProviderId, model: string): boolean {
    const key = `${provider}:${model}`;
    const m = this.models.get(key);
    return !!m && Date.now() < m.deadUntil;
  }

  /** Evict a model for MODEL_DEAD_MS (404, persistent empty responses). */
  evictModel(provider: ProviderId, model: string, reason: string): void {
    this.models.set(`${provider}:${model}`, { deadUntil: Date.now() + MODEL_DEAD_MS, reason });
    this.noteProviderFailure(provider, `${model}: ${reason}`);
  }

  modelHealthList(): Array<{ provider: ProviderId; model: string } & ModelHealth> {
    const out: Array<{ provider: ProviderId; model: string } & ModelHealth> = [];
    for (const [key, m] of this.models) {
      const [provider, model] = splitKey(key);
      if (provider && model) out.push({ provider, model, ...m });
    }
    return out;
  }

  /** Diagnostics for the tray — technical detail allowed here. */
  describe(): string {
    const parts: string[] = [];
    for (const id of ["gemini", "gemini-lite", "router9", "pollinations"] as const) {
      const h = this.providers.get(id);
      if (!h) continue;
      const state = h.online
        ? Date.now() < h.cooldownUntil
          ? `cooldown ${Math.ceil((h.cooldownUntil - Date.now()) / 1000)}s`
          : "up"
        : `down${h.lastError ? ` (${h.lastError.slice(0, 40)})` : ""}`;
      parts.push(`${id}: ${state}`);
    }
    for (const m of this.modelHealthList()) {
      if (Date.now() < m.deadUntil) {
        parts.push(`model ${m.provider}/${m.model} dead ${Math.ceil((m.deadUntil - Date.now()) / 1000)}s`);
      }
    }
    return parts.join(" | ") || "all providers healthy";
  }

  onReset(hook: () => void): void {
    this.onResetHooks.push(hook);
  }

  reset(): void {
    this.providers.clear();
    this.models.clear();
    invalidateConfigCache();
    for (const hook of this.onResetHooks) {
      try {
        hook();
      } catch {
        // hooks must never break recovery
      }
    }
  }
}

function splitKey(key: string): [ProviderId | null, string | null] {
  const i = key.indexOf(":");
  if (i === -1) return [null, null];
  const provider = key.slice(0, i) as ProviderId;
  const model = key.slice(i + 1);
  return [provider, model];
}

/** Process-wide singleton; the tray and the chain share this state. */
export const supervisor = new SupervisorImpl();

/** Full self-recovery entry point — never restarts Xena itself. */
export function resetInference(): InferenceConfig {
  supervisor.reset();
  return loadInferenceConfig();
}
