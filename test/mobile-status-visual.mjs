import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
for (const [k, v] of Object.entries({
  DESK: 5100,
  BASE: 5101,
  COMPARATOR: 5102,
  LIVE: 5103,
  BACKEND: 10100,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(v);
const { DATA, BACKEND, TOOL } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { captureReport } = await import("../report.mjs");
const { showPane } = await import("../presentation.mjs");
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
const output = path.join(DATA, "reviews", "status-final-" + Date.now());
await fs.mkdir(output, { recursive: true });
const records = [];
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
const sizes = [
  ["portrait", { width: 390, height: 844 }],
  ["compact", { width: 360, height: 800 }],
  ["landscape", { width: 844, height: 390 }],
];
try {
  const c = desk.comparison;
  async function load(s, seat) {
    await c.load(
      s.id,
      [
        { source: "live", uiMode: "mobile" },
        { source: "target", uiMode: "desktop" },
      ].map((w) => ({ ...w, seat, render: "2d", profile: "portrait" })),
      {},
      s,
    );
  }
  async function capture(key, profile) {
    const states = await Promise.all(
      c.windows.map((w) =>
        c.api("/games/" + w.clone.game_id, undefined, "GET"),
      ),
    );
    assert.equal(states[0].hash, states[1].hash);
    const report = await captureReport(c, [0, 1]);
    records.push({ key, profile, ...report });
    await fs.writeFile(
      path.join(output, "reports.json"),
      JSON.stringify({ status: c.status(), records }, null, 2),
    );
    console.log("FINAL", key, profile, report.id);
  }
  let s = await c.api("/import", {
    content: JSON.parse(
      await fs.readFile(
        path.join(
          DATA,
          "situation-recipes/mobile-presentation/shell-long-waiting-status.json",
        ),
        "utf8",
      ),
    ),
  });
  await load(s, "hero_arien");
  const [native, target] = c.windows;
  for (const [profile, size] of sizes) {
    for (const w of c.windows) await w.page.setViewportSize(size);
    const strip = native.page.getByTitle("Expand match status", {
      exact: true,
    });
    await strip.waitFor();
    await native.page.waitForFunction(() =>
      document
        .querySelector('button[title="Expand match status"]')
        ?.hasAttribute("data-overflow"),
    );
    await native.page.emulateMedia({ reducedMotion: "no-preference" });
    assert.notEqual(
      await strip
        .locator("strong > span")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await native.page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await strip
        .locator("strong > span")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await native.page.emulateMedia({ reducedMotion: "no-preference" });
    const collapsed = await strip.boundingBox();
    assert.ok(
      collapsed && collapsed.height <= 24,
      "Collapsed status must stay one row",
    );
    const rows = await native.page
      .locator('[aria-label="Hero summaries"] > div')
      .evaluateAll((elements) =>
        elements.map((el) => el.getBoundingClientRect().height),
      );
    assert.equal(rows.length, 10);
    assert.ok(
      rows.every((height) => height <= 31),
      "A card must not enlarge a compact Board row",
    );
    assert.ok(
      await native.page
        .locator('[aria-label="Hero summaries"]')
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      "All ten compact rows should fit at the audited sizes",
    );
    assert.ok(
      await native.page
        .locator("[data-mobile-board-summary] > div")
        .evaluateAll((rows) =>
          rows.every((row) => row.scrollWidth <= row.clientWidth + 1),
        ),
      "Crowded Board rows must fit horizontally",
    );
    const focus = await native.page
      .getByRole("button", { name: "Focus Gydion", exact: true })
      .boundingBox();
    const emblem = await native.page
      .locator("[data-mobile-board-summary]")
      .getByRole("button", { name: /^Spells cast:/ })
      .boundingBox();
    assert.ok(
      focus &&
        emblem &&
        emblem.x >= focus.x + focus.width &&
        emblem.x <= focus.x + focus.width + 4,
      "Compact indicators immediately follow the independent hero-name button",
    );
    await capture("long-status-collapsed", profile);
    await strip.tap();
    await target.page.locator('.m2-hud-bottom[role="button"]').tap();
    const expanded = native.page.getByTitle("Collapse match status", {
      exact: true,
    });
    await native.page.waitForFunction(() => {
      const b = document.querySelector('button[title="Collapse match status"]');
      return (
        b &&
        b
          .closest("[data-mobile-pane]")
          .style.getPropertyValue("--mobile-status-height") ===
          Math.ceil(b.getBoundingClientRect().height) + "px"
      );
    });
    const box = await expanded.boundingBox();
    assert.ok(
      box && box.height > collapsed.height,
      "Expanded status must expose wrapped text",
    );
    assert.equal(await expanded.getAttribute("aria-expanded"), "true");
    await capture("long-status-expanded", profile);
    await expanded.press("Escape");
    await target.page.locator('.m2-hud-bottom[role="button"]').press("Escape");
    assert.equal(
      await native.page
        .getByTitle("Expand match status", { exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
  }
  const library = await c.api("/situations", undefined, "GET");
  for (const [key, seat] of process.argv.includes("--status-only")
    ? []
    : [
        ["snorri-played-history-runes", "hero_snorri"],
        ["brogan-public-active-history", "hero_brogan"],
        ["gydion-three-indicators-committed", "hero_gydion"],
      ]) {
    s = library.find(
      (s) => s.origin === "library" && s.name === "M3 presentation - " + key,
    );
    assert.ok(s, "Promoted shared situation must reopen");
    await load(s, seat);
    for (const [profile, size] of sizes) {
      for (const w of c.windows) {
        await w.page.setViewportSize(size);
        await showPane(w.page, "heroes", w.config);
      }
      await capture(key, profile);
    }
  }
  for (const w of c.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
  }
  console.log("Final status/history evidence", output);
} finally {
  await desk.close();
}
