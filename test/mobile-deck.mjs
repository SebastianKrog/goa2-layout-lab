// Focused M4 UI acceptance against real saved games; owns only this diagnostic desk.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
for (const [name, port] of Object.entries({
  DESK: 3800,
  BASE: 3801,
  COMPARATOR: 3802,
  LIVE: 3803,
  BACKEND: 8800,
}))
  process.env[`GOA2_LAB_${name}_PORT`] ??= String(port);
const { DATA } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { showPane } = await import("../presentation.mjs");
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
const comparison = desk.comparison;
const output = path.join(DATA, "reviews", `m4-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const checks = [];
async function pass(name) {
  checks.push(name);
  await fs.writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(
      { workingTree: true, platform: process.platform, checks },
      null,
      2,
    ),
  );
  console.log("PASS:", name);
}
const inspect = (win) =>
  comparison.api(`/games/${win.clone.game_id}`, undefined, "GET");
try {
  const library = await comparison.api("/situations", undefined, "GET");
  for (const fixture of [
    "Arien - select a card before committing",
    "M3 presentation - gydion-public-spells-3",
  ]) {
    const situation = library.find(
      (s) => s.name === fixture && s.origin === "library",
    );
    assert.ok(situation, fixture);
    const owner = fixture.startsWith("Arien") ? "hero_arien" : "hero_gydion";
    await comparison.load(
      situation.id,
      [owner, "spectator"].map((seat) => ({
        source: "live",
        profile: "portrait",
        render: "2d",
        layout: "mobile",
        seat,
      })),
      {},
      situation,
    );
    const win = comparison.windows[0],
      page = win.page;
    await showPane(page, "deck", win.config);
    const browser = page.getByLabel(/deck browser$/);
    await browser.waitFor();
    const before = (await inspect(win)).hash;
    const serialized = await page.evaluate(() =>
      JSON.stringify(window.__GOA2_LAB_STATE__.view),
    );
    const offered = browser
      .locator('[data-tier="2"] [data-deck-card][data-state="Available"]')
      .first();
    const plannedId = await offered.getAttribute("data-deck-card");
    assert.ok(plannedId);
    await offered.getByRole("button").tap();
    await page
      .getByRole("button", { name: "Close preview", exact: true })
      .tap();
    assert.equal(
      await browser
        .locator(`[data-deck-card="${plannedId}"]`)
        .getAttribute("data-state"),
      "Planned",
    );
    for (const [layout, size] of [
      ["tree", { width: 390, height: 844 }],
      ["list", { width: 360, height: 800 }],
      ["grid", { width: 844, height: 390 }],
    ]) {
      await page.setViewportSize(size);
      await browser.locator(`[data-deck-layout="${layout}"]`).tap();
      const sort = browser.getByRole("switch", {
        name: "Sort by color instead of tier",
      });
      if ((await sort.getAttribute("aria-checked")) !== "true")
        await sort.tap();
      assert.equal(
        await browser
          .locator(`[data-deck-card="${plannedId}"]`)
          .getAttribute("data-state"),
        "Planned",
      );
      if (layout === "grid") {
        await page.waitForFunction(() =>
          [...document.querySelectorAll("[data-card-paint-state]")].every(
            (element) =>
              element.getAttribute("data-card-paint-state") !== "loading",
          ),
        );
        assert.ok(
          await browser
            .locator('[data-card-paint-state="ready"] canvas')
            .count(),
        );
        assert.ok(
          await browser
            .locator('[data-card-paint-state="ready"] canvas')
            .first()
            .evaluate(
              (canvas) =>
                canvas
                  .getContext("2d")
                  .getImageData(canvas.width / 2, canvas.height / 2, 1, 1)
                  .data[3] > 0,
            ),
        );
      }
      if (owner === "hero_gydion") {
        const cast = browser.getByRole("region", {
          name: "Cast spells",
          exact: true,
        });
        const book = browser.getByRole("region", {
          name: "Spellbook",
          exact: true,
        });
        assert.equal(await cast.getByRole("heading", { level: 3 }).count(), 0);
        assert.ok(await book.getByRole("heading", { level: 3 }).count());
        const spell = book.getByRole("button", { name: /^View / }).first();
        await spell.scrollIntoViewIfNeeded();
        await spell.tap();
        await page.getByLabel("Deck card preview", { exact: true }).waitFor();
        assert.equal(await spell.getAttribute("aria-pressed"), "true");
        await page
          .getByRole("button", { name: "Close preview", exact: true })
          .tap();
      }
      const view = browser.getByRole("button", { name: /^View / }).first();
      await view.scrollIntoViewIfNeeded();
      await view.tap();
      await page.getByLabel("Deck card preview", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Close preview", exact: true })
        .tap();
      const bounds = await browser.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= size.width + 1);
      await page.screenshot({
        path: path.join(output, `${owner}-${layout}.png`),
      });
    }
    assert.equal((await inspect(win)).hash, before);
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.__GOA2_LAB_STATE__.view)),
      serialized,
    );
    await page.reload();
    await showPane(page, "deck", win.config);
    assert.equal(
      await page
        .locator(`[data-deck-card="${plannedId}"]`)
        .getAttribute("data-state"),
      "Planned",
    );
    assert.equal(
      await page
        .locator('[data-deck-layout="grid"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await pass(
      `${owner}: Tree/List/Grid, mobile portrait and landscape, local planning and reload persistence, immutable authoritative state`,
    );
    const spectator = comparison.windows[1];
    await showPane(spectator.page, "deck", spectator.config);
    assert.equal(await spectator.page.getByLabel(/deck browser$/).count(), 0);
    if (owner === "hero_gydion") {
      await showPane(spectator.page, "heroes", spectator.config);
      await spectator.page
        .getByRole("button", { name: "Spells cast: 3", exact: true })
        .tap();
      await spectator.page
        .getByRole("dialog", { name: /cast spells$/ })
        .getByRole("button", { name: /^View / })
        .first()
        .waitFor();
      assert.equal(
        await spectator.page
          .getByRole("dialog", { name: /cast spells$/ })
          .getByRole("button", { name: /^View / })
          .count(),
        3,
      );
    }
    await pass(
      `${owner}: spectator cannot access private deck or planning; public cast browser stays available`,
    );
    for (const w of comparison.windows) {
      assert.deepEqual(w.errors, []);
      assert.deepEqual(w.assets, []);
    }
  }
  await pass("no browser rendering or asset errors");
  console.log("M4 evidence:", output);
} finally {
  await desk.close();
}
