// Windows Chromium smoke checks for the R1 candidate; owns and closes its desk.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
for (const [key, port] of Object.entries({
  DESK: 6290,
  MAIN: 6291,
  COMPARATOR: 6292,
  BASE: 6293,
  LIVE: 6294,
  BACKEND: 11290,
  BOTS: 11291,
  DEVICE: 6390,
}))
  process.env[`GOA2_LAB_${key}_PORT`] = String(port);
process.env.GOA2_LAB_DISPLAY = "browser";
process.env.GOA2_LAB_COMPARATOR_REF =
  process.argv[2] || "aa645c7a14a697a5af5ea54a6e4c44e224ef59cb";
const { startDesk } = await import("../src/desk.mjs");
const { DATA } = await import("../src/config.mjs");
const output = path.join(DATA, "reviews", "mobile-r1-smoke-" + Date.now());
await fs.mkdir(output, { recursive: true });
const desk = await startDesk({
  flags: new Set([
    "--headless",
    "--verification",
    "--no-open",
    "--no-auto-load",
  ]),
});
const records = [];
async function api(route, body) {
  const r = await fetch("http://127.0.0.1:6290/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
try {
  for (const [profile, render, uiMode] of [
    ["compact", "2d", "mobile"],
    ["landscape", "2d", "mobile"],
    ["desktop", "2d", "desktop"],
    ["desktop", "3d", "desktop"],
  ]) {
    await api("load", {
      situationId: "e81bc3bd5fff",
      slots: [
        { source: "comparator", profile, render, uiMode, seat: "hero_arien" },
      ],
    });
    const w = desk.comparison.windows[0],
      page = w.page;
    const before = (await api("views"))[0].state.hash;
    let navigation;
    if (uiMode === "mobile") {
      const nav = page.getByRole("navigation", { name: "Game views" });
      assert.deepEqual(await nav.getByRole("button").allTextContents(), [
        "Choice",
        "Hand",
        "Heroes",
        "Deck",
        "Log",
        "Settings",
      ]);
      await nav.getByRole("button", { name: "Choice", exact: true }).click();
      await page
        .locator('[data-mobile-panel="hand"] [data-lab-card="noble_blade"]')
        .first()
        .click();
      await nav.getByRole("button", { name: "Heroes", exact: true }).click();
      await nav.getByRole("button", { name: "Choice", exact: true }).click();
      await page
        .locator('[data-lab-mobile-inspection="noble_blade"]')
        .waitFor({ state: "visible" });
      assert.equal(
        (await api("views"))[0].presentation.selectedCard,
        "noble_blade",
      );
      navigation = await nav.getByRole("button").evaluateAll((buttons) =>
        buttons.map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.textContent,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            bottom: r.bottom,
            right: r.right,
            viewport: { width: innerWidth, height: innerHeight },
          };
        }),
      );
      for (const b of navigation) {
        assert.ok(
          b.x >= 0 &&
            b.y >= 0 &&
            b.right <= b.viewport.width &&
            b.bottom <= b.viewport.height,
          JSON.stringify(b),
        );
        assert.ok(b.height >= 44);
      }
      if (profile === "compact")
        assert.ok(navigation.every((b) => b.y === navigation[0].y));
      else assert.ok(navigation.every((b) => b.x === navigation[0].x));
    } else {
      assert.equal(await page.locator('[aria-label="Game views"]').count(), 0);
      if (render === "3d") assert.ok(await page.locator("canvas").count());
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(output, `${profile}-${render}.png`),
      animations: "disabled",
    });
    const after = (await api("views"))[0].state.hash;
    assert.equal(after, before);
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
    records.push({
      profile,
      render,
      uiMode,
      source: process.env.GOA2_LAB_COMPARATOR_REF,
      hash: before,
      navigation,
      errors: w.errors,
      assets: w.assets,
    });
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(records, null, 2),
    );
    console.log("PASS", profile, render, uiMode);
  }
  console.log("R1 smoke evidence:", output);
} finally {
  await desk.close();
}
