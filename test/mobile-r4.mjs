// R4 Windows Chromium verification. node test/mobile-r4.mjs [live|frontend-ref]
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
for (const [key, port] of Object.entries({
  DESK: 6370,
  MAIN: 6371,
  COMPARATOR: 6372,
  BASE: 6373,
  LIVE: 6374,
  BACKEND: 11370,
  BOTS: 11371,
  DEVICE: 6470,
}))
  process.env[`GOA2_LAB_${key}_PORT`] = String(port);
process.env.GOA2_LAB_DISPLAY = "browser";
process.env.GOA2_LAB_MAIN_REF = "f28bf9c1b8b0437ceede1fe3ca6bd3663b9faa31";
const ref = process.argv[2] || "live";
if (ref !== "live") process.env.GOA2_LAB_COMPARATOR_REF = ref;
const { startDesk } = await import("../src/desk.mjs");
const { DATA } = await import("../src/config.mjs");
const out = path.join(DATA, "reviews", "mobile-r4-" + Date.now());
await fs.mkdir(out, { recursive: true });
const desk = await startDesk({
  flags: new Set([
    "--headless",
    "--verification",
    "--no-open",
    "--no-auto-load",
  ]),
});
async function api(name, body) {
  const r = await fetch("http://127.0.0.1:6370/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const value = await r.json();
  if (!r.ok) throw Error(name + ": " + JSON.stringify(value));
  return value;
}
const slot = (source, seat, profile = "portrait") => ({
  source,
  label: source === "main" ? "R3 baseline" : ref,
  profile,
  render: "2d",
  uiMode: "mobile",
  seat,
  autoSwitch: false,
});
async function load(
  id,
  seat,
  presentation,
  profile = "portrait",
  pair = false,
) {
  await api("load", {
    situationId: id,
    presentation,
    slots: [
      ...(pair ? [slot("main", seat, profile)] : []),
      slot(ref === "live" ? "live" : "comparator", seat, profile),
    ],
  });
  assert.equal(
    desk.comparison.windows.at(-1).config.seat,
    seat,
    "Use the requested viewpoint",
  );
  return desk.comparison.windows.at(-1).page;
}
const records = [];
async function hash() {
  return (await api("views")).at(-1).state.hash;
}
async function clean() {
  const s = await api("status");
  for (const w of s.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
    assert.deepEqual(w.warnings, []);
  }
}
async function snap(page, name) {
  await clean();
  await page.screenshot({ path: path.join(out, name + ".png") });
  records.push({
    name,
    hash: await hash(),
    regions: await page.locator("[data-mobile-region]").evaluateAll((els) =>
      els.map((el) => ({
        name: el.dataset.mobileRegion,
        rect: el.getBoundingClientRect().toJSON(),
        visible: el.checkVisibility(),
      })),
    ),
  });
  console.log("PASS", name);
}
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function board(page) {
  await settle(page);
  const nav = page.getByRole("navigation", { name: "Game views" });
  if (
    (await page
      .locator("[data-mobile-boxes]")
      .getAttribute("data-mobile-pane")) !== "board"
  )
    await nav.locator('[data-pane="board-choice"]').click();
}
async function choice(page) {
  const nav = page.getByRole("navigation", { name: "Game views" });
  if (
    (await page
      .locator("[data-mobile-boxes]")
      .getAttribute("data-mobile-pane")) !== "choice"
  )
    await nav.locator('[data-pane="board-choice"]').click();
}
const fixtureIds = {};
try {
  for (const file of ["empty-hand", "pending-swap"]) {
    const envelope = await fs.readFile(
      path.join(DATA, "situation-recipes", "mobile-r4", file + ".json"),
      "utf8",
    );
    const saved = await api("import", { content: envelope });
    fixtureIds[file] = saved.id;
  }
  await fs.writeFile(
    path.join(DATA, "reviews", "mobile-r4-situations.json"),
    JSON.stringify(fixtureIds, null, 2),
  );
  let page, before;
  const setupOnly = process.argv.includes("--setup-only");
  if (!setupOnly) {
    page = await load("e81bc3bd5fff", "hero_arien", {
      pane: "choice",
      selectedCard: "noble_blade",
    });
    before = await hash();
    await page
      .getByRole("button", { name: "Close inspection", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Noble Blade", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Commit", exact: true })
        .evaluate(
          (el) => el.closest("[data-mobile-region]").dataset.mobileRegion,
        ),
      "action-info",
    );
    const svg = await page.locator("svg[data-board-map]").elementHandle();
    await board(page);
    await page.keyboard.press("Enter");
    assert.equal(await hash(), before);
    await choice(page);
    await page
      .locator('[data-mobile-region="card-focus"] [role="dialog"]')
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Noble Blade", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator('[data-mobile-region="card-focus"] [role="dialog"]')
        .count(),
      1,
    );
    assert.equal(
      await svg.evaluate(
        (el) => el === document.querySelector("svg[data-board-map]"),
      ),
      true,
    );
    await snap(page, "planning");
    page = await load("eebbbbab698b", "hero_emmitt", { pane: "choice" });
    assert.equal(
      await page
        .getByRole("button", { name: "Done — play one card" })
        .evaluate(
          (el) => el.closest("[data-mobile-region]").dataset.mobileRegion,
        ),
      "action-info",
    );
    assert.match(
      await page.locator('[data-mobile-region="message"]').textContent(),
      /second card|play one card/i,
    );
    await snap(page, "second-card");
    page = await load(fixtureIds["empty-hand"], "hero_arien", { pane: "hand" });
    assert.match(
      await page.locator('[data-mobile-region="message"]').textContent(),
      /No cards in hand/,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Commit", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.locator('[data-pane="board-choice"]').textContent(),
      "Board",
    );
    await snap(page, "empty-hand");
    page = await load("e6cf117c8910", "hero_arien", { pane: "choice" });
    await page
      .locator('[data-mobile-region="card-focus"] [data-card-size="large"]')
      .waitFor();
    assert.equal(
      await page
        .locator(
          '[data-mobile-region="action-info"] [aria-label="Game decision"]',
        )
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator('[data-mobile-region="action-info"] [data-card-size="large"]')
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator('[data-mobile-region="card-focus"] [data-card-size="large"]')
        .count(),
      1,
    );
    await snap(page, "action-choice");
    for (const profile of ["portrait", "landscape"]) {
      page = await load(
        "2b928b7b0ab4",
        "hero_brogan",
        { pane: "choice" },
        profile,
        true,
      );
      const baseline = desk.comparison.windows[0].page;
      for (const target of [baseline, page])
        await target
          .locator(
            '[data-decision-type="SELECT_CARD_OR_PASS"] [data-card-interaction]',
          )
          .first()
          .click();
      await page
        .locator('[data-mobile-region="card-focus"] [data-card-size="large"]')
        .waitFor();
      const panel = page.locator('[aria-label="Game decision"]');
      const staged = panel.locator(
        '[data-card-interaction][aria-pressed="true"]',
      );
      const label = await staged.getAttribute("aria-label");
      assert.equal(await panel.locator('[data-card-size="large"]').count(), 0);
      assert.equal(
        await page
          .locator('[data-mobile-region="card-focus"] [data-card-size="large"]')
          .count(),
        1,
      );
      assert.equal(
        await panel.evaluate(
          (el) => el.closest("[data-mobile-region]").dataset.mobileRegion,
        ),
        "action-info",
      );
      before = await hash();
      const other = panel.getByRole("button", { name: /^Inspect / }).all();
      const inspectButtons = await other;
      if (inspectButtons.length > 1) await inspectButtons.at(-1).click();
      assert.equal(await staged.getAttribute("aria-label"), label);
      assert.equal(await hash(), before);
      await board(page);
      await choice(page);
      assert.equal(await staged.getAttribute("aria-label"), label);
      // Re-align focus with the staged card for the limited before/after example.
      await staged.click();
      const capture = await api("capture", { indexes: [0, 1] });
      assert.equal(capture.diverged, false);
      records.push({ name: "defense-comparison-" + profile, capture });
      await snap(page, "defense-" + profile);
    }
    page = await load("30735050fbde", "hero_brogan", { pane: "choice" });
    before = await hash();
    await page
      .locator('[data-decision-type="SELECT_CARD"] [data-card-interaction]')
      .first()
      .click();
    assert.equal(await hash(), before);
    assert.equal(
      await page
        .getByRole("button", { name: "Confirm discard" })
        .evaluate(
          (el) => el.closest("[data-mobile-region]").dataset.mobileRegion,
        ),
      "action-info",
    );
    await snap(page, "discard");
    page = await load("50205badf8ea", "hero_arien", { pane: "choice" });
    assert.equal(
      await page
        .getByRole("button", { name: "Confirm choice" })
        .evaluate(
          (el) => el.closest("[data-mobile-region]").dataset.mobileRegion,
        ),
      "action-info",
    );
    await snap(page, "team-actor");
  }
  page = await load(fixtureIds["pending-swap"], "hero_hanu", {
    pane: "choice",
  });
  before = await hash();
  assert.equal(
    await page
      .getByRole("button", { name: "Accept", exact: true })
      .evaluate(
        (el) => el.closest("[data-mobile-region]").dataset.mobileRegion,
      ),
    "action-info",
  );
  await board(page);
  assert.equal(
    await page.getByRole("button", { name: "Accept", exact: true }).isVisible(),
    false,
  );
  await choice(page);
  assert.equal(await hash(), before);
  await snap(page, "pending-swap");
  await page.getByRole("button", { name: "Change starting position" }).click();
  await page.getByRole("button", { name: "Done adjusting" }).waitFor();
  await board(page);
  await page.locator('[data-mobile-boxes][data-mobile-pane="board"]').waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Done adjusting" }).isVisible(),
    false,
  );
  await choice(page);
  await page.getByRole("button", { name: "Done adjusting" }).waitFor();
  assert.equal(await hash(), before);
  for (const profile of ["portrait", "landscape"]) {
    await page.setViewportSize(
      profile === "portrait"
        ? { width: 390, height: 844 }
        : { width: 844, height: 390 },
    );
    await page.getByRole("button", { name: "Done adjusting" }).waitFor();
    const geometry = await page
      .locator('[data-mobile-setup] [aria-label="Starting position"]')
      .evaluate((el) => ({
        position: getComputedStyle(el).position,
        controls: el.getBoundingClientRect().toJSON(),
        region: el
          .closest("[data-mobile-region]")
          .getBoundingClientRect()
          .toJSON(),
      }));
    assert.equal(geometry.position, "relative");
    assert.ok(
      geometry.controls.top >= geometry.region.top &&
        geometry.controls.bottom <= geometry.region.bottom,
    );
    assert.ok(
      geometry.controls.left >= geometry.region.left &&
        geometry.controls.right <= geometry.region.right,
    );
    records.push({ name: "setup-geometry-" + profile, ...geometry });
    await snap(page, "starting-resume-" + profile);
  }
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      { ref, baseline: process.env.GOA2_LAB_MAIN_REF, fixtureIds, records },
      null,
      2,
    ),
  );
  console.log("R4 evidence", out);
} catch (error) {
  const page = desk.comparison.windows.at(-1)?.page;
  await fs.writeFile(
    path.join(out, "failure.json"),
    JSON.stringify({ error: String(error), records }, null, 2),
  );
  if (page) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    await fs.writeFile(path.join(out, "failure.html"), await page.content());
  }
  throw error;
} finally {
  await desk.close();
}
