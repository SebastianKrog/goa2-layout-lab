import assert from "node:assert/strict";
import http from "node:http";
import { WebSocketServer } from "ws";
import { chromium } from "playwright";
import { installBridge, ACTIONS } from "../src/synchronize.mjs";
const events = [],
  received = [];
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(
    '<div class="cheatPanel_test">Cheats</div><button aria-label="Mutate">Mutate</button><script>window.game=new WebSocket(location.origin.replace("http","ws")+"/api/games/test/ws");document.querySelector("button").onclick=()=>game.send(JSON.stringify({type:"CHEATS_GOLD",hero_id:"hero_arien",amount:1}));</script>',
  );
});
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) =>
  ws.on("message", (data) => received.push(JSON.parse(data))),
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.exposeBinding("__labSyncEvent", (_, event) => events.push(event));
  await page.addInitScript(installBridge, {
    mode: "api-clicks",
    cheats: false,
    actions: ACTIONS,
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(
    () => game.readyState === 1 && window.__GOA2_LAB_SYNC__.sockets.size === 1,
  );
  assert.equal(await page.locator(".cheatPanel_test").isVisible(), false);
  await page.evaluate(() => {
    window.__GOA2_LAB_SYNC__.replaying = true;
    document.querySelector("button").click();
  });
  await page.waitForTimeout(220);
  assert.equal(events.length, 0);
  assert.equal(received.length, 0);
  await page.getByRole("button", { name: "Mutate", exact: true }).click();
  await page.waitForTimeout(220);
  assert.equal(events.filter((e) => e.kind === "action").length, 1);
  assert.equal(events.filter((e) => e.kind === "click").length, 1);
  assert.equal(received.length, 0);
  await page.evaluate(() => {
    const b = window.__GOA2_LAB_SYNC__;
    b.replaying = false;
    b.mode = "none";
    b.cheats = true;
    b.applyCheats();
  });
  assert.equal(await page.locator(".cheatPanel_test").isVisible(), true);
  await page.getByRole("button", { name: "Mutate", exact: true }).click();
  await page.waitForTimeout(220);
  assert.equal(received.length, 1);
  assert.equal(events.filter((e) => e.kind === "action").length, 1);
  await page.evaluate(async () => {
    const vite = new WebSocket(location.origin.replace("http", "ws") + "/vite");
    await new Promise((r) => (vite.onopen = r));
    vite.send(JSON.stringify({ type: "CHEATS_GOLD" }));
  });
  await page.waitForTimeout(150);
  assert.equal(received.length, 2);
  console.log(
    "PASS: proxied game sockets, replay suppression, concurrent human gestures, None passthrough, non-game socket isolation and Cheats default",
  );
} finally {
  await browser.close();
  wss.close();
  server.close();
}
