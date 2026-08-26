/**
 * Dumps chat window DOM state.
 * Usage: node scripts/probe-chat-dom.mjs
 */
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((t) => t.webSocketDebuggerUrl && t.title === "Xena Chat");
if (!page) throw new Error("Xena Chat target not found");
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
    rootClasses: document.getElementById('chat-root')?.className,
    answerText: JSON.stringify(document.getElementById('chat-answer')?.textContent ?? '').slice(0, 100),
    rect: (() => { const r = document.getElementById('chat-root')?.getBoundingClientRect(); return r ? { w: r.width, h: r.height } : null; })(),
  })`,
  returnByValue: true,
});
console.log(r.result?.value);
ws.close();
