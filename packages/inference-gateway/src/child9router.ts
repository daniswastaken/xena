/**
 * 9Router child process lifecycle — spawn at boot, probe, respawn, kill.
 *
 * Makes "start Xena -> inference up" true without manual `9router`: Xena
 * spawns the gateway as a child with the same flags the user's profile
 * function injects (--port 20129 --no-browser --skip-update), watches
 * /v1/models, and respawns with exponential backoff on crash or probe
 * failure. Disabled entirely via XENA_NINEROUTER_ENABLED=0.
 *
 * If 9Router is ALREADY serving on the port at boot (user's manual
 * instance, or a leftover), it is adopted instead of double-spawning.
 *
 * Spawn resolution:
 *   1. Bundled copy under `resources/9router/` when packaged.
 *   2. PATH-resolved `9router` (dev / npm-global) otherwise.
 *
 * Electron-free: pure Node, unit-testable outside the app.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import type { InferenceConfig } from "./config.js";

/** 9router's app-data dir (its getAppDataDir convention). */
function router9Dir(): string | null {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return join(appData, "9router");
  }
  const home = process.env.HOME;
  if (!home) return null;
  return join(home, ".9router");
}

/**
 * Replicates 9router's machine-id resolution (chunk 54603):
 * file → Windows MachineGuid (via reg query) → random UUID, cached to the
 * machine-id file so the child sees the same value we signed the key with.
 */
