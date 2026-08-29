/**
 * Repo root + .env file resolution shared by router9-client and inference-gateway.
 * Walks up from a starting directory looking for pnpm-workspace.yaml (repo marker).
 * Works in dev mode (pnpm sets cwd to the package, walk up finds repo root).
 * In packaged Electron, the main process provides an explicit root via startDir.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX_DEPTH = 8;

function walkUp(start: string, marker: string): string | null {
  let dir = start;
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Locates the repo root by walking up from `start` for pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string | null {
  return walkUp(start, "pnpm-workspace.yaml");
}

/**
 * Reads a .env file from the explicit start dir (or, in dev, the repo root
 * discovered by walking up). Returns an empty object if nothing is found.
 * Centralized so router9-client and inference-gateway can't drift.
 */
export function readDotEnv(start?: string): Record<string, string> {
  const candidates: string[] = [];
  if (start) candidates.push(join(start, ".env"));
  // In dev (pnpm sets cwd to a package), walk up to the repo root.
  const root = findRepoRoot(start);
  if (root) candidates.push(join(root, ".env"));
  const out: Record<string, string> = {};
  for (const file of candidates) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1] && m[2] !== undefined && !(m[1] in out)) out[m[1]!] = m[2]!;
    }
    return out; // first hit wins
  }
  return out;
}
