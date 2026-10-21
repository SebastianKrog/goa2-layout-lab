import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { DeviceServer } from "../device-server.mjs";

test("device links scope HTTP/WS to a clone, inject reporting, generate QR and revoke access", async () => {
  const frontend = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;min-height:100vh;background:#123456;color:white"><h1>Device game</h1><script>window.__GOA2_LAB_STATE__={view:{phase:"PLANNING",teams:{}}}</script></body></html>',
    );
  });
  const ws = new WebSocketServer({ noServer: true });
  frontend.on("upgrade", (req, socket, head) =>
    ws.handleUpgrade(req, socket, head, (client) =>
      client.on("message", (data) => client.send(data)),
    ),
  );
  await new Promise((resolve) => frontend.listen(0, "127.0.0.1", resolve));
  const reports = [];
  const situation = {
    id: "fixture",
    name: "Device fixture",
    checkpoint: {
      state: {
        teams: { RED: { heroes: [{ id: "hero_arien", name: "Arien" }] } },
      },
    },
    provenance: {},
    presentations: {},
  };
  const api = async (route, body) => {
    if (route.startsWith("/situations/")) return situation;
    if (route === "/clone")
      return {
        game_id: "clone",
        seats: { hero_arien: "seat-secret" },
        spectator_token: "watch-secret",
      };
    if (route === "/device/capture") {
      reports.push(body);
      return { id: "capture1" };
    }
    if (route === "/device/report") {
      reports.push(body);
      return { id: body.id };
    }
    throw Error(route);
  };
  const devices = new DeviceServer(
    {
      frontend: async () => frontend.address().port,
      comparator: "revision",
      references: { base: "base-revision" },
    },
    api,
    { port: 0, hosts: () => ["127.0.0.1"] },
  );
  let browser;
  try {
    const view = await devices.open({
      situationId: "fixture",
      slot: {
        source: "live",
        seat: "hero_arien",
        render: "2d",
        layout: "mobile",
        profile: "portrait",
      },
    });
    assert.ok(view.qr.startsWith("data:image/png;base64,"));
    const qr = PNG.sync.read(Buffer.from(view.qr.split(",")[1], "base64"));
    assert.equal(qr.width, 320);
    const entry = await fetch(view.urls[0], { redirect: "manual" });
    const cookie = entry.headers.get("set-cookie").split(";")[0];
    const origin = new URL(view.urls[0]).origin;
    const get = (route) => fetch(origin + route, { headers: { cookie } });
    assert.equal((await fetch(origin + "/")).status, 403);
    assert.equal((await get("/api/__lab/health")).status, 403);
    assert.equal(
      (await get("/@fs/tool/.layout-lab/situations/private.json")).status,
      403,
    );
    assert.equal((await get("/@fs/tool/.env")).status, 403);
    assert.equal((await get("/api/games/someone-else")).status, 403);
    const html = await (await get(entry.headers.get("location"))).text();
    assert.ok(html.includes("/__device/report.js"));
    assert.ok(
      html.indexOf("/__device/bootstrap.js") <
        html.indexOf("window.__GOA2_LAB_STATE__"),
    );
    const crossOrigin = await fetch(origin + "/__device/capture", {
      method: "POST",
      headers: {
        cookie,
        Origin: "http://elsewhere.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(crossOrigin.status, 403);
    const socket = new WebSocket(
      origin.replace("http:", "ws:") + "/api/games/clone/ws",
      { headers: { Cookie: cookie, Origin: origin } },
    );
    await once(socket, "open");
    socket.send("hello");
    assert.equal((await once(socket, "message"))[0].toString(), "hello");

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await page.addInitScript(() => {
      crypto.randomUUID = undefined;
    });
    await page.goto(view.urls[0]);
    assert.match(
      await page.evaluate(() => crypto.randomUUID()),
      /^[a-f0-9-]{36}$/,
    );
    await page.getByRole("button", { name: "Report testing issue" }).click();
    await page.getByRole("dialog").waitFor();
    const image = page.getByAltText(
      "Captured game screen without reporting controls",
    );
    const png = PNG.sync.read(
      Buffer.from((await image.getAttribute("src")).split(",")[1], "base64"),
    );
    const pixel = (20 * png.width + png.width - 30) * 4;
    assert.deepEqual(
      [...png.data.subarray(pixel, pixel + 3)],
      [18, 52, 86],
      "floating button is absent from the screenshot",
    );
    await page.getByRole("textbox").fill("Make this clearer");
    await page
      .getByRole("button", { name: "Save report", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Saved in layout lab" })
      .waitFor();
    assert.equal(reports[0].game_id, "clone");
    assert.equal(reports[1].comment, "Make this clearer");
    assert.ok(!JSON.stringify(reports).includes("seat-secret"));
    const closed = once(socket, "close");
    devices.stop(view.id);
    await closed;
    assert.equal((await get("/api/games/clone")).status, 403);
  } finally {
    await browser?.close();
    await devices.close();
    ws.close();
    await new Promise((resolve) => frontend.close(resolve));
  }
});
