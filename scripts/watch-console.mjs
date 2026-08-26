/**
 * Reloads the avatar page and streams console errors/exceptions for 10s.
 * Usage: node scripts/watch-console.mjs
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

ws.addEventListener("message", (ev) => {
  const data = JSON.parse(ev.data);
  if (data.method === "Runtime.exceptionThrown") {
    const d = data.params.exceptionDetails;
    console.log("EXCEPTION:", d.exception?.description ?? d.text);
  }
  if (data.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(data.params.type)) {
    console.log(`CONSOLE.${data.params.type}:`, data.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
});

await call("Runtime.enable");
await call("Page.enable");
await call("Page.reload");
await new Promise((r) => setTimeout(r, 10000));
console.log("done watching");
ws.close();
