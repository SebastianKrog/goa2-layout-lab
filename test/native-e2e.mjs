// Starts and owns a native verification desk. Requires an available display.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startDesk } from "../desk.mjs";
import { PORTS, DATA, PRESETS } from "../config.mjs";
import { waitFor, delay } from "../services.mjs";
const origin = `http://localhost:${PORTS.desk}`;
const desk = await startDesk({
  flags: new Set(["--verification", "--no-auto-load"]),
});
const comparison = desk.comparison,
  desktop = comparison.desktop;
const evidence = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  checks: [],
};
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
const errors = [],
  streams = [];
async function ready(count) {
  console.log("Waiting for native views: " + count);
  await desktop.root
    .waitForFunction(
      (n) =>
        document.querySelectorAll(".native-stage").length === n &&
        !document.body.classList.contains("busy"),
      count,
      { timeout: 120000 },
    )
    .catch(async (error) => {
      console.error(
        JSON.stringify(
          await desktop.root.evaluate(() => ({
            nativeBridge: !!window.layoutLabDesktop,
            native: document.querySelectorAll(".native-stage").length,
            live: document.querySelectorAll("canvas").length,
            busy: document.body.classList.contains("busy"),
            status: document.querySelector("#status")?.textContent,
            error: document.querySelector("#error")?.textContent,
          })),
        ),
      );
      throw error;
    });
  await waitFor(
    () =>
      desktop.app.evaluate(
        (_, count) =>
          [...lab.views.values()].filter(
            (v) => v.lastLayout && v.host.getVisible(),
          ).length === count,
        count,
      ),
    "native game placement",
  );
}
async function nativeInput(index, events) {
  const id = comparison.window(index).context.nativeId;
  await desktop.app.evaluate(
    (_, { id, events }) => {
      const item = lab.views.get(id),
        wc = item.view.webContents;
      lab.root.focus();
      wc.focus();
      for (const e of events)
        wc.sendInputEvent({
          ...e,
          ...(e.x === undefined
            ? {}
            : {
                x: Math.round(e.x * item.scale),
                y: Math.round(e.y * item.scale),
              }),
        });
    },
    { id, events },
  );
}
const click = (index, x, y) =>
  nativeInput(index, [
    { type: "mouseDown", x, y, button: "left", clickCount: 1 },
    { type: "mouseUp", x, y, button: "left", clickCount: 1 },
  ]);
