/**
 * CDP driver: opens Xena chat panel and sends a message through the real UI.
 * Usage: node scripts/drive-xena.mjs "message"
 */
const message = process.argv[2] ?? "Say hi in five words";
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
const expr = `
  document.getElementById('avatar-stage').click();
  window.xena.sendChat(${JSON.stringify(message)});
  'sent'
`;
const result = await call("Runtime.evaluate", { expression: expr, awaitPromise: false });
console.log("evaluate:", result.result.value ?? JSON.stringify(result.result));
ws.close();
