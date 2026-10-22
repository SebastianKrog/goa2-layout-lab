// Run with distinct GOA2_LAB_*_PORT values; owns and closes its desk.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { startDesk } from "../src/desk.mjs";
import { PORTS, STARTUP, DATA } from "../src/config.mjs";
const native = STARTUP.display === "embedded";
const app = await startDesk({
  flags: new Set([
    "--verification",
    "--no-open",
    ...(!native ? ["--headless"] : []),
  ]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
async function api(name, body) {
  const r = await fetch(origin + "/api/" + name, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  assert.ok(r.ok, JSON.stringify(v));
  return v;
}
async function idle() {
  for (let n = 0; n < 500; n++) {
    if (!(await api("status")).busy) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Desk busy");
}
try {
  if (native) await app.comparison.desktop.open(origin, true);
  const desk = native
    ? app.comparison.desktop.root
    : await app.comparison.browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
  desk.on("pageerror", (e) => console.error("Desk page error:", e.message));
  if (!native) await desk.goto(origin);
  await desk.locator(".slot").waitFor();
  assert.equal(await desk.locator(".slot").count(), 1);
  assert.equal((await api("status")).windows.length, 0);
  await desk
    .locator(".slot")
    .getByRole("button", { name: "Start", exact: true })
    .click();
  await desk.locator("#editor[open]").waitFor();
  assert.equal(await desk.locator("#editorSubmit").textContent(), "Start");
  await desk.locator("#viewSituation").selectOption("a00000000001");
  await desk
    .locator('#editorFields select[aria-label="Device"]')
    .selectOption("portrait");
  // Use the mobile shell to keep this acceptance session lightweight.
  await desk
    .locator('#editorFields select[aria-label="Interface preset"]')
    .selectOption("mobile");
  assert.equal(
    await desk
      .locator('#editorAdvancedFields select[aria-label="Renderer"]')
      .inputValue(),
    "2d",
  );
  assert.equal(
    await desk
      .locator('#editorAdvancedFields select[aria-label="UI mode"]')
      .inputValue(),
    "mobile",
  );
  await desk.locator("#editorSubmit").click();
  await desk.locator("#editor").waitFor({ state: "hidden", timeout: 180000 });
  await idle();
  await desk.waitForFunction(
    () =>
      document.querySelectorAll(".slot .live-stage:not(.empty-view)").length ===
      1,
  );
  const first = (await api("status")).windows[0];
  assert.equal(first.config.source, "live");
  // The Layout default can differ from the effective Situation Viewpoint.
  app.comparison.windows[0].config.presentationDefaults = {
    schema: 2,
    viewpoint: "spectator",
    sessionState: {},
    userState: {},
  };
  const sourceSeat = app.comparison.windows[0].config.seat;
  assert.notEqual(sourceSeat, "spectator");
  const hash = (await api("views"))[0].state.hash;
  // Keep the async roster request pending across a status poll: the draft must survive.
  await desk.route(
    "**/api/device/options?*",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
      await route.continue();
    },
    { times: 1 },
  );
  await desk.locator("#addView").click();
  assert.equal(await desk.locator(".slot").count(), 2);
  await desk.locator("#editor[open]").waitFor();
  assert.equal(await desk.locator("#viewSituation").inputValue(), "__current");
  await desk.locator('#editor [data-close="editor"]').last().click();
  await desk.waitForFunction(
    () => document.querySelectorAll(".slot").length === 1,
  );
  assert.equal((await api("status")).windows[0].gameId, first.gameId);
  await desk.locator("#addView").click();
  await desk.locator("#editor[open]").waitFor();
  await desk.locator("#editorSubmit").click();
  await desk.locator("#editor").waitFor({ state: "hidden", timeout: 180000 });
  await idle();
  await desk.waitForFunction(
    () =>
      document.querySelectorAll(".slot .live-stage:not(.empty-view)").length ===
      2,
  );
  const status = await api("status");
  assert.equal(status.windows.length, 2);
  assert.equal(status.windows[1].config.seat, sourceSeat);
  await app.comparison.reset(1);
  assert.equal(app.comparison.windows[1].config.seat, sourceSeat);
  // The second clone has been reset; use its new identity for later assertions.
  status.windows[1] = (await api("status")).windows[1];
  assert.equal(status.windows[0].gameId, first.gameId);
  assert.notEqual(status.windows[1].gameId, first.gameId);
  assert.deepEqual(
    (await api("views")).map((v) => v.state.hash),
    [hash, hash],
  );
  const widths = await desk
    .locator(".slot")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().width));
  assert.ok(Math.abs(widths[0] - widths[1]) < 2);
  await desk
    .locator(".slot")
    .nth(1)
    .getByRole("button", { name: "Edit view", exact: true })
    .click();
  await desk.locator("#editor[open]").waitFor();
  assert.equal(await desk.locator("#editorSubmit").textContent(), "Save");
  await desk.locator("#viewAdvanced summary").click();
  await desk.locator("#editorAdvancedFields input").fill("Edited view");
  await desk.locator("#editorSubmit").click();
  await desk.locator("#editor").waitFor({ state: "hidden", timeout: 180000 });
  await idle();
  assert.deepEqual(
    (await api("status")).windows.map((w) => w.gameId),
    status.windows.map((w) => w.gameId),
  );
  const saved = await api("save", {
    index: 0,
    name: "Workspace acceptance checkpoint",
  });
  assert.deepEqual(saved.presentations || {}, {});
  assert.equal(saved.provenance.slots, undefined);
  const presentation = await api("presentation/save", {
    index: 0,
    name: "Workspace acceptance presentation",
  });
  assert.ok(presentation.state);
  assert.equal(presentation.checkpoint, undefined);
  await api("pane", { index: 0, pane: "hand" });
  assert.equal((await api("views"))[0].presentation.pane, "hand");
  await api("presentation/apply", { index: 0, id: presentation.id });
  assert.equal(
    (await api("views"))[0].presentation.pane,
    presentation.state.sessionState.pane,
  );
  assert.equal((await api("views"))[0].state.hash, hash);
  const out = path.join(
    DATA,
    "reviews/view-workspace",
    native ? "native" : "browser",
  );
  await fs.mkdir(out, { recursive: true });
  await desk.waitForFunction(() => !document.body.classList.contains("busy"));
  if (native) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const shown = await app.comparison.desktop.app.evaluate(
        () =>
          [...lab.views.values()].filter(
            (v) => v.host.getVisible() && v.lastLayout?.visible,
          ).length,
      );
      if (shown === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const placement = await app.comparison.desktop.app.evaluate(() =>
      [...lab.views.values()].map((v) => ({
        visible: v.host.getVisible(),
        bounds: v.host.getBounds(),
        layout: v.lastLayout,
      })),
    );
    await fs.writeFile(
      path.join(out, "placement.json"),
      JSON.stringify(placement, null, 2),
    );
    assert.equal(
      placement.filter(
        (v) => v.visible && v.layout?.visible && v.bounds.width > 0,
      ).length,
      2,
    );
    for (const [index, win] of app.comparison.windows.entries()) {
      const pixels = await win.page.screenshot({
        path: path.join(out, `game-${index}.png`),
      });
      const png = PNG.sync.read(pixels);
      const colors = new Set();
      for (let i = 0; i < png.data.length; i += 400)
        colors.add(png.data.subarray(i, i + 3).toString("hex"));
      assert.ok(colors.size > 20, "Native game has rendered content");
    }
    const shot = await app.comparison.desktop.app.evaluate(async () =>
      lab.screenshot(),
    );
    await fs.writeFile(
      path.join(out, "workspace.png"),
      Buffer.from(shot, "base64"),
    );
  } else await desk.screenshot({ path: path.join(out, "workspace.png") });
  await api("views/remove", { index: 0 });
  await idle();
  assert.equal(
    (await api("status")).windows[0].gameId,
    status.windows[1].gameId,
  );
  await desk.waitForFunction(
    () => document.querySelectorAll(".slot").length === 1,
  );
  if (native) {
    const visible = await app.comparison.desktop.app.evaluate(
      () =>
        [...lab.views.values()].filter(
          (v) => v.host.getVisible() && v.lastLayout?.visible,
        ).length,
    );
    assert.equal(
      visible,
      1,
      "Remaining native view remains visible after its index changes",
    );
  }
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        native,
        firstGamePreserved: true,
        equalWidths: widths,
        separateSaves: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: single current view, Start, Add/Cancel, independent clone, Save, equal sizing, separate situation/presentation, remove",
  );
} finally {
  await app.close();
}
