// Owns its desk/services. Configure distinct GOA2_LAB_*_PORT values before running.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startDesk } from "../src/desk.mjs";
import { DATA, PORTS, PRESETS } from "../src/config.mjs";
import { showPane } from "../src/presentation.mjs";
const app = await startDesk({ flags: new Set(["--headless", "--no-open"]) });
const origin = `http://127.0.0.1:${PORTS.desk}`;
const out = path.join(DATA, "reviews/autoswitch");
await fs.mkdir(out, { recursive: true });
async function api(name, body) {
  const response = await fetch(origin + "/api/" + name, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
try {
  await api("load", {
    situationId: "a00000000001",

    slots: [{ ...PRESETS["Play solo"][0], autoSwitch: true }],
  });
  const win = app.comparison.window(0),
    page = win.page;
  const gameId = win.clone.game_id;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  assert.equal(win.config.seat, "hero_arien");
  await showPane(page, "hand", win.config);
  await page.locator("[data-lab-card]:visible").first().tap();
  await page.getByRole("button", { name: /^Commit/ }).tap();
  for (
    let n = 0;
    n < 160 && (win.config.seat === "hero_arien" || (await api("status")).busy);
    n++
  )
    await new Promise((r) => setTimeout(r, 250));
  assert.notEqual(
    win.config.seat,
    "hero_arien",
    "Follow another decision maker after the commit",
  );
  assert.equal(win.clone.game_id, gameId);
  assert.equal(
    app.comparison.window(0).page,
    page,
    "Reuse the game page/context",
  );
  assert.equal(win.config.autoSwitch, true, JSON.stringify(win.warnings));
  assert.ok(
    (
      await app.comparison.api(`/games/${gameId}/responders`, undefined, "GET")
    ).players.includes(win.config.seat),
  );
  await app.comparison.ready(win);
  const committed = await page.evaluate(() =>
    Object.values(window.__GOA2_LAB_STATE__.view.teams)
      .flatMap((t) => t.heroes)
      .filter((h) => h.current_turn_card)
      .map((h) => h.id),
  );
  assert.deepEqual(
    committed,
    ["hero_arien"],
    "Switching did not play any additional cards",
  );
  await page.screenshot({ path: path.join(out, "after-action.png") });
  await api("configure", { index: 0, update: { autoSwitch: false } });
  const kept = win.config.seat;
  await showPane(page, "hand", win.config);
  await page.locator("[data-lab-card]:visible").first().tap();
  await page.getByRole("button", { name: /^Commit/ }).tap();
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal(
    win.config.seat,
    kept,
    "Turning off keeps this viewpoint after an action",
  );
  // Viewing a bot remains pure switching, with unchanged controllers/game state.
  const bots = { hero_hanu: "random", hero_brogan: "heuristic" };
  await api("load", {
    situationId: "a00000000002",

    slots: [{ ...PRESETS["Play solo"][0], bots }],
  });
  const timed = app.comparison.window(0);
  const before = (await api("views"))[0].state.hash;
  await app.comparison.switchSeat(0, "hero_hanu");
  assert.deepEqual(timed.config.bots, bots);
  assert.equal((await api("views"))[0].state.hash, before);
  assert.equal(timed.config.seat, "hero_hanu");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        switchesAfterAction: true,
        keepsGameAndPage: true,
        noAutomaticActions: true,
        offKeepsSeat: true,
        botAssignmentsUnchanged: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: pure viewpoint auto switch after an action, off keeps seat, bot assignments unchanged",
  );
} finally {
  await app.close();
}
