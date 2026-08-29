/**
 * Bundles and runs a scripts/*.ts check with @xena/* workspace aliases.
 * Usage: node scripts/run-check.mjs <entry.ts> [args...]
 */
import { build } from "esbuild";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [entry, ...rest] = process.argv.slice(2);
if (!entry) {
  console.error("usage: node scripts/run-check.mjs <scripts/file.ts> [args...]");
  process.exit(1);
}

const alias = {
  "@xena/router9-client": join(root, "packages/router9-client/src/index.ts"),
  "@xena/inference-gateway": join(root, "packages/inference-gateway/src/index.ts"),
  "@xena/xena-core": join(root, "packages/xena-core/src/index.ts"),
  "@xena/tts": join(root, "packages/tts/src/index.ts"),
};

const tmp = await mkdtemp(join(tmpdir(), "xena-check-"));
try {
  const outfile = join(tmp, "check.mjs");
  await build({
    entryPoints: [isAbsolute(entry) ? entry : join(root, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    alias,
    sourcemap: false,
    logLevel: "silent",
    banner: {
      // CJS deps (msedge-tts/axios) dynamically require node builtins.
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  const res = spawnSync(process.execPath, [outfile, ...rest], { stdio: "inherit" });
  process.exitCode = res.status ?? 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
