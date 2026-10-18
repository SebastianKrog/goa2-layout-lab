// Run on Windows. Owns its verification instance; normal desk must use other ports.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startDesk } from "../desk.mjs";
import { DATA, PORTS, PRESETS, ROOT } from "../config.mjs";
import { waitFor, delay } from "../services.mjs";
const desk = await startDesk({
  flags: new Set(["--verification", "--no-auto-load", "--no-open"]),
});
const comparison = desk.comparison,
  desktop = comparison.desktop;
const origin = "http://127.0.0.1:" + PORTS.desk;
const evidence = {
  platform: process.platform,
  startedAt: new Date().toISOString(),
  checks: [],
};
async function request(name, body) {
  const r = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  });
  const v = await r.json();
  assert.equal(r.status, 200, JSON.stringify(v));
  return v;
}
async function pass(label) {
  evidence.checks.push(label);
  await fs.writeFile(
    path.join(DATA, "sync-acceptance.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("PASS: " + label);
}
async function idle() {
  await delay(350);
  await comparison.sync.queue;
  assert.equal(comparison.sync.error, null);
}
async function states() {
  return (await request("views")).map((v) => v.state.hash);
}
async function equal() {
  const hashes = await states();
  assert.equal(new Set(hashes).size, 1);
  return hashes[0];
}
async function send(index, message) {
  await comparison.windows[index].page.evaluate((message) => {
    const ws = [...window.__GOA2_LAB_SYNC__.sockets].find(
      (w) => w.readyState === 1,
    );
    if (!ws) throw Error("No connected game socket");
    ws.send(JSON.stringify(message));
  }, message);
  await idle();
}
async function click(index, selector) {
  const win = comparison.windows[index],
    point = await win.page.locator(selector).evaluate((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
  if (desktop) {
    await desktop.app.evaluate(
      (_, { id, point }) => {
        const item = lab.views.get(id),
          wc = item.view.webContents;
        lab.root.show();
        lab.root.focus();
        wc.focus();
        const x = Math.round(point.x * item.scale),
          y = Math.round(point.y * item.scale);
        wc.sendInputEvent({
          type: "mouseDown",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        wc.sendInputEvent({
          type: "mouseUp",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
      },
      { id: win.context.nativeId, point },
    );
  } else await win.page.locator(selector).click();
  await idle();
}
async function probes() {
  for (const w of comparison.windows)
    await w.page.evaluate(() => {
      for (const [n, top] of [
        ["local", 380],
        ["mutation", 430],
      ]) {
        const b = document.createElement("button");
        b.setAttribute("aria-label", "Lab sync " + n);
        b.style.cssText =
          "position:fixed;z-index:2147483646;left:20px;top:" +
          top +
          "px;width:150px;height:38px";
        b.textContent = n;
        b.onclick = () => {
          if (n === "local") window.labLocal = (window.labLocal || 0) + 1;
          else
            [...window.__GOA2_LAB_SYNC__.sockets][0].send(
              JSON.stringify({
                type: "CHEATS_GOLD",
                hero_id: "hero_arien",
                amount: 1,
              }),
            );
        };
        document.body.append(b);
      }
    });
}
try {
  const situation = await request("starter", {
    name: "Synchronization acceptance",
  });
  await request("load", {
    situationId: situation.id,
    slots: PRESETS["Mobile migration"],
    restoreViews: false,
  });
  if (desktop) {
    await desktop.app.evaluate(() => lab.root.show());
    await desktop.root.waitForFunction(
      () =>
        document.querySelectorAll(".native-stage").length === 3 &&
        !document.body.classList.contains("busy"),
      null,
      { timeout: 120000 },
    );
  }
  for (const w of comparison.windows)
    assert.equal(
      await w.page
        .locator('[class*="cheatPanel"]')
        .filter({ visible: true })
        .count(),
      0,
    );
  await request("cheats", { show: true });
  assert.ok(
    await comparison.windows[0].page
      .locator('[class*="cheatPanel"]')
      .isVisible(),
  );
  await request("cheats", { show: false });
  assert.equal(
    await comparison.windows[0].page
      .locator('[class*="cheatPanel"]')
      .isVisible(),
    false,
  );
  await pass("Cheats hidden by default and explicit visibility toggle");
  await request("synchronize", { mode: "api" });
  let before = await equal();
  for (let index = 0; index < 3; index++) {
    await send(index, {
      type: "CHEATS_GOLD",
      hero_id: "hero_arien",
      amount: 1,
    });
    const after = await equal();
    assert.notEqual(before, after);
    before = after;
  }
  await pass(
    "API actions from any view synchronize all three independent games",
  );
  await Promise.all([
    send(0, { type: "CHEATS_GOLD", hero_id: "hero_arien", amount: 1 }),
    send(2, { type: "CHEATS_GOLD", hero_id: "hero_arien", amount: 1 }),
  ]);
  await equal();
  await pass("Concurrent drivers are serialized");
  await request("configure", { index: 1, update: { seat: "hero_hanu" } });
  const card = await comparison.windows[1].page.evaluate(
    () =>
      Object.values(window.__GOA2_LAB_STATE__.view.teams)
        .flatMap((t) => t.heroes)
        .find((h) => h.id === "hero_hanu").hand[0].id,
  );
  before = await equal();
  await send(1, { type: "COMMIT_CARD", card_id: card });
  assert.notEqual(await equal(), before);
  await send(1, { type: "UNCOMMIT_CARD" });
  await equal();
  assert.ok(comparison.windows.every((w) => !w.page.isClosed()));
  await pass("Different viewpoints preserve actor identity and player sockets");
  await probes();
  await click(0, '[aria-label="Lab sync local"]');
  assert.deepEqual(
    await Promise.all(
      comparison.windows.map((w) =>
        w.page.evaluate(() => window.labLocal || 0),
      ),
    ),
    [1, 0, 0],
  );
  await pass("API-only mode keeps UI clicks independent");
  await request("synchronize", { mode: "api-clicks" });
  await click(2, '[aria-label="Lab sync local"]');
  assert.deepEqual(
    await Promise.all(
      comparison.windows.map((w) =>
        w.page.evaluate(() => window.labLocal || 0),
      ),
    ),
    [2, 1, 1],
  );
  await equal();
  await pass("Trusted UI clicks mirror from any view without loops");
  const gold = () =>
    comparison.windows[0].page.evaluate(
      () =>
        Object.values(window.__GOA2_LAB_STATE__.view.teams)
          .flatMap((t) => t.heroes)
          .find((h) => h.id === "hero_arien").gold,
    );
  const goldBefore = await gold();
  await click(1, '[aria-label="Lab sync mutation"]');
  await equal();
  assert.equal(await gold(), goldBefore + 1);
  await pass("Game-action clicks are submitted exactly once per game");
  await click(1, '[data-pane="hand"]');
  await waitFor(
    async () => (await request("views"))[2].presentation.pane === "hand",
    "semantic cross-layout Hand",
    15000,
  );
  await equal();
  await pass("Hand panel maps between native mobile and userscript layouts");
  await request("synchronize", { mode: "none" });
  before = await states();
  await send(0, { type: "CHEATS_GOLD", hero_id: "hero_arien", amount: 1 });
  const independent = await states();
  assert.notEqual(independent[0], before[0]);
  assert.deepEqual(independent.slice(1), before.slice(1));
  const rejected = await fetch(origin + "/api/synchronize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "api" }),
  });
  assert.equal(rejected.status, 422);
  await pass("None stays independent and divergent games cannot enable sync");
  await request("reset", {});
  await request("synchronize", { mode: "api" });
  await equal();
  const oldIds = comparison.windows.map((w) => w.clone.game_id),
    oldNative = comparison.windows.map((w) => w.context.nativeId),
    oldRefs = (await request("status")).references;
  await request("live", { enabled: true });
  assert.equal(comparison.windows[1].config.source, "live");
  assert.deepEqual(
    comparison.windows.map((w) => w.clone.game_id),
    oldIds,
  );
  assert.equal(comparison.windows[0].context.nativeId, oldNative[0]);
  assert.equal(comparison.windows[2].context.nativeId, oldNative[2]);
  await equal();
  const filename = path.join(ROOT, "src/components/pages/GameView.module.css"),
    original = await fs.readFile(filename, "utf8"),
    probe =
      "\n/* layout-lab synchronization acceptance */\n:root{--lab-sync-hmr:1}\n";
  try {
    await fs.appendFile(filename, probe);
    await waitFor(
      () =>
        comparison.windows[1].page.evaluate(
          () =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--lab-sync-hmr")
              .trim() === "1",
        ),
      "Live CSS HMR",
      30000,
    );
    assert.equal(
      await comparison.windows[0].page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--lab-sync-hmr")
          .trim(),
      ),
      "",
    );
    assert.deepEqual((await request("status")).references, oldRefs);
  } finally {
    const current = await fs.readFile(filename, "utf8");
    if (current.endsWith(probe))
      await fs.writeFile(filename, current.slice(0, -probe.length));
    else
      throw Error("Concurrent source edit: leave named CSS probe for review");
  }
  await request("live", { enabled: false });
  assert.equal(comparison.windows[1].config.source, "comparator");
  await equal();
  await pass(
    "Live updates preserve games, frozen refs and other native views; CSS hot reload is isolated",
  );
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(DATA, "sync-acceptance.json"),
    JSON.stringify(evidence, null, 2),
  );
} finally {
  await desk.close();
}
