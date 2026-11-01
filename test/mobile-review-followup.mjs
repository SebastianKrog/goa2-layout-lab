// Windows Chromium regression checks for the R2/R3 human-review fixes.
// node test/mobile-review-followup.mjs [live|frontend-ref]; owns and closes desk 6360.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
for (const [k, p] of Object.entries({
  DESK: 6360,
  MAIN: 6361,
  COMPARATOR: 6362,
  BASE: 6363,
  LIVE: 6364,
  BACKEND: 11360,
  BOTS: 11361,
  DEVICE: 6460,
}))
  process.env[`GOA2_LAB_${k}_PORT`] = String(p);
process.env.GOA2_LAB_DISPLAY = "browser";
const sourceRef = process.argv[2] || "live";
if (sourceRef !== "live") process.env.GOA2_LAB_COMPARATOR_REF = sourceRef;
const { startDesk } = await import("../src/desk.mjs");
const desk = await startDesk({
  flags: new Set([
    "--headless",
    "--verification",
    "--no-open",
    "--no-auto-load",
  ]),
});
const { DATA } = await import("../src/config.mjs");
const { pathToFileURL } = await import("node:url");
const output = pathToFileURL(
  path.join(DATA, "reviews", "mobile-review-followup-" + Date.now()) + path.sep,
);
await fs.mkdir(output, { recursive: true });
async function api(route, body) {
  const r = await fetch("http://127.0.0.1:6360/api/" + route, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
async function load(id, seat, presentation, profile = "portrait") {
  await api("load", {
    situationId: id,
    presentation,
    slots: [
      {
        source: sourceRef === "live" ? "live" : "comparator",
        label: sourceRef === "live" ? "Review fixes (working tree)" : sourceRef,
        profile,
        render: "2d",
        uiMode: "mobile",
        seat,
      },
    ],
  });
  return desk.comparison.windows[0].page;
}
const records = [];
try {
  let page = await load("e81bc3bd5fff", "hero_arien", {
    pane: "hand",
    selectedCard: "noble_blade",
  });
  for (const profile of ["portrait", "landscape"]) {
    await page.setViewportSize(
      profile === "portrait"
        ? { width: 390, height: 844 }
        : { width: 844, height: 390 },
    );
    const nav = page.getByRole("navigation", { name: "Game views" });
    for (const pane of ["Choice", "Hand"]) {
      if (
        (await nav
          .getByRole("button", { name: pane, exact: true })
          .getAttribute("aria-pressed")) !== "true"
      )
        await nav.getByRole("button", { name: pane, exact: true }).click();
      const card = page.getByRole("button", {
        name: "Noble Blade",
        exact: true,
      });
      if (
        !(await page
          .getByRole("button", { name: "Close inspection", exact: true })
          .isVisible())
      )
        await card.click();
      const close = page.getByRole("button", {
        name: "Close inspection",
        exact: true,
      });
      console.log("CLOSE", pane, profile, await close.boundingBox());
      await close.click({ timeout: 5000 });
      await close.waitFor({ state: "detached" });
      await card.click();
      await page
        .getByRole("button", { name: "Close inspection", exact: true })
        .waitFor();
      const geometry = await page
        .locator('[data-mobile-region="action-info"]')
        .evaluate((el) => {
          const pane = el.querySelector("[data-mobile-panel]:not([hidden])"),
            content = pane.querySelector('[id^="mobile-pane-content"]');
          return {
            region: el.getBoundingClientRect().toJSON(),
            pane: pane.getBoundingClientRect().toJSON(),
            scroll: getComputedStyle(el).overflowY,
            contentScroll: getComputedStyle(content).overflowY,
          };
        });
      records.push({ profile, pane, ...geometry });
      assert.ok(
        Math.abs(geometry.pane.y - geometry.region.y) < 2,
        "No legacy pane offset",
      );
      assert.equal(geometry.scroll, "hidden");
      await page.screenshot({
        path: new URL(profile + "-" + pane + ".png", output).pathname.replace(
          /^\/(?=[A-Z]:)/,
          "",
        ),
      });
    }
  }
  console.log("PASS close and equal Hand/Choice geometry");
  page = await load("dbd50506df47", "hero_gydion", {
    pane: "hand",
    inspectionMobile: "cantrip",
  });
  await page
    .locator(
      '[data-mobile-region="card-focus"] [aria-label="Inspect Shocking Grasp"]',
    )
    .click();
  const child = page.locator("[data-nested-card]");
  const b = await child.evaluate((el) => ({
    frame: el.getBoundingClientRect().toJSON(),
    card: el.querySelector("article").getBoundingClientRect().toJSON(),
  }));
  assert.ok(b.frame.height - b.card.height < 4);
  records.push({ nested: b });
  await page.screenshot({
    path: new URL("nested.png", output).pathname.replace(/^\/(?=[A-Z]:)/, ""),
  });
  await child
    .locator('article > [aria-hidden="true"] img')
    .evaluate((img) => img.decode());
  const art = await child
    .locator('article > [aria-hidden="true"]')
    .evaluate((el) => {
      const img = el.querySelector("img"),
        r = el.getBoundingClientRect(),
        i = img.getBoundingClientRect(),
        card = el.closest("article").getBoundingClientRect(),
        style = getComputedStyle(el);
      return {
        width: r.width,
        height: r.height,
        right: r.right,
        cardRight: card.right,
        bottom: r.bottom,
        footerTop: el
          .closest("article")
          .querySelector("footer")
          .getBoundingClientRect().top,
        opacity: style.opacity,
        mask: style.maskImage,
        composite: style.maskComposite,
        sourceCrop: {
          x: ((r.left - i.left) / i.width) * 1192,
          y: ((r.top - i.top) / i.height) * 831,
          width: (r.width / i.width) * 1192,
          height: (r.height / i.height) * 831,
        },
      };
    });
  assert.ok(Math.abs(art.width - 270) < 1);
  assert.ok(Math.abs(art.height - (270 * 180) / 760) < 1);
  assert.ok(Math.abs(art.right - art.cardRight) < 2);
  assert.ok(Math.abs(art.bottom - art.footerTop) < 2);
  assert.equal(art.opacity, "0.48");
  assert.ok(
    art.composite.split(",").every((value) => value.trim() === "intersect"),
  );
  for (const [k, v] of Object.entries({
    x: 236,
    y: 196,
    width: 760,
    height: 180,
  }))
    assert.ok(
      Math.abs(art.sourceCrop[k] - v) < 1,
      k + " illustration-only crop",
    );
  records.push({ approvedBackdropB: art });
  await page
    .getByRole("button", { name: "Back to Cantrip", exact: true })
    .click();

  console.log("PASS nested content height and approved backdrop B");

  page = await load("5949a8eccf40", "hero_wasp", {
    pane: "heroes",
    spellBrowserMobile: { heroId: "hero_gydion", selectedId: "shocking_grasp" },
  });
  const x = page.getByRole("button", { name: "Close spells", exact: true });
  const style = await x.evaluate((el) => ({
    border: getComputedStyle(el).borderWidth,
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
  }));
  assert.equal(style.border, "0px");
  assert.equal(style.width, 28);
  assert.equal(style.height, 28);
  await x.click();
  await x.waitFor({ state: "detached" });
  records.push({ publicClose: style });
  console.log("PASS public spell close");
  page = await load("ad66cbbbda7e", "hero_gydion", {
    pane: "hand",
    selectedCard: "cantrip",
  });
  const rails = await page
    .locator(
      '[data-mobile-region="card-focus"] [data-spell] [class*="faceBand_"]',
    )
    .evaluateAll((els) =>
      els.map((el) => ({
        left: getComputedStyle(el, "::before").width,
        right: getComputedStyle(el, "::after").width,
        rightGradient: getComputedStyle(el, "::after").backgroundImage,
      })),
    );
  assert.ok(rails.length > 0);
  assert.ok(rails.every((r) => r.left === r.right));
  records.push({ rails });
  page = await load("7cc3ce17c3e7", "hero_brogan", { pane: "heroes" });
  assert.equal(await page.locator('[class*="ultimateBar_"]').count(), 0);
  console.log("PASS no wide Ultimate bar");
  page = await load("d296bd2e5d3d", "hero_arien", { pane: "choice" });
  const sheet = page.locator("[data-mobile-upgrade-picker]");
  await sheet.waitFor();
  const available = sheet.locator('[data-state="Available"] > button').first();
  await available.waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector("[data-upgrade-validation]")
        .textContent.includes("Checking"),
  );
  await available.click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector("[data-upgrade-validation]")
        .textContent.includes("Checking"),
  );
  const before = await sheet
    .locator('[aria-label="Planned item totals"]')
    .innerHTML();
  const row = await sheet
    .locator('[aria-label="Deck upgrade paths"]')
    .boundingBox();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let requestBody;
  await page.route("**/upgrades/preview", async (route) => {
    requestBody = route.request().postDataJSON();
    await gate;
    await route.continue();
  });
  await sheet.locator('[data-state="Available"] > button').first().click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-upgrade-validation]")
      .textContent.includes("Checking"),
  );
  assert.equal(
    await sheet.locator('[aria-label="Planned item totals"]').innerHTML(),
    before,
  );
  const pendingRow = await sheet
    .locator('[aria-label="Deck upgrade paths"]')
    .boundingBox();
  assert.equal(pendingRow.y, row.y);
  assert.equal(pendingRow.height, row.height);
  assert.equal(requestBody.card_ids.length, 2);
  assert.equal(
    await sheet
      .getByRole("button", { name: /Commit .* upgrades/ })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: new URL("upgrade-pending.png", output).pathname.replace(
      /^\/(?=[A-Z]:)/,
      "",
    ),
  });
  release();
  await page.waitForFunction(
    () =>
      !document
        .querySelector("[data-upgrade-validation]")
        .textContent.includes("Checking"),
  );
  assert.notEqual(
    await sheet.locator('[aria-label="Planned item totals"]').innerHTML(),
    before,
  );
  const staged = sheet
    .locator('[data-state="Staged"] [data-card-surface]')
    .first();
  assert.equal(
    await staged.evaluate((el) => getComputedStyle(el).outlineColor),
    "rgb(183, 153, 222)",
  );
  records.push({
    upgrade: {
      previewPrefixLength: requestBody.card_ids.length,
      retainedTotals: true,
      treeBefore: row,
      treePending: pendingRow,
      stagedOutline: "purple",
    },
  });
  console.log("PASS stable upgrade validation");
  await fs.writeFile(
    new URL("results.json", output),
    JSON.stringify({ source: sourceRef, records }, null, 2),
  );
  console.log("Evidence", output.pathname);
} catch (e) {
  const page = desk.comparison.windows.at(-1)?.page;
  if (page) {
    await page.screenshot({
      path: new URL("failure.png", output).pathname.replace(
        /^\/(?=[A-Z]:)/,
        "",
      ),
    });
    await fs.writeFile(new URL("failure.html", output), await page.content());
  }
  throw e;
} finally {
  await desk.close();
}
