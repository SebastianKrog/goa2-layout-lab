// Windows Chromium keyboard, geometry and desktop checks for the R2 candidate; owns and closes its desk.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
for (const [key, port] of Object.entries({
  DESK: 6310,
  MAIN: 6311,
  COMPARATOR: 6312,
  BASE: 6313,
  LIVE: 6314,
  BACKEND: 11310,
  BOTS: 11311,
  DEVICE: 6410,
}))
  process.env[`GOA2_LAB_${key}_PORT`] = String(port);
process.env.GOA2_LAB_DISPLAY = "browser";
process.env.GOA2_LAB_COMPARATOR_REF = process.argv[2] || "16e7e8d";
const { startDesk } = await import("../src/desk.mjs");
const { DATA } = await import("../src/config.mjs");
const output = path.join(DATA, "reviews", "mobile-r2-smoke-" + Date.now());
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
  const r = await fetch("http://127.0.0.1:6310/api/" + route, {
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
  ].filter(
    ([profile]) =>
      !process.argv.includes("--choices-only") &&
      (!process.argv.includes("--desktop-only") || profile === "desktop") &&
      (!process.argv.includes("--mobile-only") || profile !== "desktop"),
  )) {
    await api("load", {
      situationId: "e81bc3bd5fff",
      slots: [
        { source: "comparator", profile, render, uiMode, seat: "hero_arien" },
      ],
    });
    const w = desk.comparison.windows[0],
      page = w.page;
    page.on("pageerror", (error) => console.log("BROWSER ERROR", error.stack));
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
      const cardButton = page.getByRole("button", {
        name: "Noble Blade",
        exact: true,
      });
      await cardButton.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      const reader = page.locator(
        '[role="dialog"][aria-label="Inspect Noble Blade"]',
      );
      await reader.focus();
      await page.keyboard.press("Enter");
      assert.equal(
        (await api("views"))[0].state.hash,
        before,
        "card/reader keyboard activation must not submit",
      );
      const wrapper = await cardButton.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          border: s.borderWidth,
          padding: s.padding,
          background: s.backgroundColor,
          height: el.getBoundingClientRect().height,
        };
      });
      assert.equal(wrapper.border, "0px");
      assert.equal(wrapper.padding, "0px");
      assert.ok(wrapper.height >= 44);
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
  for (const [situationId, selector] of process.argv.includes(
    "--desktop-only",
  ) || process.argv.includes("--mobile-only")
    ? []
    : [
        ["2b928b7b0ab4", "[data-defense-choice]"],
        ["30735050fbde", "[data-discard-choice]"],
      ]) {
    await api("load", {
      situationId,
      slots: [
        {
          source: "comparator",
          profile: "compact",
          render: "2d",
          uiMode: "mobile",
          seat: "hero_brogan",
        },
      ],
    });
    const w = desk.comparison.windows[0],
      page = w.page,
      before = (await api("views"))[0].state.hash;
    const nav = page.getByRole("navigation", { name: "Game views" });
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Hand, defense and discard card size" })
      .selectOption("tiny");
    await nav.getByRole("button", { name: "Choice", exact: true }).click();
    const cards = page.locator(selector + " [data-card-interaction]");
    await cards.first().waitFor();
    const geometry = await cards.evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el),
          face = el.querySelector("[data-card-size]");
        return {
          height: el.getBoundingClientRect().height,
          border: s.borderWidth,
          padding: s.padding,
          size: face.getAttribute("data-card-size"),
          faceHeight: face.getBoundingClientRect().height,
        };
      }),
    );
    assert.ok(geometry.length);
    for (const c of geometry) {
      assert.equal(c.size, "tiny");
      assert.equal(c.border, "0px");
      assert.equal(c.padding, "0px");
      assert.equal(c.height, 30);
      assert.equal(c.faceHeight, 28);
    }
    await cards.first().click();
    await page.keyboard.press("Enter");
    assert.equal((await api("views"))[0].state.hash, before);
    await nav.getByRole("button", { name: "Hand", exact: true }).click();
    await page
      .locator('[data-mobile-panel="hand"]')
      .waitFor({ state: "visible" });
    const handCount = await page.evaluate(
      () =>
        Object.values(window.__GOA2_LAB_STATE__.view.teams)
          .flatMap((t) => t.heroes)
          .find((h) => h.id === "hero_brogan").hand.length,
    );
    assert.equal(
      await page
        .locator('[data-mobile-panel="hand"] [data-card-size="tiny"]')
        .count(),
      handCount,
    );
    await nav.getByRole("button", { name: "Choice", exact: true }).click();
    assert.equal(await cards.first().getAttribute("aria-pressed"), "true");
    assert.equal((await api("views"))[0].state.hash, before);
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
    records.push({
      situationId,
      geometry,
      hash: before,
      keyboard: "Enter did not submit",
      draft: "retained across Hand and Choice",
    });
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(records, null, 2),
    );
    console.log("PASS common Tiny preference", situationId);
  }
  console.log("R2 smoke evidence:", output);
} finally {
  await desk.close();
}
