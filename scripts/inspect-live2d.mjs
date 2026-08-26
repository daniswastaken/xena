/**
 * Dumps Live2D mount diagnostics from the avatar window.
 * Usage: node scripts/inspect-live2d.mjs
 */
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
const r = await call("Runtime.evaluate", {
  expression: `JSON.stringify({
    core: typeof window.Live2DCubismCore,
    rootDisplay: document.getElementById('live2d-root')?.style.display,
    rootChildren: document.getElementById('live2d-root')?.childElementCount,
    avatarDisplay: document.getElementById('avatar')?.style.display,
    hasCanvas: !!document.querySelector('#live2d-root canvas'),
  })`,
  returnByValue: true,
});
console.log(r.result?.value);
ws.close();