try {
  assert.ok(desktop, "Native display required");
  desktop.root.on("pageerror", (e) => errors.push(e.message));
  desktop.root.on("websocket", (ws) => streams.push(ws.url()));
  const situation = await request("starter", {
    name: "Native acceptance planning",
  });
  let before;
  if (!process.argv.includes("--3d-only")) {
    await request("load", {
      situationId: situation.id,
      slots: PRESETS["Mobile migration"],
      restoreViews: false,
    });
    await ready(3);
    let views = await request("views");
    assert.deepEqual(
      views.map((v) => v.scriptActive),
      [false, false, true],
    );
    assert.equal(new Set(views.map((v) => v.gameId)).size, 3);
    assert.equal(new Set(views.map((v) => v.state.hash)).size, 1);
    await click(1, 117, 818);
    await waitFor(
      async () => (await request("views"))[1].presentation.pane === "hand",
      "native mobile Hand",
      15000,
    );
    await click(2, 117, 818);
    await waitFor(
      async () => (await request("views"))[2].presentation.pane === "hand",
      "native userscript Hand",
      15000,
    );
    views = await request("views");
    assert.equal(views[0].presentation.pane, "board");
    await desktop.root
      .locator(".slot")
      .first()
      .getByRole("button", { name: "Edit view", exact: true })
      .click();
    await waitFor(
      () =>
        desktop.app.evaluate(() =>
          [...lab.views.values()].every((v) => !v.host.getVisible()),
        ),
      "native views hidden behind modal",
    );
    await desktop.root
      .getByRole("button", { name: "Close view settings" })
      .click();
    await ready(3);
    await request("pane", { index: 1, pane: "board" });
    await ready(3);
    await nativeInput(1, [
      { type: "mouseWheel", x: 195, y: 440, deltaX: 0, deltaY: 240 },
    ]);
    await waitFor(
      async () => (await request("views"))[1].presentation.camera.k > 1.1,
      "native phone map zoom",
      15000,
    );
    await desktop.root
      .locator(".slot")
      .nth(1)
      .getByRole("button", { name: "Expand", exact: true })
      .click();
    await waitFor(
      () =>
        desktop.app.evaluate(() =>
          [...lab.views.values()].some((v) => v.lastLayout?.expanded),
        ),
      "expanded native view",
    );
    await nativeInput(1, [
      { type: "keyDown", keyCode: "Escape" },
      { type: "keyUp", keyCode: "Escape" },
    ]);
    await desktop.root.waitForFunction(
      () => !document.querySelector(".slot.expanded"),
    );
    await desktop.root.getByLabel("Scale view A").selectOption("actual");
    await waitFor(
      () =>
        desktop.app.evaluate(
          (_, id) => lab.views.get(id).scale === 1,
          comparison.window(0).context.nativeId,
        ),
      "100% native scale",
    );
    await desktop.root.getByLabel("Scale view A").selectOption("fit");
    await request("save", {
      index: 1,
      name: "Native acceptance saved phone views",
    });
    const capture = await request("capture", {}),
      report = await (
        await fetch(origin + capture.url.replace("index.html", "report.json"))
      ).json();
    assert.ok(
      report.captures.every((c) => c.width === 390 && c.height === 844),
    );
    assert.equal(report.captures.length, 3);
    await desktop.root.reload();
    await ready(3);
    assert.equal((await request("views"))[2].presentation.pane, "hand");
    assert.ok((await request("views"))[1].presentation.camera.k > 1.1);
    const nativeShot = await desktop.app.evaluate(async () => lab.screenshot());
    await fs.writeFile(
      path.join(DATA, "native-mobile-desk.png"),
      Buffer.from(nativeShot, "base64"),
    );
    assert.equal(await desktop.root.locator("iframe,canvas").count(), 0);
    assert.deepEqual(streams, []);
    assert.ok(
      (await request("status")).windows.every(
        (w) => !w.errors.length && !w.assets.length && !w.warnings.length,
      ),
    );
    evidence.checks.push(
      "three native phone views",
      "native mobile and userscript input",
      "storage and game isolation",
      "modal layering",
      "phone zoom",
      "expand and Escape",
      "100% scale",
      "saved views",
      "original-size capture",
      "reload",
      "no screenshot streams",
    );
    console.log(
      "PASS: three native phone views, userscript, direct input, modal layering, zoom, expand, save, capture and reload",
    );
    await request("load", {
      situationId: situation.id,
      slots: PRESETS["Layout regression"],
      restoreViews: false,
    });
    await ready(2);
    before = await request("views");
    await nativeInput(0, [
      { type: "mouseWheel", x: 600, y: 450, deltaX: 0, deltaY: 240 },
    ]);
    await waitFor(
      async () => (await request("views"))[0].presentation.camera.k > 1.1,
      "desktop 2D zoom",
      15000,
    );
    assert.deepEqual(
      (await request("views"))[1].presentation.camera,
      before[1].presentation.camera,
    );
    evidence.checks.push("two native desktop 2D views with independent input");
    console.log("PASS: two native desktop 2D views with independent input");
  }
  const slots = structuredClone(PRESETS["3D regression"]);
  slots[1].seat = "hero_hanu";
  await request("load", {
    situationId: situation.id,
    slots,
    restoreViews: false,
  });
  await ready(2);
  before = await request("views");
  await nativeInput(1, [
    { type: "mouseDown", x: 650, y: 450, button: "right", clickCount: 1 },
    { type: "mouseMove", x: 760, y: 410, modifiers: ["rightButtonDown"] },
    { type: "mouseUp", x: 760, y: 410, button: "right", clickCount: 1 },
  ]);
  await waitFor(
    async () =>
      JSON.stringify(
        (await request("views"))[1].presentation.camera.position,
      ) !== JSON.stringify(before[1].presentation.camera.position),
    "native 3D right-drag",
    15000,
  );
  let after = await request("views");
  assert.deepEqual(after[0].presentation.camera, before[0].presentation.camera);
  const target = after[1].presentation.camera.target;
  await nativeInput(1, [{ type: "keyDown", keyCode: "W" }]);
  try {
    await waitFor(
      async () =>
        JSON.stringify(
          (await request("views"))[1].presentation.camera.target,
        ) !== JSON.stringify(target),
      "native WASD",
      60000,
    );
  } finally {
    await nativeInput(1, [{ type: "keyUp", keyCode: "W" }]);
  }
  for (const w of comparison.windows)
    await w.page.evaluate(() => {
      window.nativeFrames = 0;
      const tick = () => {
        nativeFrames++;
        window.nativeFrameLoop = requestAnimationFrame(tick);
      };
      tick();
    });
  await delay(2000);
  evidence.gameFramesPerSecond = await Promise.all(
    comparison.windows.map((w) => w.page.evaluate(() => nativeFrames / 2)),
  );
  assert.ok(evidence.gameFramesPerSecond.every((v) => v > 0));
  const captured3d = await request("capture", {}),
    meta3d = await (
      await fetch(origin + captured3d.url.replace("index.html", "report.json"))
    ).json();
  assert.equal(meta3d.captures.length, 2);
  assert.ok(meta3d.captures.every((c) => c.width === 1440 && c.height === 900));
  evidence.checks.push(
    "two native desktop 3D viewpoints",
    "native 3D right-drag",
    "native WASD",
    "native animation",
    "desktop original-size capture",
  );
  console.log(
    "PASS: two native desktop 3D views, camera input, animation and original-size capture",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(streams, []);
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(
      DATA,
      process.argv.includes("--3d-only")
        ? "native-acceptance-3d.json"
        : "native-acceptance.json",
    ),
    JSON.stringify(evidence, null, 2),
  );
} finally {
  await desk.close();
}
