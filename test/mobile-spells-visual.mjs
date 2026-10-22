import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
for (const [k, v] of Object.entries({
  DESK: 4700,
  BASE: 4701,
  COMPARATOR: 4702,
  LIVE: 4703,
  BACKEND: 9700,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(v);
const { DATA, BACKEND, TOOL } = await import("../src/config.mjs");
const { startDesk } = await import("../src/desk.mjs");
const { showPane } = await import("../src/presentation.mjs");
const { captureReport } = await import("../src/report.mjs");
const rank4 = process.argv.includes("--rank4");
if (rank4)
  execFileSync(
    process.env.GOA2_LAB_PYTHON ||
      path.join(
        BACKEND,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      ),
    [
      path.join(TOOL, "scripts/create-mobile-presentation-situations.py"),
      "--backend",
      BACKEND,
    ],
    { stdio: "ignore", windowsHide: true },
  );
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
const c = desk.comparison;
const records = [];
const output = path.join(
  DATA,
  "reviews",
  `public-spells-${rank4 ? "rank4" : "parity"}-${Date.now()}`,
);
await fs.mkdir(output, { recursive: true });
try {
  const s = rank4
    ? await c.api("/import", {
        content: JSON.parse(
          await fs.readFile(
            path.join(
              DATA,
              "situation-recipes/mobile-presentation/gydion-public-rank-4.json",
            ),
            "utf8",
          ),
        ),
      })
    : (await c.api("/situations", undefined, "GET")).find(
        (s) =>
          s.origin === "library" &&
          s.name === "M3 presentation - gydion-public-spells-9",
      );
  assert.ok(s);
  await c.load(
    s.id,
    [
      { source: "live", uiMode: "mobile" },
      { source: "target", uiMode: "desktop" },
    ].map((w) => ({
      ...w,
      seat: rank4 ? "spectator" : "hero_gydion",
      render: "2d",
      profile: "portrait",
    })),
    {},
    s,
  );
  const [native, target] = c.windows;
  const spell = await native.page.evaluate(
    () =>
      window.__GOA2_LAB_STATE__.view.teams.RED.heroes.find(
        (h) => h.id === "hero_gydion",
      ).cast_spells[0],
  );
  for (const mode of ["large", "image"]) {
    for (const w of c.windows)
      await w.page.setViewportSize({ width: 390, height: 844 });
    await showPane(native.page, "settings", native.config);
    await native.page
      .getByLabel("Inspection style", { exact: true })
      .selectOption(mode);
    await showPane(target.page, "settings", target.config);
    await target.page.locator('[data-setting="spell-view"]').selectOption(mode);
    for (const w of c.windows) {
      await showPane(w.page, "heroes", w.config);
      await w.page
        .getByRole("button", {
          name: `Spells cast: ${rank4 ? 1 : 9}`,
          exact: true,
        })
        .first()
        .tap();
    }
    if (mode === "large") {
      await native.page
        .getByRole("dialog", { name: "Gydion cast spells" })
        .waitFor();
      records.push({
        mode,
        profile: "portrait",
        state: "list",
        ...(await captureReport(c, [0, 1])),
      });
    }
    if (rank4) {
      const data = await native.page.evaluate(
        () => window.__GOA2_LAB_STATE__.view,
      );
      const hero = data.teams.RED.heroes.find((h) => h.id === "hero_gydion");
      assert.equal(
        Array.isArray(hero.spellbook),
        false,
        "Spectator must not receive prepared spell cards",
      );
      assert.equal(spell.spell_rank, 4);
      const tiny = native.page.getByRole("button", {
        name: "View Wish",
        exact: true,
      });
      assert.equal(await tiny.locator('[aria-label^="Initiative"]').count(), 0);
      const accents = await tiny
        .locator('[class*="faceBand"]')
        .evaluate((el) => [
          getComputedStyle(el, "::before").width,
          getComputedStyle(el, "::after").width,
        ]);
      assert.deepEqual(
        await tiny
          .locator('[class*="faceBand"]')
          .evaluate((el) => [
            getComputedStyle(el, "::before").backgroundImage,
            getComputedStyle(el, "::after").backgroundImage,
          ]),
        ["none", "none"],
        "Rank IV ends are solid, not repeating tier stripes",
      );
      assert.deepEqual(
        accents,
        ["6px", "6px"],
        "Rank IV uses solid end accents",
      );
    }
    await native.page
      .getByRole("button", { name: `View ${spell.name}`, exact: true })
      .tap();
    await native.page
      .getByLabel("Public spell preview", { exact: true })
      .waitFor();
    await target.page
      .locator(
        `#goa2-m2-spells button[data-spell-id=${JSON.stringify(spell.id)}]`,
      )
      .first()
      .tap();
    for (const [profile, size] of [
      ["portrait", { width: 390, height: 844 }],
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
    ]) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      const b = await native.page
        .getByLabel("Public spell preview", { exact: true })
        .boundingBox();
      assert.ok(
        b &&
          b.y >= 0 &&
          b.y + b.height <= size.height &&
          b.x >= 0 &&
          b.x + b.width <= size.width,
        "Reader must stay in viewport",
      );
      const states = await Promise.all(
        c.windows.map((w) =>
          c.api(`/games/${w.clone.game_id}`, undefined, "GET"),
        ),
      );
      assert.equal(states[0].hash, states[1].hash);
      const report = await captureReport(c, [0, 1]);
      for (const w of c.windows) {
        assert.deepEqual(w.errors, []);
        assert.deepEqual(w.assets, []);
      }
      records.push({ mode, profile, state: "selected", ...report });
      await fs.writeFile(
        path.join(output, "reports.json"),
        JSON.stringify(
          { workingTree: true, status: c.status(), records },
          null,
          2,
        ),
      );
      console.log("PUBLIC", mode, profile, report.id);
    }
    await native.page
      .getByRole("button", { name: "Close spells", exact: true })
      .tap();
    await target.page
      .getByRole("button", { name: "Close cast spells", exact: true })
      .tap();
  }
  console.log("Public spell evidence:", output);
} finally {
  await desk.close();
}
