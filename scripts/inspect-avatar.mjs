/**
 * CDP inspector for the avatar window: reports current sprite src,
 * recent console state, and saves a screenshot to %TEMP%\xena-emote.png.
 * Usage: node scripts/inspect-avatar.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((t) => t.webSocketDebuggerUrl && t.title === "Xena");
if (!page) throw new Error("Xena page target not found");
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
const src = await call("Runtime.evaluate", {
  expression: "document.getElementById('avatar').src",
  returnByValue: true,
});
console.log("sprite:", src.result?.value ?? JSON.stringify(src.result));
const style = await call("Runtime.evaluate", {
  expression:
    "JSON.stringify({ t: getComputedStyle(document.getElementById('avatar')).transform, o: getComputedStyle(document.getElementById('avatar')).transformOrigin })",
  returnByValue: true,
});
console.log("style:", style.result?.value);

const shot = await call("Page.captureScreenshot", { format: "png" });
const out = join(tmpdir(), "xena-emote.png");
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("screenshot:", out);
ws.close();