function resolveMachineId(dir: string): string | null {
  const machineIdPath = join(dir, "machine-id");
  try {
    const existing = readFileSync(machineIdPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* not there yet */
  }
  let id = "";
  if (process.platform === "win32") {
    try {
      const { execSync } = require("node:child_process") as typeof import("node:child_process");
      const out = execSync(
        "reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid",
        { encoding: "utf8", timeout: 4000, windowsHide: true },
      );
      const m = /REG_SZ\s+(\S+)/.exec(out);
      if (m?.[1]) id = m[1].trim();
    } catch {
      /* fall through */
    }
  }
  if (!id) id = randomUUID().replace(/-/g, "");
  try {
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(machineIdPath, id, "utf8");
  } catch {
    /* best-effort cache */
  }
  return id;
}

/**
 * Replicates 9router's generateApiKeyWithMachine (machine-id + HMAC):
 *   sk-<machineId first 6>-<6 rand alnum>-<hmac-sha256(secret, id+rand)[:8]>
 * with the default secret ("endpoint-proxy-api-key-secret") 9router ships.
 */
function generateRouter9Key(machineId: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let rand = "";
  for (let i = 0; i < 6; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  const secret = process.env.API_KEY_SECRET ?? "endpoint-proxy-api-key-secret";
  const hmac = createHmac("sha256", secret).update(machineId + rand).digest("hex").slice(0, 8);
  return `sk-${machineId.slice(0, 6)}-${rand}-${hmac}`;
}

/**
 * Fresh-machine key bootstrap. The bundled 9Router child creates its DB on
 * first run — with ZERO api keys (keys are normally hand-created in its
 * dashboard), so every Xena request 401s. Fix: adopt an existing active key
 * when present; otherwise mint one with 9router's own algorithm and insert
 * it into the child's DB. node:sqlite — no native deps.
 *
 * Only runs while the current key is unverified (a working key is never
 * touched; a 401 from the chain re-opens this path).
 */
function ensureRouter9Key(): string | null {
  const dir = router9Dir();
  if (!dir) return null;
  const dbPath = join(dir, "db", "data.sqlite");
  if (!existsSync(dbPath)) return null;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare("SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt ASC")
      .all() as Array<{ key: string }>;
    if (rows.length > 0 && rows[0]) return rows[0].key;
    // Fresh DB: mint + insert a key 9router's own validator will accept.
    const machineId = resolveMachineId(dir);
    if (!machineId) return null;
    const key = generateRouter9Key(machineId);
    db.prepare(
      "INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)",
    ).run(randomUUID(), key, "xena", machineId, new Date().toISOString());
    return key;
  } finally {
    db.close();
  }
}

export interface ChildEvents {
  /** State transitions for the tray: "starting" | "up" | "down" | "disabled" | "adopted". */
  onState: (state: NineRouterChildState) => void;
}

export type NineRouterChildState = "disabled" | "starting" | "up" | "down" | "adopted";

/**
 * Module-level key-worked signal: the chain (chain.ts) calls this when a
 * router9 request authenticates successfully; the live child instance
 * registers itself here. Keeps the chain decoupled from instance wiring.
 */
let keyWorkedListener: (() => void) | null = null;
let keyRejectedListener: (() => void) | null = null;
export function notifyRouter9KeyWorking(): void {
  try {
    keyWorkedListener?.();
  } catch {
    /* never let diagnostics break the chain */
  }
}
export function notifyRouter9KeyRejected(): void {
  try {
    keyRejectedListener?.();
  } catch {
    /* never let diagnostics break the chain */
  }
}
export function setKeyWorkedListener(fn: (() => void) | null): void {
  keyWorkedListener = fn;
}
export function setKeyRejectedListener(fn: (() => void) | null): void {
  keyRejectedListener = fn;
}

const PROBE_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;
const RESPAWN_BACKOFF_START_MS = 5_000;
const RESPAWN_BACKOFF_CAP_MS = 30_000;
// No respawn attempt cap: a slow first boot (cold disk) must not exhaust the
// ladder and leave the rung dead for the whole session. A rung that keeps
// dying retries forever, slowly; the provider breaker keeps request volume
// off it while it's down.

/** Resolve a spawn spec for 9Router. Returns [cmd, args, useShell]. */
function resolveSpawnSpec(): { cmd: string; args: string[]; shell: boolean; env?: Record<string, string> } | null {
  // Packaged: resources/9router/cli.js. Run it with the Electron-bundled
  // Node via ELECTRON_RUN_AS_NODE so no system Node is required.
  const resourcesRoot = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resourcesRoot) {
    const bundled = join(resourcesRoot, "9router", "cli.js");
    if (existsSync(bundled)) {
      return { cmd: process.execPath, args: [bundled], shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
    }
  }
  // Dev: 9router resolved via PATH (npm global). shell:true for Windows
  // PATHEXT resolution of the .cmd shim npm creates.
  return { cmd: "9router", args: [], shell: true };
}

export class NineRouterChild {
  private child: ChildProcess | null = null;
  private state: NineRouterChildState = "starting";
  private probeTimer: NodeJS.Timeout | null = null;
  private respawnTimer: NodeJS.Timeout | null = null;
  private backoffMs = RESPAWN_BACKOFF_START_MS;
  private probeFailures = 0;
  private disposed = false;
  /** Adopted = we never spawned this instance; never kill what we don't own. */
  private adopted = false;
  /** Key synced from the child's DB at least once. */
  private keySyncDone = false;
  /** A router9 request authenticated successfully with the current key. */
  private keyVerified = false;
  private readonly events: ChildEvents;

  constructor(
    private readonly config: InferenceConfig,
    events: ChildEvents,
  ) {
    this.events = events;
  }

  /** Start managing the child. No-op when disabled in config. */
  start(): void {
    if (this.disposed) return;
    if (!this.config.nineRouterEnabled) {
      this.setState("disabled");
      return;
    }
    this.bindKeyWorkedSignal();
    void this.boot();
    // 15s probe cadence: fresh-machine cold boot takes ~60s on weak CPUs —
    // a 60s interval meant the tray reported "starting" for 2 whole minutes
    // and key-DB sync lagged the first chat. Probe = one 5s-timeout GET.
    this.probeTimer = setInterval(() => void this.probe(), 15_000);
  }

  /** Adopt an already-serving instance; otherwise spawn our own. */
  private async boot(): Promise<void> {
    if (await this.probeOnce()) {
      this.adopted = true;
      this.setState("adopted");
      return;
    }
    this.spawnChild();
  }

  /** Stop managing + kill the child (app quit, config change). */
  dispose(): void {
    this.disposed = true;
    setKeyWorkedListener(null);
    setKeyRejectedListener(null);
    if (this.probeTimer) clearInterval(this.probeTimer);
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.killChild();
    this.setState("down");
  }

  get currentState(): NineRouterChildState {
    return this.state;
  }

  private setState(state: NineRouterChildState): void {
    this.state = state;
    try {
      this.events.onState(state);
    } catch {
      // tray hooks must never break the child loop
    }
  }

  private spawnChild(): void {
    if (this.disposed || this.child) return;
    this.setState("starting");
    const spec = resolveSpawnSpec();
    if (!spec) {
      this.scheduleRespawn();
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(spec.cmd, [...spec.args, ...this.spawnArgs()], {
        shell: spec.shell,
        stdio: "ignore",
        env: spec.env,
      });
    } catch {
      this.scheduleRespawn();
      return;
    }
    this.child = child;
    // Same-instance guards: killChild() nulls this.child BEFORE killing, so
    // a late exit/error from an already-replaced child is a no-op.
    child.once("error", () => {
      if (this.child !== child) return;
      this.child = null;
      this.scheduleRespawn();
    });
    child.once("exit", () => {
      if (this.child !== child) return; // intentional kill — killer owns respawn
      this.child = null;
      // External crash or manual kill: Xena owns the rung, bring it back.
      this.scheduleRespawn();
    });
    // Successful spawn resets the whole backoff ladder.
    this.backoffMs = RESPAWN_BACKOFF_START_MS;
    // Unref'd so the child never keeps a quitting Xena alive.
    child.unref();
  }

  private spawnArgs(): string[] {
    // Match the user's profile: port 20129, no dashboard browser, no update.
    const url = new URL(this.config.baseUrl);
    const port = url.port || "20129";
    return ["--port", port, "--no-browser", "--skip-update"];
  }

  private killChild(): void {
    const child = this.child;
    if (!child) return;
    // Null first: exit/error handlers check ownership, so the late events
    // from this child never trigger a duplicate respawn.
    this.child = null;
    this.adopted = false;
    if (child.pid !== undefined && process.platform === "win32") {
      // shell:true wrapped the real process in cmd.exe — kill the whole
      // tree or the node gateway survives as an orphan.
      try {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).once("exit", () => undefined);
      } catch {
        // fall through to signal kill
      }
    }
    try {
      child.kill();
    } catch {
      // already dead
    }
  }
  private scheduleRespawn(): void {
    if (this.disposed) return;
    this.setState("down");
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, RESPAWN_BACKOFF_CAP_MS);
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = setTimeout(() => {
      if (!this.disposed) this.spawnChild();
    }, delay);
  }

  /**
   * Fresh-machine key bootstrap: the bundled 9Router child creates its own DB
   * (first run generates a NEW api key), so a fresh install has no .env
   * ROUTER9_API_KEY that matches. Read the active key straight out of the
   * child's sqlite DB and adopt it whenever Xena has no working key.
   *
   * Windows: %APPDATA%/9router/db/data.sqlite (9router's getAppDataDir).
   * Runs on every successful probe — cheap (one open+query) and it heals
   * the 401 loop after a manual dashboard key rotation too.
   */
  private syncKeyFromChildDb(): void {
    if (this.keyVerified) return; // working key — never touch
    try {
      const key = ensureRouter9Key();
      if (!key || this.config.apiKey === key) return;
      this.config.apiKey = key;
      this.keySyncDone = true;
    } catch {
      // DB not ready yet (child still creating it) — next probe retries.
    }
  }

  /** Called by the chain when a router9 request succeeds — locks key sync. */
  noteKeyWorking(): void {
    this.keyVerified = true;
  }

  /** Register the module-level key-worked signal target. */
  bindKeyWorkedSignal(): void {
    setKeyWorkedListener(() => this.noteKeyWorking());
    setKeyRejectedListener(() => {
      // Current key rejected — allow DB re-adoption on the next probe.
      this.keyVerified = false;
    });
  }

  /** One health probe. True when the gateway answers. */
  private async probeOnce(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/models`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Periodic probe: up/down transitions + respawn on persistent sickness. */
  private async probe(): Promise<void> {
    if (this.disposed || !this.config.nineRouterEnabled || this.state === "disabled") return;
    if (await this.probeOnce()) {
      this.probeFailures = 0;
      this.syncKeyFromChildDb();
      if (this.state === "down" || this.state === "starting") {
        // Someone (manual start, earlier spawn) is serving — adopt if we
        // aren't already tracking a child of our own.
        if (!this.child) this.adopted = true;
        this.setState(this.adopted ? "adopted" : "up");
      }
      return;
    }
    this.probeFailures++;
    // 3 consecutive probe failures -> respawn. When OUR child is sick we
    // kill + restart it. When an ADOPTED instance died, the port is free
    // again — take it over with our own child instead of leaving the rung
    // dead until a manual tray restart (the "no auto recovery" failure).
    if (this.probeFailures >= 3) {
      this.probeFailures = 0;
      if (this.child) {
        this.killChild();
      } else {
        this.adopted = false;
      }
      this.scheduleRespawn();
    }
  }
}
