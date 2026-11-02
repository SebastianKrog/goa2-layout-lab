import { situationTags } from "../public/tags.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deskFixture } from "./fixtures/desk-interface.mjs";
import { Layouts, layoutSlots } from "../src/layouts.mjs";
import { validateSlots } from "../src/config.mjs";

test("Situation tag filters combine with search and preserve hidden review selections; tags are editable", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const data = await deskFixture(context, { views: 1 });
  const base = data.catalog.situations[0];
  data.catalog.situations = [
    {
      ...base,
      id: "alpha",
      name: "Alpha",
      group: "cards",
      tags: ["hero:arien", "owner"],
      decisionStateTags: ["phase:planning"],
    },
    {
      ...base,
      id: "beta",
      name: "Beta",
      group: "cards",
      tags: ["hero:brogan"],
      decisionStateTags: ["phase:planning"],
    },
    {
      ...base,
      id: "gamma",
      name: "Gamma",
      group: "heroes",
      tags: ["hero:arien"],
      decisionStateTags: ["phase:resolution"],
    },
  ];
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://desk.test/");
  await page.locator("[data-page=situations]").click();
  await page.getByLabel("Select situation Gamma", { exact: true }).check();
  await page.locator("#libraryTag").selectOption("phase:planning");
  await page.waitForFunction(
    () => document.querySelectorAll(".situation-card").length === 2,
  );
  await page.locator("#libraryTag").selectOption("hero:arien");
  await page.waitForFunction(
    () => document.querySelectorAll(".situation-card").length === 1,
  );
  await page.getByLabel("Select all filtered situations").check();
  assert.match(
    await page.locator("#reviewSelectedCount").textContent(),
    /2 selected/,
  );
  await page.locator("#librarySearch").fill("beta");
  assert.equal(await page.locator(".situation-card").count(), 0);
  await page.locator("#librarySearch").fill("");
  await page
    .getByRole("button", { name: "Remove tag filter hero:arien", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".situation-card").length === 2,
  );
  await page.getByLabel("Actions for Alpha", { exact: true }).click();
  await page.getByRole("button", { name: "Edit tags", exact: true }).click();
  const catalogReads = data.reads.filter((p) => p === "/api/catalog").length;
  await page.locator("#tagsInput").fill("Owner, Custom tag, owner");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await page.locator("#tagsDialog").waitFor({ state: "hidden" });
  assert.equal(
    data.reads.filter((p) => p === "/api/catalog").length,
    catalogReads,
    "Tag saves must not reload the whole catalog",
  );
  const request = data.requests.find((r) => r.path === "/api/tags");
  assert.deepEqual(request.body, {
    kind: "situation",
    id: "alpha",
    origin: "library",
    tags: ["custom-tag", "owner"],
  });
  await page.getByRole("button", { name: "Clear tags", exact: true }).click();
  await page.locator("#librarySearch").fill("custom-tag");
  await page.waitForFunction(
    () => document.querySelectorAll(".situation-card").length === 1,
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  assert.deepEqual(errors, []);
});

test("View and Layout tags normalize and survive Layout saves, reloads and subsequent settings saves", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lab-tags-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = {
    source: "live",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    tags: [" Phone ", "UI review", "phone"],
  };
  const store = await new Layouts(root, path.join(root, "shared")).init({});
  const saved = await store.save("Tagged", [config], "none", ["QA", "mobile"]);
  assert.deepEqual(layoutSlots(saved)[0].tags, ["phone", "ui-review"]);
  await store.save("Tagged", [{ ...config, label: "Renamed" }], "none");
  const fresh = await new Layouts(root, path.join(root, "shared")).init({});
  assert.deepEqual(fresh.find(saved.id).tags, ["mobile", "qa"]);
  assert.deepEqual(layoutSlots(fresh.find(saved.id))[0].tags, [
    "phone",
    "ui-review",
  ]);
  assert.throws(
    () => validateSlots([{ ...config, tags: ["../invalid"] }]),
    /tags/,
  );
});

test("View tags remain a secondary advanced setting and use available header space", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const data = await deskFixture(context, { views: 1 });
  data.state.windows[0].config.tags = ["alpha", "beta", "gamma", "delta"];
  const page = await context.newPage();
  await page.goto("http://desk.test/");
  await page.locator(".slot-header .tag-chip").first().waitFor();
  assert.equal(await page.locator(".slot-header .tag-chip:visible").count(), 4);
  assert.equal(await page.locator(".slot-header .tag-more:visible").count(), 0);
  await page.getByRole("button", { name: "Edit view", exact: true }).click();
  assert.equal(
    await page.getByLabel("View tags", { exact: true }).isVisible(),
    false,
  );
  await page.locator("#viewAdvanced summary").click();
  await page.getByLabel("View tags", { exact: true }).fill("New tag, mobile");
  await page.locator("#editorSubmit").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  const request = data.requests.find((r) => r.path === "/api/configure");
  assert.deepEqual(request.body.update.tags, ["mobile", "new-tag"]);
});

