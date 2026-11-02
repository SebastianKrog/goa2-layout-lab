// Owned desk only. Use the normal game backend and a separate bot checkout/port.
import assert from "node:assert/strict";
import { startDesk } from "../src/desk.mjs";
import { PORTS, BACKEND, BOT_BACKEND } from "../src/config.mjs";
import { showPane } from "../src/presentation.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
async function api(name, body) {
  const r = await fetch(
    origin + "/api/" + name,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const v = await r.json();
  assert.ok(r.ok, JSON.stringify(v));
  return v;
}
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Timed out waiting for detached bots");
}
const decisions = [];
const botRequest = app.services.botRequest.bind(app.services);
app.services.botRequest = async (route, body) => {
  const result = await botRequest(route, body);
  if (route === "/decision") decisions.push(result.decision);
  return result;
};
const snapshot = async (w) => {
  const wire = await app.comparison.api(
    `/games/${w.clone.game_id}/bot-state`,
    undefined,
    "GET",
  );
  return { ...wire, checkpoint: JSON.parse(wire.checkpoint_json) };
};
try {
  assert.notEqual(BACKEND, BOT_BACKEND);
  assert.deepEqual(
    (await app.comparison.api("/health", undefined, "GET")).bot_kinds,
    [],
  );
  const bots = { hero_brogan: "heuristic", hero_tigerclaw: "random" };
  const slot = {
    source: "live",
    profile: "portrait",
    uiMode: "mobile",
    render: "2d",
    seat: "hero_arien",
  };
  await api("load", {
    situationId: "a00000000001",
    slots: [
      { ...slot, bots },
      { ...slot, seat: "hero_hanu" },
    ],
  });
  assert.equal(app.comparison.sync.mode, "api");
  const [a, b] = app.comparison.windows;
  await until(async () => {
    const s = await snapshot(a);
    return Object.keys(bots).every((h) => s.checkpoint.state.pending_inputs[h]);
  });
  const states = await Promise.all([snapshot(a), snapshot(b)]);
  assert.equal(states[0].hash, states[1].hash);
  assert.ok(
    states.every(
      (s) =>
        !s.checkpoint.state.pending_inputs.hero_arien &&
        !s.checkpoint.state.pending_inputs.hero_hanu,
    ),
  );
  assert.equal(
    decisions.filter((d) => d?.message.type === "COMMIT_CARD").length,
    2,
  );
  assert.equal(
    [...app.services.children.keys()].filter((k) => k === "bots").length,
    1,
  );
  console.log(
    "PASS normal game backend + one separate bot service; two decisions shared by two Views",
  );
  await showPane(b.page, "hand", b.config);
  await b.page.locator("[data-lab-card]:visible").first().tap();
  await b.page.getByRole("button", { name: /^Commit/ }).tap();
  await until(
    async () => !!(await snapshot(a)).checkpoint.state.pending_inputs.hero_hanu,
  );
  assert.equal((await snapshot(a)).hash, (await snapshot(b)).hash);
  console.log("PASS human action from View B is synchronized by default");
  const device = await api("device-open", {
    situationId: "a00000000001",
    slot,
  });
  const session = [...app.devices.sessions.values()][0];
  assert.equal((await snapshot(session)).hash, (await snapshot(a)).hash);
  assert.deepEqual(session.bots, bots);
  const context = await app.comparison.browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await context.newPage();
  const errors = [];
  phone.on("pageerror", (e) => errors.push(e.message));
  const url = new URL(device.urls[0]);
  url.hostname = "127.0.0.1";
  await phone.goto(url.href, { waitUntil: "domcontentloaded" });
  await phone
    .locator("#goa2-device-report")
    .waitFor({ state: "attached", timeout: 90000 });
  assert.equal(
    await phone.evaluate(() => window.__GOA2_LAB_SYNC__.mode),
    "api",
  );
  app.botRunner.busy = () => true;
  await showPane(phone, "hand", session.config);
  await phone.locator("[data-lab-card]:visible").first().tap();
  await phone.getByRole("button", { name: /^Commit/ }).tap();
  await until(async () => {
    const s = await snapshot(a);
    return (
      !!s.checkpoint.state.pending_inputs.hero_arien ||
      s.checkpoint.state.phase !== "PLANNING"
    );
  });
  const linked = await Promise.all([
    snapshot(a),
    snapshot(b),
    snapshot(session),
  ]);
  assert.equal(new Set(linked.map((s) => s.hash)).size, 1);
  assert.deepEqual(errors, []);
  assert.equal(app.comparison.sync.error, null);
  console.log(
    "PASS device joins current progress and its human action reaches all three Views",
  );
  await context.close();
} finally {
  await app.close();
}
