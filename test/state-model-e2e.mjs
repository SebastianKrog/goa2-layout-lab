// Owns its desk and services. Set distinct GOA2_LAB_*_PORT values.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startDesk } from "../desk.mjs";
import { DATA, PORTS } from "../config.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
const out = path.join(DATA, "reviews", "state-model");
await fs.mkdir(out, { recursive: true });
const created = [];
async function api(route, body) {
  const response = await fetch(origin + "/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
const mobile = {
  source: "live",
  profile: "portrait",
  render: "2d",
  uiMode: "mobile",
  seat: "spectator",
};
const tag = "QA state model " + Date.now();
async function compose(
  id,
  name,
  sessionState,
  userState = { "goa2:board-brightness": "0.4" },
) {
  const s = await api("situation/compose", {
    decisionStateId: id,
    name: tag + " " + name,
    presentation: {
      schema: 2,
      viewpoint: "hero_arien",
      sessionState,
      userState,
    },
  });
  created.push(s.id);
  return s;
}
try {
  const catalog = await api("catalog");
  const original = catalog.situations.find((s) => s.id === "a00000000001");
  assert.ok(original?.decisionStateId);
  const hand = await compose(original.decisionStateId, "Hand", {
    pane: "hand",
    render: "2d",
  });
  const heroes = await compose(original.decisionStateId, "Heroes", {
    pane: "heroes",
    render: "2d",
  });
  assert.equal(hand.decisionStateId, heroes.decisionStateId);
  assert.notEqual(hand.id, heroes.id);
  const savedLayout = (
    await api("layout/save", {
      name: tag,
      slots: [mobile],
      synchronization: "none",
    })
  ).layout;
  assert.equal(savedLayout.views[0].uiMode, "mobile");
  assert.equal(savedLayout.views[0].seat, undefined);
  await api("load", { situationId: hand.id, layoutId: savedLayout.id });
  let view = app.comparison.window(0);
  const initialGame = view.clone.game_id;
  assert.equal(view.config.seat, "hero_arien");
  assert.equal(
    await view.page.locator("[data-pane=hand][aria-pressed=true]").count(),
    1,
  );
  assert.equal(
    await view.page.evaluate(() =>
      localStorage.getItem("goa2:board-brightness"),
    ),
    "0.4",
  );
  const initialHash = (await api("views"))[0].state.hash;
  const template = await api("presentation/save", {
    index: 0,
    name: tag + " template",
  });
  assert.equal(template.state.schema, 2);
  const checkpoint = await api("save", {
    index: 0,
    name: tag + " Decision State",
    kind: "decision-state",
  });
  assert.equal(checkpoint.kind, "decision-state");
  const copy = await api("situation/compose", {
    decisionStateId: checkpoint.id,
    name: tag + " copied template",
    presentation: template.state,
  });
  created.push(copy.id);
  assert.deepEqual(copy.presentation, template.state);
  await api("configure", {
    index: 0,
    update: { overrides: { viewpoint: "spectator" } },
  });
  assert.equal(app.comparison.window(0).config.seat, "spectator");
  assert.equal(app.comparison.window(0).clone.game_id, initialGame);
  await api("configure", { index: 0, update: { overrides: {} } });
  assert.equal(app.comparison.window(0).config.seat, "hero_arien");
  assert.equal((await api("views"))[0].state.hash, initialHash);
  await api("presentation/apply", { index: 0, id: template.id });
  assert.equal((await api("views"))[0].state.hash, initialHash);
  console.log(
    "PASS: shared Decision State, template copy, User State, Follow/pinned Viewpoint and preserved game hash",
  );
  const three = await compose(
    original.decisionStateId,
    "3D inspection",
    { render: "3d", pane: "board", inspection3d: { heroId: "hero_arien" } },
    { "goa2:board-brightness": "0.6" },
  );
  await api("views/add", {
    config: { ...mobile, profile: "desktop", render: "3d", uiMode: "desktop" },
    situationId: three.id,
  });
  const threeView = app.comparison.window(1);
  assert.equal((await api("views"))[1].state.hash, initialHash);
  assert.equal(
    await threeView.page.evaluate(
      () => window.__GOA2_LAB_BRIDGE__?.inspection3d?.get().heroId,
    ),
    "hero_arien",
  );
  assert.equal(
    await threeView.page.evaluate(() =>
      localStorage.getItem("goa2:board-brightness"),
    ),
    "0.6",
  );
  await threeView.page.screenshot({ path: path.join(out, "3d.png") });
  const device = await api("device-open", {
    situationId: hand.id,
    slot: mobile,
  });
  const context = await app.comparison.browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => (window.__personalStorage = localStorage));
  const phone = await context.newPage();
  const deviceOrigin = new URL(device.urls[0]).origin;
  await phone.goto(deviceOrigin);
  await phone.evaluate(() =>
    localStorage.setItem("goa2:board-brightness", "0.9"),
  );
  await phone.goto(device.urls[0]);
  await phone
    .locator("#goa2-device-report")
    .getByRole("button", { name: "Report testing issue", exact: true })
    .waitFor({ timeout: 120000 });
  await phone
    .locator("[data-pane=hand][aria-pressed=true]")
    .waitFor({ timeout: 120000 });
  assert.equal(
    await phone.evaluate(() => localStorage.getItem("goa2:board-brightness")),
    "0.4",
  );
  assert.equal(
    await phone.evaluate(() =>
      window.__personalStorage.getItem("goa2:board-brightness"),
    ),
    "0.9",
  );
  await phone.screenshot({ path: path.join(out, "phone.png") });
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        situations: created,
        decisionStateId: original.decisionStateId,
        hash: initialHash,
        threeDimensionalInspection: true,
        phoneScopedPreference: true,
        originalPreference: "0.9",
        situationPreference: "0.4",
      },
      null,
      2,
    ),
  );
  console.log("State model acceptance passed:", out);
} finally {
  const first = app.close(),
    second = app.close();
  assert.equal(
    first,
    second,
    "Concurrent callers must await the same shutdown",
  );
  await first;
}