test("independent Situation and Decision State tag limits compose without breaking filtering", () => {
  const own = Array.from({ length: 32 }, (_, i) => "own-" + i);
  const inherited = Array.from({ length: 32 }, (_, i) => "state-" + i);
  assert.equal(
    situationTags({ tags: own, decisionStateTags: inherited }).length,
    64,
  );
  assert.equal(
    situationTags({ tags: ["Planning"], decisionStateTags: ["planning"] })
      .length,
    1,
  );
});
test("editing Decision State tags updates matching variants without changing the other store", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const data = await deskFixture(context, { views: 0 });
  const base = data.catalog.situations[0],
    id = "b".repeat(64);
  data.catalog.situations = [
    {
      ...base,
      id: "sharedtag",
      name: "Shared tag case",
      origin: "library",
      tags: [],
      decisionStateId: id,
      decisionStateTags: ["shared"],
    },
    {
      ...base,
      id: "localtag",
      name: "Local tag case",
      origin: "local",
      tags: [],
      decisionStateId: id,
      decisionStateTags: ["local"],
    },
  ];
  data.catalog.decisionStates = [
    { id, name: "Checkpoint", origin: "local", tags: ["local"] },
  ];
  const page = await context.newPage();
  await page.goto("http://desk.test/");
  await page.locator("[data-page=situations]").click();
  for (const [name, newTag] of [
    ["Local tag case", "updated-local"],
    ["Shared tag case", "updated-shared"],
  ]) {
    await page.getByLabel("Actions for " + name, { exact: true }).click();
    await page
      .getByRole("button", { name: "Edit Decision State tags", exact: true })
      .click();
    await page.locator("#tagsInput").fill(newTag);
    await page.getByRole("button", { name: "Save tags", exact: true }).click();
    await page.locator("#tagsDialog").waitFor({ state: "hidden" });
  }
  assert.equal(
    await page
      .getByRole("button", { name: "Filter by tag updated-local", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", {
        name: "Filter by tag updated-shared",
        exact: true,
      })
      .count(),
    1,
  );
  assert.deepEqual(
    data.requests
      .filter((r) => r.path === "/api/tags")
      .map((r) => r.body.origin),
    ["local", "library"],
  );
  await page.locator("#libraryTag").selectOption("updated-local");
  await page.waitForFunction(
    () => document.querySelectorAll(".situation-card").length === 1,
  );
  assert.match(
    await page.locator(".situation-card h3").textContent(),
    /Local tag case/,
  );
});

test("compact Situation rows fit typed tags to width and expand descriptions", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1920, height: 900 },
  });
  const data = await deskFixture(context);
  data.catalog.situations = [
    {
      ...data.catalog.situations[0],
      id: "responsive",
      name: "Choose a spell",
      description:
        "Inspect the spellbook before selecting an available spell. This case includes concealed spells and public choices for comparison.",
      tags: [
        "hero:gydion",
        "hero:arien",
        "hero:brogan",
        "hero:hanu",
        "panel:board",
        "topic:spells",
        "viewpoint:gydion",
      ],
      decisionStateTags: ["decision:select-spell", "phase:resolution"],
    },
  ];
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://desk.test/");
  await page.locator("[data-page=situations]").click();
  const row = page.locator(".situation-card");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".situation-heading .tag-chip:not([hidden])")
        .length === 9,
  );
  assert.equal(
    await row.locator('.tag-chip[data-tag-type="hero"]').first().textContent(),
    "Arien",
  );
  assert.equal(
    await row.locator('.tag-chip[data-tag-type="decision"]').textContent(),
    "Select spell",
  );
  const layout = await row.evaluate((card) => {
    const name = card.querySelector("h3").getBoundingClientRect(),
      tags = card.querySelector(".tag-list").getBoundingClientRect();
    return {
      height: card.clientHeight,
      aligned: Math.abs(name.top - tags.top) < 3,
      right: tags.left > name.left,
    };
  });
  assert.ok(
    layout.height <= 52 && layout.aligned && layout.right,
    JSON.stringify(layout),
  );
  await page.setViewportSize({ width: 480, height: 900 });
  await row.locator(".tag-more").waitFor({ state: "visible" });
  assert.ok((await row.locator(".tag-chip:visible").count()) < 9);
  await row.locator(".tag-more").click();
  assert.equal(await row.locator(".tag-chip:visible").count(), 9);
  await row.locator(".tag-more").click();
  await row.locator(".situation-description summary").click();
  assert.equal(
    await row.locator(".situation-description").evaluate((e) => e.open),
    true,
  );
  await page.locator("#librarySearch").fill("concealed spells");
  assert.equal(await row.count(), 1);
  await page.setViewportSize({ width: 390, height: 900 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
});
