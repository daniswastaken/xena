import { readFileSync } from "node:fs";
const s = readFileSync("apps/stage-xena/node_modules/pixi-live2d-display/dist/cubism4.es.js", "utf8");
const imports = [...s.matchAll(/from\s*"([^"]+)"/g)].map((m) => m[1]);
console.log([...new Set(imports)].join("\n"));
console.log("---len", s.length);
const pkg = JSON.parse(readFileSync("apps/stage-xena/node_modules/pixi-live2d-display/package.json", "utf8"));
console.log("deps:", JSON.stringify(pkg.dependencies), "peer:", JSON.stringify(pkg.peerDependencies));
