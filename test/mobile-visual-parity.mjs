import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
for (const [k, v] of Object.entries({
  DESK: 3900,
  BASE: 3901,
  COMPARATOR: 3902,
  LIVE: 3903,
  BACKEND: 8900,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(v);
const { DATA } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { showPane } = await import("../presentation.mjs");
const { captureReport } = await import("../report.mjs");
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
const c = desk.comparison;
const out = path.join(
  DATA,
  "reviews",
  `parity-${process.env.GOA2_PARITY_TAG || "review"}-${Date.now()}`,
);
await fs.mkdir(out, { recursive: true });
const records = [];
async function record(name) {
  const before = await Promise.all(
    c.windows.map((w) => c.api(`/games/${w.clone.game_id}`, undefined, "GET")),
  );
  assert.equal(before[0].hash, before[1].hash);
  const report = await captureReport(c, [0, 1]);
  await c.windows[0].page
    .locator('[data-card-paint-state="ready"] canvas')
    .evaluateAll((canvases) => {
      for (const canvas of canvases) {
        const box = canvas.getBoundingClientRect();
        if (
          box.bottom <= 0 ||
          box.top >= innerHeight ||
          box.right <= 0 ||
          box.left >= innerWidth
        )
          continue;
        if (
          !canvas
            .getContext("2d")
            .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3]
        )
          throw Error("Ready card canvas has no pixels");
      }
    });
  records.push({ name, ...report });
  await fs.writeFile(
    path.join(out, "reports.json"),
    JSON.stringify(
      { workingTree: true, reference: c.status(), records },
      null,
      2,
    ),
  );
  console.log("CAPTURE:", name, report.id);
  for (const w of c.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
  }
}
try {
  const library = await c.api("/situations", undefined, "GET");
  for (const [name, seat] of [
    ["Arien - select a card before committing", "hero_arien"],
    ["M3 presentation - gydion-public-spells-3", "hero_gydion"],
  ]) {
    const situation = library.find(
      (s) => s.name === name && s.origin === "library",
    );
    assert.ok(situation);
    await c.load(
      situation.id,
      [
        { source: "live", layout: "mobile" },
        { source: "target", layout: "desktop" },
      ].map((s) => ({ ...s, render: "2d", profile: "portrait", seat })),
      {},
      situation,
    );
    const [native, target] = c.windows;
    for (const w of c.windows) await showPane(w.page, "deck", w.config);
    await target.page.locator(".m2-deck-tree").waitFor();
    for (const [profile, size] of [
      ["portrait", { width: 390, height: 844 }],
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
    ]) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      for (const layout of ["tree", "list", "grid"]) {
        await native.page.locator(`[data-deck-layout="${layout}"]`).tap();
        await target.page
          .locator(".m2-deck-controls")
          .getByRole("button", {
            name: layout[0].toUpperCase() + layout.slice(1),
            exact: true,
          })
          .tap();
        const switchNative = native.page.getByRole("switch", {
          name: "Sort by color instead of tier",
        });
        const switchTarget = target.page
          .locator(".m2-deck-controls")
          .getByRole("switch");
        if ((await switchNative.getAttribute("aria-checked")) === "true")
          await switchNative.tap();
        if ((await switchTarget.getAttribute("aria-checked")) === "true")
          await switchTarget.tap();
        // Each mode starts at the same catalog top, without altering game state.
        await native.page
          .locator("[data-deck-scroll]")
          .evaluate((e) => (e.scrollTop = 0));
        await target.page
          .locator(".m2-deck-row-list")
          .evaluate((e) => (e.scrollTop = 0));
        const nb = await native.page
          .locator('[aria-label$="deck browser"]')
          .boundingBox();
        const tb = await target.page.locator(".m2-deck-browser").boundingBox();
        assert.ok(
          Math.abs(nb.y - tb.y) < 12,
          `${profile}: list top ${nb.y} vs ${tb.y}`,
        );
        assert.ok(
          Math.abs(nb.width - tb.width) < 18,
          `${profile}: list width ${nb.width} vs ${tb.width}`,
        );
        if (layout === "tree") {
          const nativeMicro = native.page
            .locator("[data-micro] > button")
            .first();
          const targetMicro = target.page.locator(".m2-tree-card").first();
          assert.equal(
            (await nativeMicro.boundingBox()).height,
            (await targetMicro.boundingBox()).height,
          );
        }
        await record(`${seat}-${profile}-${layout}`);
      }
      await native.page.locator('[data-deck-layout="list"]').tap();
      await target.page
        .locator(".m2-deck-controls")
        .getByRole("button", { name: "List", exact: true })
        .tap();
      const viewName = seat === "hero_arien" ? "Noble Blade" : "Cantrip";
      await native.page
        .getByRole("button", { name: `View ${viewName}`, exact: true })
        .tap();
      await target.page
        .locator(".m2-deck-row-list")
        .getByRole("button", { name: `View ${viewName}`, exact: true })
        .tap();
      await native.page
        .getByLabel("Deck card preview", { exact: true })
        .waitFor();
      await record(`${seat}-${profile}-large-preview`);
      await native.page
        .getByRole("button", { name: "Close preview", exact: true })
        .tap();
      await target.page
        .locator(".m2-deck-preview")
        .getByRole("button", { name: "Close card details", exact: true })
        .tap();
    }
    if (seat === "hero_gydion") {
      for (const w of c.windows)
        await w.page.setViewportSize({ width: 390, height: 844 });
      for (const mode of ["large", "image"]) {
        await showPane(native.page, "settings", native.config);
        await native.page
          .getByRole("combobox", { name: "Inspection style", exact: true })
          .selectOption(mode);
        await target.page
          .getByRole("button", { name: "Settings", exact: true })
          .tap();
        await target.page
          .locator('[data-setting="spell-view"]')
          .selectOption(mode);
        for (const w of c.windows) await showPane(w.page, "deck", w.config);
        await native.page.locator('[data-deck-layout="list"]').tap();
        await target.page
          .locator(".m2-deck-controls")
          .getByRole("button", { name: "List", exact: true })
          .tap();
        await native.page
          .getByRole("button", { name: "View Magic Missile", exact: true })
          .tap();
        await target.page
          .getByRole("button", { name: /^View Magic Missile/ })
          .first()
          .tap();
        if (mode === "image") {
          await native.page
            .getByRole("img", { name: "Magic Missile card image", exact: true })
            .waitFor();
          await target.page
            .locator(".m2-deck-preview .m2-spell-face img")
            .waitFor();
        }
        await record(`hero_gydion-portrait-spell-${mode}`);
        for (const w of c.windows)
          await w.page.setViewportSize({ width: 844, height: 390 });
        await record(`hero_gydion-landscape-spell-${mode}`);
        await native.page
          .getByRole("button", { name: "Close preview", exact: true })
          .tap();
        await target.page
          .locator(".m2-deck-preview")
          .getByRole("button", { name: "Close card details", exact: true })
          .tap();
        for (const w of c.windows)
          await w.page.setViewportSize({ width: 390, height: 844 });
      }
    }
  }
  console.log("PARITY OUTPUT:", out);
} catch (error) {
  for (const [i, w] of c.windows.entries()) {
    console.error("ERROR", i, w.errors, w.assets);
    await w.page
      .screenshot({ path: out + "/failure-" + i + ".png" })
      .catch(() => {});
  }
  throw error;
} finally {
  await desk.close();
}
