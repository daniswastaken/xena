/**
 * Dumps bar status DOM state.
 * Usage: node scripts/probe-bar-dom.mjs
 */
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
  expression: `JSON.stringify({
    statusText: document.getElementById('bar-status')?.textContent,
    statusClasses: document.getElementById('bar-status')?.className,
    dotClasses: document.getElementById('bar-dot')?.className,
  })`,
  returnByValue: true,
});
console.log(r.result?.value);
ws.close();
