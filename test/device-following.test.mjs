import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { DeviceServer } from "../src/device-server.mjs";

async function browserFixture(t, initial) {
  let state = initial;
  const events = [];
  const files = {
    "/__device/report.js": "public/device-report.mjs",
    "/__device/session-changes.js": "src/session-changes.mjs",
    "/__device/presentation-plan.js": "src/presentation-plan.mjs",
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    res.setHeader("Cache-Control", "no-store");
    if (files[url.pathname]) {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(await fs.readFile(files[url.pathname], "utf8"));
    }
    if (url.pathname === "/__device/presentation.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end("export const capturePresentation=()=>({});");
    }
    if (req.method === "POST") {
      events.push(url.pathname);
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify(
          url.pathname === "/__device/capture"
            ? { id: "capture-fixture" }
            : { ok: true },
        ),
      );
    }
    if (url.pathname === "/__device/review") {
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          revision: state.revision,
          synchronization: "api",
          url: `/game/own?token=${state.token}&3d=0&ui=desktop`,
        }),
      );
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<html><head><script>window.__GOA2_DEVICE__=${JSON.stringify({ config: { source: "live", render: "2d", uiMode: "desktop", seat: state.token }, presentation: {}, revision: state.revision })};window.htmlToImage={toPng:async()=>"data:image/png;base64,iVBORw0KGgo="};window.__GOA2_LAB_STATE__={view:{teams:{}}};</script></head><body>Game <script type="module" src="/__device/report.js"></script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  return {
    page,
    events,
    origin: `http://127.0.0.1:${server.address().port}`,
    change: (next) => {
      state = next;
    },
  };
}

test("device autoswitch repairs a stale player URL even when bootstrap already has the latest revision", async (t) => {
  const { page, origin } = await browserFixture(t, {
    token: "hanu",
    revision: 1,
  });
  await page.goto(origin + "/game/own?token=arien&3d=0&ui=desktop");
  await page.waitForURL((url) => url.searchParams.get("token") === "hanu");
  assert.equal(new URL(page.url()).pathname, "/game/own");
});

test("device autoswitch resumes after a phone page is restored from background cache", async (t) => {
  const { page, origin, change } = await browserFixture(t, {
    token: "arien",
    revision: 0,
  });
  await page.goto(origin + "/game/own?token=arien&3d=0&ui=desktop");
  await page.locator("#goa2-device-report").waitFor({ state: "attached" });
  await page.evaluate(() =>
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  change({ token: "hanu", revision: 1 });
  await page.evaluate(() =>
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await page.waitForURL((url) => url.searchParams.get("token") === "hanu");
  assert.equal(new URL(page.url()).pathname, "/game/own");
});

test("device gateway redirects old seat tokens to the current viewpoint of the same game", async (t) => {
  const devices = new DeviceServer({}, async () => {}, { port: 0 });
  await devices.listen();
  t.after(() => devices.close());
  const secret = "a".repeat(64);
  devices.sessions.set(secret, {
    id: "phone",
    secret,
    revision: 1,
    oldPaths: new Set(),
    sockets: new Set(),
    config: {
      source: "live",
      profile: "portrait",
      render: "2d",
      uiMode: "mobile",
      seat: "hanu",
    },
    clone: { game_id: "own", seats: { arien: "old", hanu: "new" } },
  });
  const response = await fetch(
    `http://127.0.0.1:${devices.port}/game/own?token=old&3d=0&ui=mobile`,
    { redirect: "manual", headers: { cookie: `goa2_device=${secret}` } },
  );
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("location"), "http://device");
  assert.equal(target.pathname, "/game/own");
  assert.equal(target.searchParams.get("token"), "new");
});

test("device following leaves frontend-managed display query parameters alone", async (t) => {
  const { page, origin } = await browserFixture(t, {
    token: "arien",
    revision: 0,
  });
  await page.goto(origin + "/game/own?token=arien&ui=desktop");
  await page.locator("#goa2-device-report").waitFor({ state: "attached" });
  await page.waitForTimeout(1500);
  assert.equal(new URL(page.url()).searchParams.has("3d"), false);
});

test("closing an accidental empty report releases capture pause and follows Arien without retaining a draft", async (t) => {
  const { page, origin, change, events } = await browserFixture(t, {
    token: "hanu",
    revision: 0,
  });
  await page.goto(origin + "/game/own?token=hanu&3d=0&ui=desktop");
  await page.getByRole("button", { name: "Report testing issue" }).click();
  await page.getByText("Screenshot ready.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  change({ token: "arien", revision: 1 });
  await page.waitForURL((url) => url.searchParams.get("token") === "arien");
  assert.ok(events.filter((e) => e === "/__device/report-discard").length >= 2);
  assert.equal(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith("goa2-device-report-draft:"),
        ).length,
    ),
    0,
  );
  await page.getByRole("button", { name: "Report testing issue" }).click();
  await page.getByText("Screenshot ready.", { exact: true }).waitFor();
  assert.equal(events.filter((e) => e === "/__device/capture").length, 2);
});

test("a commented report survives Close, autoswitch and reload in the same phone tab", async (t) => {
  const { page, origin, change, events } = await browserFixture(t, {
    token: "hanu",
    revision: 0,
  });
  await page.goto(origin + "/game/own?token=hanu&3d=0&ui=desktop");
  await page.getByRole("button", { name: "Report testing issue" }).click();
  await page.getByText("Screenshot ready.", { exact: true }).waitFor();
  await page.getByRole("textbox").fill("Keep this observation");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  change({ token: "arien", revision: 1 });
  await page.waitForURL((url) => url.searchParams.get("token") === "arien");
  await page.reload();
  await page.getByRole("button", { name: "Report testing issue" }).click();
  assert.equal(
    await page.getByRole("textbox").inputValue(),
    "Keep this observation",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Save report", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(events.filter((e) => e === "/__device/capture").length, 1);
});

test("a phone socket reset before websocket upgrade cannot crash the lab gateway", async (t) => {
  const devices = new DeviceServer({}, async () => {}, { port: 0 });
  await devices.listen();
  t.after(() => devices.close());
  const connected = new Promise((resolve) =>
    devices.server.once("connection", resolve),
  );
  const { createConnection } = await import("node:net");
  const client = createConnection({ host: "127.0.0.1", port: devices.port });
  client.on("error", () => {});
  const socket = await connected;
  const closed = new Promise((resolve) => socket.once("close", resolve));
  socket.emit(
    "error",
    Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  );
  await closed;
  client.destroy();
  assert.equal(devices.sockets.size, 0);
  const response = await fetch(`http://127.0.0.1:${devices.port}/`);
  assert.equal(
    response.status,
    403,
    "gateway still serves requests after a phone reset",
  );
});
