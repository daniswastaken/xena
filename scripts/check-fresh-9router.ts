// Validates the gateway's fresh-machine key bootstrap against a live,
// isolated 9router instance (scratch APPDATA, alt port).
// Usage: node scripts/run-check.mjs scripts/check-fresh-9router.ts [appdataDir] [port]
import { DatabaseSync } from "node:sqlite";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const dir = resolve(process.argv[2] ?? "C:\\Users\\daniswastaken\\AppData\\Local\\Temp\\opencode\\r9-scratch\\9router");
const port = process.argv[3] ?? "20199";

let failures = 0;
function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// --- mirror of gateway ensureRouter9Key (mint path) -------------------------
function resolveMachineId(dir: string): string {
  try {
    const existing = readFileSync(join(dir, "machine-id"), "utf8").trim();
    if (existing) return existing;
  } catch {}
  let id = "";
  try {
    const out = execSync("reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid", {
      encoding: "utf8",
      timeout: 4000,
    });
    const m = /REG_SZ\s+(\S+)/.exec(out);
    if (m) id = m[1].trim();
  } catch {}
  if (!id) id = randomUUID().replace(/-/g, "");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "machine-id"), id, "utf8");
  } catch {}
  return id;
}

function generateRouter9Key(machineId: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let rand = "";
  for (let i = 0; i < 6; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  const secret = process.env.API_KEY_SECRET ?? "endpoint-proxy-api-key-secret";
  const hmac = createHmac("sha256", secret).update(machineId + rand).digest("hex").slice(0, 8);
  return `sk-${machineId.slice(0, 6)}-${rand}-${hmac}`;
}

const db = new DatabaseSync(join(dir, "db", "data.sqlite"));
const existing = db.prepare("SELECT key FROM apiKeys WHERE isActive = 1").all() as Array<{ key: string }>;
let key: string;
if (existing.length > 0) {
  key = existing[0].key;
  console.log("INFO  existing active key adopted (not minted)");
} else {
  key = generateRouter9Key(resolveMachineId(dir));
  db.prepare(
    "INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)",
  ).run(randomUUID(), key, "xena", resolveMachineId(dir), new Date().toISOString());
  console.log("INFO  minted key:", key.slice(0, 12) + "...");
}
db.close();

// --- live auth against the scratch gateway ---------------------------------
const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(8000),
});
assert(res.ok, `minted/adopted key authenticates against fresh 9router (HTTP ${res.status})`);
if (res.ok) {
  const body = (await res.json()) as { data?: unknown[] };
  console.log(`INFO  models visible: ${body.data?.length ?? 0}`);
}

process.exitCode = failures > 0 ? 1 : 0;
