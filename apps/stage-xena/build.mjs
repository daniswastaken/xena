/**
 * esbuild bundler for stage-xena: main (cjs), preload (cjs), renderer (iife).
 * Copies index.html + assets into dist. No dev server — reload Electron to see changes.
 */
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "renderer"), { recursive: true });

const common = {
  bundle: true,
  sourcemap: "inline",
  logLevel: "warning",
  target: "es2023",
  minify: false,
};

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/main/index.ts")],
  outfile: join(dist, "main/index.js"),
  platform: "node",
  format: "cjs",
  external: ["electron"],
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/preload/index.ts")],
  outfile: join(dist, "preload/index.js"),
  platform: "node",
  format: "cjs",
  external: ["electron"],
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/renderer/index.ts")],
  outfile: join(dist, "renderer/renderer.js"),
  platform: "browser",
  format: "iife",
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/renderer/bar.ts")],
  outfile: join(dist, "renderer/bar.js"),
  platform: "browser",
  format: "iife",
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/renderer/pointer.ts")],
  outfile: join(dist, "renderer/pointer.js"),
  platform: "browser",
  format: "iife",
});

cpSync(join(root, "src/renderer/index.html"), join(dist, "renderer/index.html"));
cpSync(join(root, "src/renderer/bar.html"), join(dist, "renderer/bar.html"));
cpSync(join(root, "src/renderer/pointer.html"), join(dist, "renderer/pointer.html"));
cpSync(join(root, "src/renderer/styles"), join(dist, "renderer/styles"), { recursive: true });
cpSync(join(root, "assets"), join(dist, "renderer/assets"), { recursive: true });

// Bundle 9Router into dist/resources/9router/ for dev runs (mirrors what
// electron-builder copies into the packaged .exe's resources folder at
// install time). Lets NineRouterChild spawn the bundled copy via
// process.resourcesPath without requiring npm-global 9router on PATH.
const srcRouter = join(root, "node_modules/9router");
if (existsSync(srcRouter)) {
  cpSync(srcRouter, join(dist, "resources/9router"), { recursive: true });
}

console.log("build ok ->", dist);

