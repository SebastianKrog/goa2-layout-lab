// Owns its desk and ports; tests never use a human's running game.
import assert from "node:assert/strict";
import { startDesk } from "../src/desk.mjs";
import { PORTS } from "../src/config.mjs";
import { showPane } from "../src/presentation.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
async function api(route, body) {
  const response = await fetch(
    origin + "/api/" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
async function until(fn) {
  for (let n = 0; n < 240; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Timed out");
}
try {
  if (!process.argv.includes("--comparisons-only")) {
    const desk = await app.comparison.browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    desk.on("pageerror", (e) => errors.push(e.message));
    await desk.goto(origin);
    await desk.locator("#startScreen").waitFor();
    await desk.waitForFunction(
      () => document.querySelector("#connection").textContent !== "Connecting",
    );
    assert.equal(await desk.locator(".slot").count(), 0);
    await desk.screenshot({ path: ".layout-lab/quickstarts-home.png" });
    const before = (await api("catalog")).situations.length;
    await desk.locator('[data-quickstart="desktop"]').click();
    await until(() => app.comparison.windows.length === 1);
    await until(async () => !(await api("status")).busy);
    let win = app.comparison.window(0);
    assert.deepEqual(win.config.bots, {
      hero_brogan: "ismcts",
      hero_tigerclaw: "ismcts",
    });
    assert.equal(win.config.seat, "hero_arien");
    await showPane(win.page, "hand", win.config);
    await win.page.locator("[data-lab-card]:visible").first().click();
    await win.page.getByRole("button", { name: /^Commit/ }).click();
    await until(() => app.comparison.window(0).config.seat === "hero_hanu");
    console.log(
      "PASS desktop quickstart: ISMCTS BLUE bots, human RED autoswitch",
    );
    await api("quickstart", { id: "portrait" });
    win = app.comparison.window(0);
    assert.equal(win.config.uiMode, "mobile");
    assert.equal(win.config.profile, "portrait");
    assert.equal(win.warnings.length, 0, JSON.stringify(win.warnings));
    console.log("PASS mobile portrait quickstart");
    await api("clear", {});
    const { device } = await api("quickstart", { id: "device" });
    assert.equal((await api("status")).windows.length, 0);
    assert.ok(device.qr.startsWith("data:image/png;base64,"));
    const session = [...app.devices.sessions.values()][0];
    const context = await app.comparison.browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const phone = await context.newPage();
    const phoneErrors = [];
    phone.on("pageerror", (e) => phoneErrors.push(e.message));
    const local = new URL(device.urls[0]);
    local.hostname = "127.0.0.1";
    await phone.goto(local.href);
    await phone
      .locator("#goa2-device-report")
      .waitFor({ state: "attached", timeout: 90000 });
    await until(() => phone.evaluate(() => !!window.__GOA2_LAB_STATE__?.view));
    await showPane(phone, "hand", session.config);
    const game = session.clone.game_id;
    await phone.locator("[data-lab-card]:visible").first().tap();
    await phone.getByRole("button", { name: /^Commit/ }).tap();
    await until(() => session.config.seat === "hero_hanu");
    await until(() => phone.url().includes(session.clone.seats.hero_hanu));
    await until(() => phone.evaluate(() => !!window.__GOA2_LAB_STATE__?.view));
    assert.equal(session.clone.game_id, game);
    assert.deepEqual(phoneErrors, []);
    await context.close();
    assert.equal((await api("catalog")).situations.length, before);
    console.log(
      "PASS device QR + same-game human-team autoswitch; no Situation drafts",
    );
    await api("device-stop", { id: device.id });
    assert.deepEqual(errors, []);
  }
  const catalog = await api("catalog");
  for (const [name, profile] of [
    ["Desktop", "desktop"],
    ["Mobile portrait", "portrait"],
    ["Mobile landscape", "landscape"],
  ]) {
    const layout = catalog.layouts.find(
      (l) => l.name === name + " · Main vs working tree",
    );
    await api("load", { layoutId: layout.id, situationId: "a00000000001" });
    const windows = app.comparison.windows;
    assert.deepEqual(
      windows.map((w) => w.config.source),
      ["main", "live"],
    );
    assert.ok(windows.every((w) => w.config.profile === profile));
    if (profile !== "desktop") {
      assert.equal(
        new URL(windows[1].page.url()).searchParams.get("ui"),
        "mobile",
      );
      if (windows[0].config.uiMode === "desktop") {
        assert.ok(
          windows[0].warnings.some((w) =>
            w.includes("Main has no native mobile shell"),
          ),
        );
        assert.equal(
          new URL(windows[0].page.url()).searchParams.get("ui"),
          "desktop",
        );
      } else
        assert.equal(
          new URL(windows[0].page.url()).searchParams.get("ui"),
          "mobile",
        );
    }
    console.log("PASS comparison: " + name + " Main vs working tree");
  }
} finally {
  await app.close();
}
