/**
 * CDP driver: sends /point command through the bar window's preload API.
 * Usage: node scripts/drive-point.mjs "youtube search box"
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const target = process.argv[2] ?? "taskbar";
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((t) => t.webSocketDebuggerUrl && t.title === "Xena Bar");
if (!page) throw new Error("Xena Bar target not found");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const call = (method, params) =>
  new Promise((res, rej) => {
    const mid = ++id;
    const onMsg = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id === mid) {
        ws.removeEventListener("message", onMsg);
        if (data.error) rej(new Error(data.error.message));
        else res(data.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await call("Runtime.enable");
const r = await call("Runtime.evaluate", {
  expression: `window.xena.pointAt(${JSON.stringify(target)})
    .then((reply) => JSON.stringify({ ok: true, reply }))
    .catch((e) => JSON.stringify({ ok: false, error: String(e) }))`,
  returnByValue: true,
  awaitPromise: true,
});
console.log(r.result?.value);
// Screenshot the pointer window target for visual verification.
const xena = targets.find((t) => t.title === "Xena");
if (xena) {
  const ws2 = new WebSocket(xena.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej; });
  let id2 = 0;
  const call2 = (method, params) =>
    new Promise((res, rej) => {
      const mid = ++id2;
      const onMsg = (ev) => {
        const d = JSON.parse(ev.data);
        if (d.id === mid) { ws2.removeEventListener("message", onMsg); res(d.result); }
      };
      ws2.addEventListener("message", onMsg);
      ws2.send(JSON.stringify({ id: mid, method, params }));
    });
  await call2("Runtime.enable");
  await call2("Page.enable");
  // capture the whole desktop via the avatar page is impossible; use bar shot instead
  ws2.close();
}
ws.close();
