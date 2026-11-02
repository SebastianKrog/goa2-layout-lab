// Isolated real frontend verification; run with distinct GOA2_LAB_*_PORT values.
import assert from "node:assert/strict";
import { startDesk } from "../src/desk.mjs";
import { PORTS } from "../src/config.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--no-open", "--headless"]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
async function api(route, body) {
  const r = await fetch(
    origin + "/api/" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await r.json();
  assert.ok(r.ok, JSON.stringify(value));
  return value;
}
try {
  const catalog = await api("catalog");
  const mixed = catalog.layouts.find(
    (l) => l.name === "Desktop vs mobile · Working tree",
  );
  const opening = catalog.situations.find((s) => s.id === "e81bc3bd5fff");
  await api("load", {
    layoutId: mixed.id,
    situationId: opening.id,
    viewpoint: "hero_arien",
    presentation: { selectedCard: { role: "gold" } },
  });
  for (const w of app.comparison.windows) {
    assert.ok(await w.page.locator('[data-lab-selected="true"]').count());
    assert.equal(w.warnings.length, 0, JSON.stringify(w.warnings));
  }
  console.log(
    "PASS: generic Gold card resolves for desktop and mobile without submitting a choice",
  );
  const old = app.comparison.windows[1],
    game = old.clone.game_id;
  const hand = catalog.presentations.find((p) => p.name === "Open Hand");
  await api("presentation/apply", { index: 1, id: hand.id });
  assert.equal(app.comparison.windows[1], old);
  assert.equal(old.clone.game_id, game);
  assert.ok(await old.page.locator('[data-lab-selected="true"]').count());
  console.log(
    "PASS: Open Hand applies in place and preserves the selected card and game",
  );
  await api("load", {
    situationId: opening.id,
    presentation: { inspectedCard: "unavailable-card" },
  });
  assert.ok(app.comparison.windows.every((w) => w.warnings.length));
  console.log(
    "PASS: unavailable card yields warnings while Views remain usable",
  );
  const spells = catalog.situations.find(
    (s) => s.name === "Gydion: 3 public spells",
  );
  assert.ok(spells);
  await api("load", {
    situationId: spells.id,
    viewpoint: "hero_gydion",
    presentation: { publicSpells: true },
  });
  assert.equal(
    await app.comparison.windows[1].page
      .locator("[data-lab-mobile-spells]")
      .count(),
    1,
  );
  console.log(
    "PASS: View public spells resolves the caster without a saved hero or spell ID",
  );
} finally {
  await app.close();
}
