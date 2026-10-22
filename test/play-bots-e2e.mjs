// Run against an owned, empty test desk. Never replaces an existing human game.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { DATA, PORTS } from "../config.mjs";
const origin = `http://127.0.0.1:${PORTS.desk}`;
const out = path.join(DATA, "reviews/play-bots");
await fs.mkdir(out, { recursive: true });
async function api(route, body) {
  const response = await fetch(`${origin}/api/${route}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
assert.equal(
  (await api("status")).windows.length,
  0,
  "Use an empty, owned test desk",
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function idle() {
  await page.waitForFunction(
    () => !document.body.classList.contains("busy"),
    null,
    { timeout: 180000 },
  );
}
async function edit(index) {
  await page
    .locator(".slot")
    .nth(index)
    .getByRole("button", { name: "Edit view", exact: true })
    .click();
  await page.locator("#editor").waitFor();
  if (!(await page.locator("#playOptions").evaluate((e) => e.open)))
    await page.locator("#playOptions > summary").click();
}
async function apply() {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await idle();
  assert.equal(
    await page.locator("#error").isVisible(),
    false,
    await page.locator("#error").textContent(),
  );
}
async function changedHash(index, before) {
  for (let tries = 0; tries < 50; tries++) {
    const views = await api("views");
    if (views[index].state.hash !== before) return views;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error("Bots did not advance the regular view");
}
try {
  await page.goto(origin);
  await page
    .locator("#situation option[value='a00000000001']")
    .waitFor({ state: "attached" });
  await page.locator("#workspaceTools").click();
  await page.locator("#situation").selectOption("a00000000001");
  await page.locator("#preset").selectOption("Play solo");
  assert.equal(await page.locator("#count").inputValue(), "1");
  await page.locator("#load").click();
  await idle();
  assert.equal(
    await page.locator("#error").isVisible(),
    false,
    await page.locator("#error").textContent(),
  );
  let status = await api("status");
  assert.equal(status.windows.length, 1);
  assert.equal(await page.locator(".slots.one .slot").count(), 1);
  assert.equal(await page.locator("#synchronize").isDisabled(), true);
  assert.equal(await page.locator("#capture").isEnabled(), true);
  const original = (await api("views"))[0].state.hash;
  const gameId = status.windows[0].gameId;
  await edit(0);
  assert.equal(await page.locator("#viewBotRows select").count(), 3);
  assert.equal(
    await page.locator('[data-view-bot-hero="hero_arien"]').count(),
    0,
  );
  await page.locator("#viewBotPreset").selectOption("random");
  await page.locator("#viewBotDetails summary").click();
  await page.locator('[data-view-bot-hero="hero_hanu"]').selectOption("ismcts");
  assert.equal(await page.locator("#viewBotPreset").inputValue(), "custom");
  await page.screenshot({ path: path.join(out, "controllers.png") });
  await apply();
  let views = await changedHash(0, original);
  assert.equal(
    views[0].gameId,
    gameId,
    "Controller changes keep the same game",
  );
  assert.equal(views[0].config.bots.hero_hanu, "ismcts");
  const capture = await api("capture", { indexes: [0] });
  const report = await (
    await fetch(origin + capture.url.replace("index.html", "report.json"))
  ).json();
  assert.equal(report.captures.length, 1);
  assert.equal(report.pairs.length, 0);
  await page.screenshot({ path: path.join(out, "single-view.png") });
  await edit(0);
  if (!(await page.locator("#playOptions").evaluate((e) => e.open)))
    await page.locator("#playOptions > summary").click();
  await page.locator("#viewBotPreset").selectOption("manual");
  await apply();
  views = await api("views");
  const stopped = views[0].state.hash;
  assert.equal(views[0].gameId, gameId);
  assert.deepEqual(views[0].config.bots, {});
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal((await api("views"))[0].state.hash, stopped);
  await page.locator("#workspaceTools").click();
  await page.locator("#count").selectOption("2");
  await page.locator("#load").click();
  await idle();
  views = await api("views");
  assert.equal(views.length, 2);
  const manualHash = views[0].state.hash;
  await edit(1);
  await page.locator("#viewBotPreset").selectOption("heuristic");
  await apply();
  views = await changedHash(1, manualHash);
  assert.equal(
    views[0].state.hash,
    manualHash,
    "Other view remains manual and unchanged",
  );
  assert.deepEqual(views[0].config.bots, {});
  assert.equal(
    Object.values(views[1].config.bots).every((kind) => kind === "heuristic"),
    true,
  );
  assert.equal(await page.locator("#synchronize").isDisabled(), true);
  const rejected = await fetch(origin + "/api/synchronize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "api" }),
  });
  assert.equal(rejected.ok, false);
  assert.match((await rejected.json()).error, /Turn off bots/);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        singleView: true,
        mixedControllers: true,
        keepsGameOnChange: true,
        singleCapture: true,
        independentViews: true,
        synchronizationGuard: true,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: one view, mixed bots, live controller changes, single capture and independent bot views",
  );
} finally {
  await api("clear").catch(() => {});
  await browser.close();
}
