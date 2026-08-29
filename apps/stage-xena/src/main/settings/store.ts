/**
 * App settings persisted to data/settings.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface XenaSettings {
  voiceEnabled: boolean;
  proactiveEnabled: boolean;
  shakeEnabled: boolean;
  /** avatar (Live2D stage) visible in the corner overlay */
  avatarEnabled: boolean;
  /** launch Xena when Windows starts */
  autostartEnabled: boolean;
  /** periodic one-line screen observations, visible as proactive comments */
  ambientEnabled: boolean;
  /** oc/* model id; empty = default from .env */
  textModel: string;
  /** user-provided Gemini API key (optional — chain runs keyless without) */
  geminiApiKey: string;
}

const DEFAULTS: XenaSettings = {
  voiceEnabled: true,
  proactiveEnabled: true,
  shakeEnabled: true,
  avatarEnabled: true,
  autostartEnabled: false,
  ambientEnabled: false,
  textModel: "",
  geminiApiKey: "",
};

export class SettingsStore {
  private cache: XenaSettings | null = null;

  constructor(private readonly filePath: string) {}

  async get(): Promise<XenaSettings> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<XenaSettings>) };
    } catch {
      this.cache = { ...DEFAULTS };
    }
    return this.cache;
  }

  async set(patch: Partial<XenaSettings>): Promise<XenaSettings> {
    const current = await this.get();
    this.cache = { ...current, ...patch };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf8");
    return this.cache;
  }
}

export function defaultSettingsPath(dataDir: string): string {
  return join(dataDir, "settings.json");
}
