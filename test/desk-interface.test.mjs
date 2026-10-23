import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deskFixture } from "./fixtures/desk-interface.mjs";
async function fixture(t, views = 2) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const data = await deskFixture(context, { views });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://desk.test/");
  await page.locator(".slot").first().waitFor();
  t.after(() => assert.deepEqual(errors, []));
  return { page, ...data };
}
async function fits(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `No page overflow at ${page.viewportSize().width}px`,
  );
}

test("workspace keeps secondary tools in one dialog and capture selection stays synchronized", async (t) => {
  const { page, requests, state } = await fixture(t, 3);
  assert.equal(await page.locator("#comparePage details:visible").count(), 0);
  assert.equal(
    await page
      .locator(".slot-footer")
      .getByRole("button", { name: "Remove", exact: true })
      .count(),
    0,
  );
  await page.locator("#workspaceTools").click();
  assert.equal(await page.locator("#toolViewSelection input").count(), 3);
  await page.locator("#toolViewSelection input").nth(1).uncheck();
  await page.locator("#cropTools summary").click();
  await page.locator("#cropEnabled").check();
  await page.locator("#cropSelector").fill(".card");
  await page.locator("#captureFromTools").click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  assert.equal(
    await page.locator("#workspaceToolsDialog").evaluate((e) => e.open),
    false,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Include in capture" })
      .nth(1)
      .isChecked(),
    false,
  );
  assert.deepEqual(requests.find((r) => r.path === "/api/capture").body, {
    indexes: [0, 2],
    crop: { selector: ".card", match: "unique" },
  });
  await page
    .getByRole("checkbox", { name: "Include in capture" })
    .nth(1)
    .check();
  await page.locator("#workspaceTools").click();
  assert.equal(
    await page.locator("#toolViewSelection input").nth(1).isChecked(),
    true,
  );
  await page.keyboard.press("Escape");
  await page.locator("#workspaceTools").click();
  await page.locator("#count").selectOption("1");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelectorAll(".slot").length === 3,
  );
  assert.equal(
    requests.some((r) => r.path === "/api/load"),
    false,
    "Closing tools cancels staged Layout changes",
  );
  state.reviewRun = {
    active: true,
    id: "a".repeat(24),
    index: 0,
    total: 2,
    name: "Review",
    situationName: "Planning",
    url: "/reports/fixture/",
    next: true,
    previous: false,
  };
  await page.reload();
  await page.locator("#workspaceTools").click();
  assert.equal(
    await page.getByLabel("Synchronize", { exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.locator("#situation").isDisabled(), true);
  assert.equal(await page.locator("#captureFromTools").isEnabled(), true);
  await page.keyboard.press("Escape");
  for (const width of [1440, 900, 600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
});

test("View settings keep common choices and Save visible while advanced controls remain usable", async (t) => {
  const { page, requests } = await fixture(t);
  await page
    .getByRole("button", { name: "Edit view", exact: true })
    .first()
    .click();
  await page.locator("#editor[open]").waitFor();
  assert.equal(await page.locator("#editorForm select:visible").count(), 5);
  assert.equal(await page.locator("#editorAdvancedFields").isVisible(), false);
  assert.equal(await page.locator("#viewBotRows").isVisible(), false);
  for (const width of [1440, 768, 600, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const rect = await page.locator("#editorSubmit").boundingBox();
    assert.ok(
      rect && rect.y >= 0 && rect.y + rect.height <= 700,
      "Save is reachable without scrolling",
    );
    await fits(page);
  }
  await page.locator("#playOptions > summary").click();
  await page.locator("#viewBotPreset").selectOption("random");
  assert.equal(await page.locator("#viewBotRows").isVisible(), false);
  await page.locator("#viewBotDetails summary").click();
  await page.getByLabel("Hanu controller").selectOption("ismcts");
  assert.equal(await page.locator("#viewBotPreset").inputValue(), "custom");
  await page.locator("#playOptions > summary").click();
  await page.locator("#viewAdvanced summary").click();
  await page.getByLabel("View name", { exact: true }).fill("My view");
  await page.getByLabel("Renderer", { exact: true }).selectOption("3d");
  assert.equal(
    await page.getByLabel("Interface preset", { exact: true }).inputValue(),
    "3d",
  );
  assert.equal(
    await page.getByLabel("UI mode", { exact: true }).inputValue(),
    "desktop",
  );
  await page.locator("#editorSubmit").click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  const body = requests.find((r) => r.path === "/api/configure").body;
  assert.equal(body.update.label, "My view");
  assert.equal(body.update.render, "3d");
  assert.equal(body.update.bots.hero_hanu, "ismcts");
});

test("Situations search retains off-filter selections and exposes secondary actions on demand", async (t) => {
  const { page } = await fixture(t);
  await page.locator("[data-page=situations]").click();
  const total = await page.locator(".situation-card").count();
  assert.ok(total > 10);
  assert.equal(await page.locator("#reviewName").isVisible(), false);
  assert.equal(
    await page
      .locator("#library")
      .getByRole("button", { name: "Move", exact: true })
      .count(),
    0,
  );
  const chosen = page.locator("#library input[data-situation-id]").first();
  await chosen.check();
  assert.equal(await page.locator("#reviewName").isVisible(), true);
  await page.locator("#librarySearch").fill("Snorri");
  assert.ok((await page.locator(".situation-card").count()) < total);
  assert.match(
    await page.locator("#reviewSelectedCount").textContent(),
    /^1 selected/,
  );
  await page.locator("#reviewSelectFiltered").check();
  await page.locator("#librarySearch").fill("no match anywhere 123");
  assert.equal(await page.locator(".situation-card").count(), 0);
  assert.match(await page.locator("#library").textContent(), /No matching/);
  await page.locator("#librarySearch").fill("");
  const card = page.locator(".situation-card").first();
  await card.locator("summary").click();
  assert.equal(
    await card.getByRole("button", { name: "Move", exact: true }).isVisible(),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await card.locator("details").evaluate((e) => e.open), false);
  assert.equal(
    await card.locator("summary").evaluate((e) => e === document.activeElement),
    true,
  );
  await card.locator("summary").click();
  await card.getByRole("button", { name: "Move", exact: true }).click();
  await page.locator("#organizeDialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".creation-menu summary").click();
  await page.locator("#openImport").click();
  await page.locator("#importDialog[open]").waitFor();
  await page.keyboard.press("Escape");
  for (const width of [1440, 768, 600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
});

test("Reviews show current summaries, retain older runs and preserve explicit rerun input choice", async (t) => {
  const { page, requests } = await fixture(t);
  await page.locator("[data-page=reviews]").click();
  await page.locator(".review-history-card").first().waitFor();
  assert.equal(await page.locator(".review-history-card:visible").count(), 2);
  assert.equal(
    await page.locator(".review-history-card").getByRole("combobox").count(),
    0,
  );
  await page.locator(".review-older-runs > summary").click();
  assert.equal(await page.locator(".review-history-card:visible").count(), 3);
  const card = page.locator(".review-history-card").first();
  await card.locator(".review-run-options summary").click();
  await card.getByLabel("Rerun inputs").selectOption("library");
  await card.getByRole("button", { name: "Run again", exact: true }).click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  assert.equal(
    requests.find((r) => r.path === "/api/review-runs/rerun").body.inputs,
    "library",
  );
  await page.locator("[data-page=reviews]").click();
  const old = page.locator('[data-review-id="222222222222222222222222"]');
  await old.getByRole("button", { name: "Edit and run", exact: true }).click();
  await page.locator("#reviewEditDialog[open]").waitFor();
  assert.equal(await page.locator("#reviewEditKept input:checked").count(), 4);
  await page.keyboard.press("Escape");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
  await page.locator("[data-page=settings]").click();
  assert.equal(await page.locator("#runtimeSettings").isVisible(), false);
  await page.getByText("Runtime and checkout paths", { exact: true }).click();
  assert.equal(await page.locator("#runtimeSettings").isVisible(), true);
});

test("Settings, import and connection recovery remain available through the quieter interface", async (t) => {
  const { page, requests } = await fixture(t);
  await page.locator("#workspaceTools").click();
  await page.route(
    "http://desk.test/api/synchronize",
    (route) =>
      route.fulfill({
        status: 422,
        json: { error: "Test synchronization failure" },
      }),
    { times: 1 },
  );
  await page
    .getByLabel("Synchronize", { exact: true })
    .selectOption("api-clicks");
  await page.locator("#workspaceToolsDialog [data-dialog-error]").waitFor();
  assert.match(
    await page
      .locator("#workspaceToolsDialog [data-dialog-error]")
      .textContent(),
    /Test synchronization failure/,
  );
  await page.getByLabel("Synchronize", { exact: true }).selectOption("api");
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  assert.equal(
    requests.find((r) => r.path === "/api/synchronize").body.mode,
    "api",
  );
  await page.keyboard.press("Escape");
  await page.locator("[data-page=settings]").click();
  for (const show of [true, false]) {
    await page.locator("#showCheats").setChecked(show);
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.equal(await page.locator("#showCheats").isChecked(), show);
  }
  await page.locator(".brand").click();
  assert.equal(await page.locator("#comparePage").isVisible(), true);
  await page.locator("[data-page=situations]").click();
  await page.locator(".creation-menu > summary").click();
  await page.locator("#openImport").click();
  await page.locator("#kind").selectOption("replay");
  assert.equal(await page.locator("#decisionField").isVisible(), true);
  await page.keyboard.press("Escape");
  await page.route("http://desk.test/api/status", (route) => route.abort());
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "Disconnected",
  );
  await page.unroute("http://desk.test/api/status");
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "Connected",
  );
});

test("empty startup has one clear Start action and Layout saves omit the per-View selector", async (t) => {
  const { page } = await fixture(t, 0);
  await page.waitForFunction(
    () =>
      document.querySelector("#status").textContent ===
      "Start a View to choose a Situation.",
  );
  assert.equal(await page.locator("#reportElement").isDisabled(), true);
  assert.equal(await page.locator(".slot-footer:visible").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Start", exact: true }).count(),
    1,
  );
  // Add a loaded fixture in a separate context to exercise the Save form.
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await deskFixture(context, { views: 1 });
  const loaded = await context.newPage();
  await loaded.goto("http://desk.test/");
  await loaded.locator("#save").click();
  await loaded.locator("#saveKind").selectOption("setup");
  assert.equal(await loaded.locator("#saveFrom").isVisible(), false);
  await loaded.locator("#saveKind").selectOption("situation");
  assert.equal(await loaded.locator("#saveFrom").isVisible(), true);
});


test("agentic Runs are hidden by default, labeled when shown and excluded from counts", async (t) => {
 const {page}=await fixture(t,1);
 const human={id:"b".repeat(24),reviewId:"a".repeat(24),name:"Human checks",createdAt:"2026-10-22T10:00:00Z",status:"ended",total:1,visited:1,reports:0,position:1,reportedSituations:0,views:1,reportKinds:{},url:"/reports/test"};
 const agent={...human,id:"c".repeat(24),performedBy:"agent",createdAt:"2026-10-23T10:00:00Z"};
 const agentOnly={...agent,id:"e".repeat(24),reviewId:"d".repeat(24),name:"Agent only"};
 await page.context().route("**/api/reviews",route=>route.fulfill({json:{reviews:[{id:human.reviewId,runs:[agent,human]},{id:agentOnly.reviewId,runs:[agentOnly]}],warnings:[]}}));
 await page.locator('[data-page="reviews"]').click();await page.locator('.review-history-card').first().waitFor();
 assert.equal(await page.locator('.review-history-card').count(),1);assert.equal(await page.locator('#reviewHistoryCount').textContent(),"1");assert.equal(await page.locator('.review-older-runs').count(),0);
 await page.getByLabel('Show agentic reviews').check();assert.equal(await page.locator('.review-history-card').count(),3);assert.equal(await page.locator('#reviewHistoryCount').textContent(),"2");assert.equal(await page.locator('[data-performed-by=agent]').count(),2);assert.match(await page.locator('[data-performed-by=agent] h3').first().textContent(),/Agentic review/);
 await page.getByLabel('Show agentic reviews').uncheck();assert.equal(await page.locator('.review-history-card').count(),1);
});
