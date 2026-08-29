/**
 * Electron app paths — works for both packaged and dev modes.
 *   - Packaged (.exe): .env lives next to Xena.exe (read-only, fine);
 *     data/ lives in userData (writable, per-user).
 *   - Dev (pnpm start): .env walks up to the repo root, data/ stays in
 *     apps/stage-xena/data for fast iteration.
 */
import { app } from "electron";
import { dirname, join } from "node:path";
import { findRepoRoot } from "@xena/router9-client";

/** Root dir for .env resolution: dirname of the launched binary in production, repo root in dev. */
export function appRoot(): string {
  if (app.isPackaged) return dirname(app.getPath("exe"));
  return findRepoRoot() ?? process.cwd();
}

/** Writable persistent data dir — where settings, transcripts, diary, facts live. */
export function dataDir(): string {
  if (app.isPackaged) return join(app.getPath("userData"), "data");
  return join(process.cwd(), "data");
}

/** Directory that .env / .env.example live in. */
export function envDir(): string {
  return appRoot();
}
