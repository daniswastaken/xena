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
 * Electron-free: pure Node, unit-testable outside the app.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { InferenceConfig } from "./config.js";

export interface ChildEvents {
  /** State transitions for the tray: "starting" | "up" | "down" | "disabled" | "adopted". */
  onState: (state: NineRouterChildState) => void;
}

export type NineRouterChildState = "disabled" | "starting" | "up" | "down" | "adopted";

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;
const RESPAWN_BACKOFF_START_MS = 5_000;
const RESPAWN_BACKOFF_CAP_MS = 30_000;
const RESPAWN_MAX_ATTEMPTS = 5;

export class NineRouterChild {
  private child: ChildProcess | null = null;
  private state: NineRouterChildState = "starting";
  private probeTimer: NodeJS.Timeout | null = null;
  private respawnTimer: NodeJS.Timeout | null = null;
  private backoffMs = RESPAWN_BACKOFF_START_MS;
  private respawnAttempts = 0;
  private probeFailures = 0;
  private disposed = false;
  /** Adopted = we never spawned this instance; never kill what we don't own. */
  private adopted = false;
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
    void this.boot();
    this.probeTimer = setInterval(() => void this.probe(), PROBE_INTERVAL_MS);
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
    let child: ChildProcess;
    try {
      // `9router` resolves via PATH (npm global). shell:true for Windows
      // PATHEXT resolution of the .cmd shim npm creates.
      child = spawn("9router", this.spawnArgs(), { shell: true, stdio: "ignore" });
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
    this.respawnAttempts = 0;
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
    if (this.respawnAttempts >= RESPAWN_MAX_ATTEMPTS) return;
    this.respawnAttempts++;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, RESPAWN_BACKOFF_CAP_MS);
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = setTimeout(() => {
      if (!this.disposed) this.spawnChild();
    }, delay);
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
      if (this.state === "down" || this.state === "starting") {
        // Someone (manual start, earlier spawn) is serving — adopt if we
        // aren't already tracking a child of our own.
        if (!this.child) this.adopted = true;
        this.setState(this.adopted ? "adopted" : "up");
      }
      return;
    }
    this.probeFailures++;
    // 3 consecutive probe failures on OUR child -> respawn it.
    // An adopted instance the user killed stays down until it reappears —
    // we never spawn over a port we don't own.
    if (this.probeFailures >= 3 && this.child) {
      this.probeFailures = 0;
      this.killChild();
      this.scheduleRespawn();
    } else if (this.probeFailures >= 3) {
      this.probeFailures = 0;
      this.setState("down");
    }
  }
}
