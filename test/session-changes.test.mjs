import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  sessionChange,
  resolveCardTarget,
  publicSpellHero,
} from "../src/session-changes.mjs";
import { Comparison } from "../src/browser.mjs";
const gold = { id: "different_gold_name", color: "GOLD", tier: "UNTIERED" };
const upgrade = {
  id: "hero_specific_upgrade",
  color: "RED",
  tier: "II",
  image_id: "RedIIA",
};
const view = {
  phase: "PLANNING",
  teams: {
    RED: {
      heroes: [
        {
          id: "hero_one",
          hand: [gold],
          deck: [
            upgrade,
            { id: "another", tier: "II", color: "BLUE", image_id: "BlueIIA" },
          ],
        },
        { id: "caster", spellbook: { count: 3 }, cast_spells: [] },
      ],
    },
  },
};
test("Presentations retain only explicit session changes; reusable card targets are roles", () => {
  const p = sessionChange({
    schema: 2,
    viewpoint: "hero_one",
    userState: { "goa2.locale": "en" },
    sessionState: { pane: "hand", gamePath: "/old/game", render: "2d" },
  });
  assert.deepEqual(p.sessionState, { pane: "hand" });
  assert.equal(p.viewpoint, undefined);
  assert.equal(p.userState, undefined);
  assert.ok(p.warnings.length);
  assert.throws(
    () => sessionChange({ selectedCard: "specific" }, { reusable: true }),
    /Review entries/,
  );
  assert.equal(
    sessionChange({ selectedCard: "specific" }).sessionState.selectedCard,
    "specific",
  );
});
test("generic card roles resolve against visible player-scoped data and report unavailable or ambiguous targets", () => {
  assert.equal(resolveCardTarget({ role: "gold" }, view, "hero_one"), gold.id);
  assert.equal(
    resolveCardTarget(
      { role: "upgrade", tier: 2, branch: "A", color: "RED" },
      view,
      "hero_one",
    ),
    upgrade.id,
  );
  assert.equal(
    resolveCardTarget(
      { role: "upgrade", tier: 2, branch: "A" },
      view,
      "hero_one",
      [upgrade.id],
    ),
    upgrade.id,
  );
  assert.throws(
    () =>
      resolveCardTarget(
        { role: "upgrade", tier: 2, branch: "A" },
        view,
        "hero_one",
      ),
    /ambiguous/,
  );
  assert.throws(
    () => resolveCardTarget({ role: "gold" }, view, "missing", []),
    /No available/,
  );
  assert.equal(publicSpellHero(view, "hero_one"), "caster");
  assert.throws(
    () => publicSpellHero({ teams: {} }, "hero_one"),
    /No spellcaster/,
  );
});
test("applying a session change preserves the running View, unrelated menu/preferences, and never submits a game choice", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("http://changes.test/", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<button data-pane="hand" aria-pressed="true">Hand</button><div data-lab-card="different_gold_name"></div><script>window.commands=0;window.__GOA2_LAB_STATE__=${JSON.stringify({ view })};localStorage.setItem('preference','keep');</script>`,
    }),
  );
  await page.goto("http://changes.test/");
  const c = new Comparison({}, () => {
    throw Error("No backend mutation should happen");
  });
  const win = {
    page,
    clone: { game_id: "same", seats: { hero_one: "token" } },
    config: {
      source: "live",
      seat: "hero_one",
      uiMode: "desktop",
      render: "2d",
    },
    warnings: [],
    context: {
      close: () => {
        throw Error("Must not recreate the context");
      },
    },
  };
  c.windows = [win];
  c.services = { status: () => [] };
  c.sync = { status: () => ({}) };
  await c.applyPresentation(0, { inspectedCard: "different_gold_name" });
  assert.equal(c.windows[0], win);
  assert.equal(win.clone.game_id, "same");
  assert.equal(
    await page.locator("[data-pane]").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("preference")),
    "keep",
  );
  await c.applyPresentation(0, { pane: "not-supported" });
  assert.ok(win.warnings.some((w) => w.includes("Unknown pane")));
  assert.equal(await page.evaluate(() => window.commands), 0);
  await c.applyPresentation(0, { publicSpells: true });
  assert.ok(win.warnings.length);
  assert.equal(c.windows[0], win);
});
