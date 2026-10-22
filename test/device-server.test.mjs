import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { DeviceServer } from "../device-server.mjs";

test("device links scope HTTP/WS to a clone, inject reporting, generate QR and revoke access", async () => {
  let iconRequests = 0;
  const icon = new PNG({ width: 1, height: 1 });
  icon.data.fill(255);
  const iconPNG = PNG.sync.write(icon);
  const frontend = http.createServer((req, res) => {
    if (req.url === "/fixture-icon.png") {
      iconRequests++;
      res.setHeader("Content-Type", "image/png");
      res.end(iconPNG);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;min-height:100vh;background:#123456;color:white"><div style="height:40px;visibility:hidden">Reserved header</div><div style="height:10px;background:#1a9e49"></div><h1>Device game</h1><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><img src="/fixture-icon.png" style="position:absolute;left:0;top:300px;width:1px;height:1px"><script>window.__GOA2_LAB_STATE__={view:{phase:"PLANNING",teams:{}}}</script></body></html>',
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
    presentation: {
      schema: 2,
      viewpoint: "hero_missing",
      sessionState: { pane: "board", render: "3d" },
      userState: {},
    },
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
        uiMode: "mobile",
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
    await page.evaluate(() => {
      window.__vibrations = [];
      Object.defineProperty(navigator, "vibrate", {
        value: (pattern) => {
          window.__vibrations.push(pattern);
          return true;
        },
      });
    });
    const launch = page.getByRole("button", { name: "Report testing issue" });
    await launch.waitFor();
    const original = await launch.boundingBox();
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          x: original.x + original.width / 2,
          y: original.y + original.height / 2,
        },
      ],
    });
    await page.waitForTimeout(500); // The deliberate long-press gesture.
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 50, y: 600 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(
      await page.getByRole("dialog").isVisible(),
      false,
      "dragging must not open a report",
    );
    assert.deepEqual(await page.evaluate(() => window.__vibrations), [15]);
    const moved = await launch.boundingBox();
    assert.ok(moved.x < original.x - 50 && moved.y > original.y + 100);
    await page.reload();
    await launch.waitFor();
    const restored = await launch.boundingBox();
    assert.ok(
      Math.abs(restored.x - moved.x) < 2 && Math.abs(restored.y - moved.y) < 2,
      "button position survives a reload",
    );

    const previousIconRequests = iconRequests;
    // Hold image generation open: the form must be usable before it finishes.
    await page.evaluate(() => {
      const visibleCanvas = document.createElement("canvas");
      visibleCanvas.width = 2400;
      visibleCanvas.height = 1600;
      Object.assign(visibleCanvas.style, {
        position: "absolute",
        left: "20px",
        top: "100px",
        width: "120px",
        height: "80px",
      });
      const context = visibleCanvas.getContext("2d");
      context.fillStyle = "#d02040";
      context.fillRect(0, 0, visibleCanvas.width, visibleCanvas.height);
      document.body.append(visibleCanvas);
      const offscreenCanvas = document.createElement("canvas");
      offscreenCanvas.width = 2400;
      offscreenCanvas.height = 1600;
      Object.assign(offscreenCanvas.style, {
        position: "absolute",
        top: "3000px",
        width: "120px",
        height: "80px",
      });
      document.body.append(offscreenCanvas);
      const originalEncode = HTMLCanvasElement.prototype.toDataURL;
      window.__encodedSizes = [];
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        window.__encodedSizes.push([this.width, this.height]);
        return originalEncode.apply(this, args);
      };
      const swatch = document.createElement("div");
      swatch.style.cssText =
        "position:absolute;left:200px;top:220px;--capture-color:#238cda";
      swatch.className = "capture-swatch";
      const localVariables = document.createElement("style");
      localVariables.textContent = ".capture-swatch{--capture-color:#238cda}";
      document.head.append(localVariables);
      swatch.innerHTML =
        '<svg width="20" height="20"><rect width="20" height="20" style="fill:var(--capture-color)"/></svg>';
      document.body.append(swatch);
      const toPng = window.htmlToImage.toPng;
      window.htmlToImage.toPng = async (...args) => {
        await new Promise((resolve) => {
          window.__releaseScreenshot = resolve;
        });
        return toPng(...args);
      };
    });
    await launch.click();
    await page.getByRole("dialog").waitFor({ timeout: 1500 });
    await page.getByRole("textbox").fill("Make this clearer");
    assert.equal(
      await page
        .getByRole("button", { name: "Save report", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await launch.click();
    assert.equal(
      await page.getByRole("textbox").inputValue(),
      "Make this clearer",
      "closing and reopening keeps the comment while capture is pending",
    );
    await page.waitForFunction(
      () => typeof window.__releaseScreenshot === "function",
    );
    await page.evaluate(() => window.__releaseScreenshot());
    const image = page.getByAltText(
      "Captured game screen without reporting controls",
    );
    await page.waitForFunction(() =>
      document
        .getElementById("goa2-device-report")
        .shadowRoot.querySelector("img")
        .src.startsWith("data:image/png"),
    );
    const png = PNG.sync.read(
      Buffer.from((await image.getAttribute("src")).split(",")[1], "base64"),
    );
    const pixel =
      ((Math.floor(restored.y) + 20) * png.width +
        Math.floor(restored.x) +
        30) *
      4;
    assert.deepEqual(
      [...png.data.subarray(pixel, pixel + 3)],
      [18, 52, 86],
      "the moved button and open dialog are absent from the screenshot",
    );
    assert.equal(
      iconRequests - previousIconRequests,
      1,
      "repeated visible icons share one capture fetch",
    );
    const reservedPixel = (45 * png.width + 5) * 4;
    assert.deepEqual(
      [...png.data.subarray(reservedPixel, reservedPixel + 3)],
      [26, 158, 73],
      "invisible reserved layout space must remain in the capture",
    );
    const swatchPixel = (225 * png.width + 205) * 4;
    assert.deepEqual(
      [...png.data.subarray(swatchPixel, swatchPixel + 3)],
      [35, 140, 218],
      "inline layout/color variables survive optimized style copying",
    );
    const cardPixel = (140 * png.width + 60) * 4;
    assert.deepEqual(
      [...png.data.subarray(cardPixel, cardPixel + 3)],
      [208, 32, 64],
      "display-sized card capture keeps its visible pixels",
    );
    assert.equal(
      await page.evaluate(() =>
        window.__encodedSizes.some(
          ([width, height]) => width >= 2400 || height >= 1600,
        ),
      ),
      false,
      "reporting does not encode full-resolution painted cards",
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
    assert.ok(
      reports[0].provenance.presentationResolution.warnings.some(
        (w) => w.includes("hero_missing") && w.includes("hero_arien"),
      ),
    );
    assert.ok(
      reports[0].provenance.presentationResolution.warnings.some((w) =>
        w.includes("no 2d adapter"),
      ),
    );
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
