// Requires an explicit --verification desk. Exercises the actual embedded games.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { PORTS, DATA, PRESETS } from "../config.mjs";
import { waitFor, delay } from "../services.mjs";
const origin = `http://localhost:${PORTS.desk}`;
async function request(name, body) {
  const r = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const v = await r.json();
  assert.equal(r.status, 200, JSON.stringify(v));
  return v;
}
const status = await request("status");
assert.ok(
  status.verification && status.headless,
  "Start a marked verification desk first.",
);
assert.ok(!status.busy, "Wait for the current verification to finish.");
const situation = await request("starter", {
  name: "Embedded acceptance planning",
});
const browser = await chromium.launch({ headless: true });
const evidence = {
  startedAt: new Date().toISOString(),
  runtime: status.runtime,
  checks: [],
};
try {
  const context = await browser.newContext({
      viewport: { width: 1512, height: 1050 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await request("load", {
    situationId: situation.id,
    slots: PRESETS["Mobile migration"],
    restoreViews: false,
  });
  await page.goto(origin);
  const ready = async (count, width) => {
    await page.waitForFunction(
      ({ count, width }) => {
        const c = [...document.querySelectorAll(".live-stage canvas")];
        return (
          c.length === count &&
          c.every((v) => Number(v.dataset.frames) > 0 && v.width === width) &&
          !document.body.classList.contains("busy")
        );
      },
      { count, width },
      { timeout: 120000 },
    );
  };
  await ready(3, 390);
  assert.equal(await page.locator("iframe").count(), 0);
  const views = await request("views");
  assert.deepEqual(
    views.map((v) => v.scriptActive),
    [false, false, true],
  );
  assert.equal(new Set(views.map((v) => v.gameId)).size, 3);
  assert.equal(new Set(views.map((v) => v.state.hash)).size, 1);
  const locate = async (i, x, y) => {
    const c = page.locator(".live-stage canvas").nth(i),
      r = await c.boundingBox(),
      size = await c.evaluate((c) => ({ width: c.width, height: c.height }));
    return {
      x: r.x + (x * r.width) / size.width,
      y: r.y + (y * r.height) / size.height,
    };
  };
  const click = async (i, x, y) => {
    const p = await locate(i, x, y);
    await page.mouse.click(p.x, p.y);
  };
  await click(1, 117, 818);
  await waitFor(
    async () => (await request("views"))[1].presentation.pane === "hand",
    "embedded native Hand",
  );
  await click(2, 117, 818);
  await waitFor(
    async () => (await request("views"))[2].presentation.pane === "hand",
    "embedded userscript Hand",
  );
  let after = await request("views");
  assert.equal(after[0].presentation.pane, "board");
  assert.equal(new Set(after.map((v) => v.state.hash)).size, 1);
  await click(1, 117, 818);
  await waitFor(
    async () => (await request("views"))[1].presentation.pane === "board",
    "embedded return to Board",
  );
  const p = await locate(1, 195, 440);
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -240);
  await waitFor(
    async () => (await request("views"))[1].presentation.camera.k > 1.1,
    "embedded phone map zoom",
  );
  assert.deepEqual(
    (await request("views"))[0].presentation.camera,
    views[0].presentation.camera,
  );
  const box = await page.locator("canvas").nth(1).boundingBox();
  await page
    .locator(".slot")
    .nth(1)
    .getByRole("button", { name: "Expand", exact: true })
    .click();
  assert.ok(
    (await page.locator("canvas").nth(1).boundingBox()).height > box.height,
  );
  assert.equal(
    await page.locator("canvas").nth(1).getAttribute("width"),
    "390",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".slot.expanded").count(), 0);
  await page.getByLabel("Scale view A").selectOption("actual");
  assert.ok(
    Math.abs((await page.locator("canvas").nth(0).boundingBox()).width - 390) <
      1,
  );
  await page.getByLabel("Scale view A").selectOption("fit");
  const framesBeforeCapture = await page
    .locator("canvas")
    .evaluateAll((cs) => cs.map((c) => Number(c.dataset.frames)));
  const capture = await request("capture", {});
  await page.waitForFunction(
    (before) =>
      [...document.querySelectorAll(".live-stage canvas")].every(
        (c, i) => Number(c.dataset.frames) > before[i],
      ),
    framesBeforeCapture,
  );
  const report = await (
    await fetch(origin + capture.url.replace("index.html", "report.json"))
  ).json();
  assert.equal(report.captures.length, 3);
  assert.ok(report.captures.every((c) => c.width === 390 && c.height === 844));
  await page.reload();
  await ready(3, 390);
  after = await request("views");
  assert.equal(after[2].presentation.pane, "hand");
  assert.ok(after[1].presentation.camera.k > 1.1);
  await page.screenshot({
    path: path.join(DATA, "embedded-mobile.png"),
    fullPage: true,
  });
  evidence.checks.push(
    "three live phone views",
    "native and userscript touch input",
    "independent UI and game state",
    "phone wheel zoom",
    "expand/collapse",
    "100% CSS-pixel display",
    "original-size capture with streams connected",
    "reload preserves views",
  );
  console.log(
    "PASS: three playable phone views, userscript, touch input, zoom, isolation, expand, 100%, capture and reconnect",
  );
  await request("load", {
    situationId: situation.id,
    slots: PRESETS["Layout regression"],
    restoreViews: false,
  });
  await ready(2, 1440);
  let before = await request("views");
  const d = await locate(0, 600, 450);
  await page.mouse.move(d.x, d.y);
  await page.mouse.wheel(0, -250);
  await waitFor(
    async () => (await request("views"))[0].presentation.camera.k > 1.1,
    "desktop 2D zoom",
  );
  after = await request("views");
  assert.deepEqual(after[1].presentation.camera, before[1].presentation.camera);
  evidence.checks.push("two embedded desktop 2D views with independent input");
  console.log("PASS: two desktop 2D views with independent zoom");
  const slots = structuredClone(PRESETS["3D regression"]);
  slots[1].seat = "hero_hanu";
  await request("load", {
    situationId: situation.id,
    slots,
    restoreViews: false,
  });
  await ready(2, 1440);
  before = await request("views");
  const r = await locate(1, 650, 450);
  await page.mouse.move(r.x, r.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(r.x + 65, r.y - 25, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await waitFor(
    async () =>
      JSON.stringify(
        (await request("views"))[1].presentation.camera.position,
      ) !== JSON.stringify(before[1].presentation.camera.position),
    "3D right-drag camera",
  );
  after = await request("views");
  assert.deepEqual(after[0].presentation.camera, before[0].presentation.camera);
  const camera = after[1].presentation.camera;
  await page.locator("canvas").nth(1).focus();
  await page.keyboard.down("w");
  await delay(350);
  await page.keyboard.up("w");
  await waitFor(
    async () =>
      JSON.stringify((await request("views"))[1].presentation.camera.target) !==
      JSON.stringify(camera.target),
    "3D WASD input",
  );
  assert.equal(
    new Set((await request("views")).map((v) => v.state.hash)).size,
    1,
  );
  const frameStart = await page
    .locator("canvas")
    .evaluateAll((cs) => cs.map((c) => Number(c.dataset.frames)));
  await delay(3000);
  const frameEnd = await page
    .locator("canvas")
    .evaluateAll((cs) => cs.map((c) => Number(c.dataset.frames)));
  evidence.liveFramesPerSecond = frameEnd.map(
    (n, i) => (n - frameStart[i]) / 3,
  );
  assert.ok(
    evidence.liveFramesPerSecond.every((n) => n > 0),
    "Both 3D views must update continuously",
  );
  await page.screenshot({
    path: path.join(DATA, "embedded-3d.png"),
    fullPage: true,
  });
  evidence.checks.push(
    "two embedded desktop 3D viewpoints",
    "3D right-drag",
    "3D WASD",
    "camera and game isolation",
  );
  console.log(
    "PASS: two desktop 3D views, independent right-drag and keyboard camera controls",
  );
  assert.deepEqual(errors, []);
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(DATA, "embedded-acceptance.json"),
    JSON.stringify(evidence, null, 2),
  );
} finally {
  await browser.close();
}
