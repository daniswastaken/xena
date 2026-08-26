/**
 * Arms a chat event counter in the chat window.
 * Usage: node scripts/arm-chat.mjs
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
await call("Runtime.evaluate", {
  expression:
    "window.__c = 0; window.xena.onChatToken(() => window.__c++); window.xena.onChatDone(() => window.__c += 100); 'armed'",
  returnByValue: true,
});
console.log("armed");
ws.close();
