/**
 * Verifies copy chip visibility logic via synthetic hover.
 * Usage: node scripts/probe-copy-chip.mjs
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
  expression: `(() => {
    try {
      const root = document.getElementById('chat-root');
      const chip = document.getElementById('chat-copy');
      const ans = document.getElementById('chat-answer');
      ans.textContent = 'test reply';
      root.classList.remove('hidden');
      root.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      const hoverShown = !chip.classList.contains('hidden');
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      const outHidden = chip.classList.contains('hidden');
      return JSON.stringify({ hoverShown, outHidden });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(r.result ?? r));
ws.close();
