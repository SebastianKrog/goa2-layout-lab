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
  await page
    .locator(views ? ".slot" : "#startScreen")
    .first()
    .waitFor();
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
  await card.locator(".situation-menu > summary").click();
  assert.equal(
    await card.getByRole("button", { name: "Move", exact: true }).isVisible(),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await card.locator(".situation-menu").evaluate((e) => e.open),
    false,
  );
  assert.equal(
    await card
      .locator(".situation-menu > summary")
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await card.locator(".situation-menu > summary").click();
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

test("empty startup offers quickstarts without Views and Layout saves omit the per-View selector", async (t) => {
  const { page } = await fixture(t, 0);
  await page.waitForFunction(
    () =>
      document.querySelector("#status").textContent ===
      "Choose a quickstart or a comparison Layout.",
  );
  assert.equal(await page.locator("#reportElement").isDisabled(), true);
  assert.equal(await page.locator(".slot-footer:visible").count(), 0);
  assert.equal(await page.locator("[data-quickstart]").count(), 3);
  assert.equal(await page.locator(".slot").count(), 0);
  assert.equal(await page.locator("[data-start-layout]").count(), 3);
  await page
    .locator('[data-start-layout="Mobile landscape · Main vs working tree"]')
    .click();
  assert.equal(await page.locator("#situation").inputValue(), "");
  assert.equal(await page.locator("#load").isDisabled(), true);
  assert.equal(await page.locator(".view-workspace").isVisible(), false);
  await page.locator("#situation").selectOption("a00000000001");
  assert.equal(await page.locator("#load").isEnabled(), true);
  await page.locator("#startOver").click();
  assert.equal(await page.locator("#startScreen").isVisible(), true);
  await page.locator("#customStart").click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.locator("#editor[open]").waitFor();
  await page
    .getByRole("button", { name: "Close view settings", exact: true })
    .click();
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

test("separate View windows keep local controls and follow replacement games", async (t) => {
  const { page, state } = await fixture(t, 2);
  const popupEvent = page.waitForEvent("popup");
  await page
    .locator('.slot[data-index="0"]')
    .getByRole("button", { name: "Open in window" })
    .click();
  const popup = await popupEvent;
  await popup.waitForSelector('[data-window-control="window"]');
  assert.equal(
    await popup.locator("#viewHeader .view-letter").textContent(),
    "A",
  );
  assert.equal(await page.locator('.slot[data-index="0"]').isVisible(), false);
  assert.ok(
    await page
      .locator('.slot[data-index="1"]')
      .evaluate(
        (card) =>
          card.getBoundingClientRect().width >=
          card.parentElement.clientWidth - 2,
      ),
  );
  assert.equal(
    await page.locator('.slot[data-index="0"]').getAttribute("class"),
    "slot detached",
  );
  assert.equal(
    await popup.getByRole("button", { name: "Return to lab" }).count(),
    1,
  );
  assert.equal(
    await popup.getByRole("button", { name: "Expand", exact: true }).count(),
    0,
  );
  await popup.getByRole("checkbox", { name: "Include in capture" }).uncheck();
  await page.waitForFunction(
    () => !document.querySelector('[data-capture-index="0"]').checked,
  );
  await popup
    .getByRole("combobox", { name: "Scale view A" })
    .selectOption("actual");
  await popup.waitForFunction(() =>
    document.querySelector(".live-stage").classList.contains("actual-size"),
  );
  await popup
    .getByRole("combobox", { name: "View A actions" })
    .selectOption({ label: "Swap with View B" });
  await page.waitForFunction(
    () => document.querySelector(".slot").dataset.index === "1",
  );
  assert.equal(
    await popup.getByRole("combobox", { name: "View A actions" }).inputValue(),
    "",
  );
  await popup.getByRole("button", { name: "Edit view" }).click();
  const editor = popup.frameLocator(".view-editor-frame");
  await editor.locator("#editor[open]").waitFor();
  assert.equal(await page.locator("#editor[open]").count(), 0);
  await editor.locator("#editor [data-close=editor]").last().click();
  await popup.locator(".view-editor-frame").waitFor({ state: "detached" });
  await popup.evaluate(() => {
    window.firstCanvas = document.querySelector("canvas");
  });
  state.windows[0].gameId = "replacement";
  await popup.waitForFunction(
    () => document.querySelector("canvas") !== window.firstCanvas,
  );
  assert.equal(
    await popup.getByRole("combobox", { name: "Scale view A" }).inputValue(),
    "actual",
  );
  await popup.getByRole("button", { name: "Return to lab" }).click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.slot[data-index="0"]')
        .classList.contains("detached"),
  );
  assert.ok(popup.isClosed());
  const next = page.waitForEvent("popup");
  await page
    .locator('.slot[data-index="1"]')
    .getByRole("button", { name: "Open in window" })
    .click();
  const second = await next;
  await second.waitForSelector('[data-window-control="window"]');
  await second.close();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.slot[data-index="1"]')
        .classList.contains("detached"),
  );
});

test("View action menus swap positions without changing identities or games", async (t) => {
  const { page, state, requests } = await fixture(t, 3);
  const original = structuredClone(state.windows);
  const order = () =>
    page
      .locator(".slot")
      .evaluateAll((cards) => cards.map((card) => Number(card.dataset.index)));
  await page.evaluate(() => {
    window.originalCanvas = document.querySelector(
      '.slot[data-index="0"] canvas',
    );
  });
  assert.deepEqual(await order(), [0, 1, 2]);
  const menu = page.getByRole("combobox", { name: "View A actions" });
  assert.deepEqual(await menu.locator("option").allTextContents(), [
    "More…",
    "Swap with View B",
    "Swap with View C",
  ]);
  await menu.selectOption({ label: "Swap with View C" });
  assert.deepEqual(await order(), [2, 1, 0]);
  assert.equal(await menu.inputValue(), "");
  assert.ok(
    await page.evaluate(
      () =>
        document.querySelector('.slot[data-index="0"] canvas') ===
        window.originalCanvas,
    ),
  );
  state.windows[1].config.label = "Updated B";
  await page
    .locator('.slot[data-index="1"] h3')
    .filter({ hasText: "Updated B" })
    .waitFor();
  assert.deepEqual(
    await order(),
    [2, 1, 0],
    "Status refresh preserves the arrangement",
  );
  await page
    .getByRole("combobox", { name: "View B actions" })
    .selectOption({ label: "Swap with View A" });
  assert.deepEqual(await order(), [2, 0, 1]);
  assert.deepEqual(
    state.windows.map((w) => w.gameId),
    original.map((w) => w.gameId),
  );
  assert.deepEqual(
    requests,
    [],
    "Position swaps never change server games/settings",
  );
});

test("View editors open before slow roster requests and detached editors reuse desk metadata", async (t) => {
  const { page } = await fixture(t, 2);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  t.after(() => release());
  await page.context().route("**/api/device/options?*", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        botKinds: ["random", "heuristic", "ismcts"],
        seats: ["hero_arien", "hero_hanu", "hero_brogan", "hero_tigerclaw"].map(
          (id) => ({ id, name: id }),
        ),
      },
    });
  });
  await page
    .locator('.slot[data-index="0"]')
    .getByRole("button", { name: "Edit view", exact: true })
    .click();
  await page.locator("#editor[open]").waitFor({ timeout: 1500 });
  await page.locator('#editor [data-close="editor"]').last().click();
  const next = page.waitForEvent("popup");
  await page
    .locator('.slot[data-index="0"]')
    .getByRole("button", { name: "Open in window" })
    .click();
  const popup = await next;
  await popup.getByRole("button", { name: "Edit view", exact: true }).waitFor();
  let catalogs = 0;
  await page.context().route("**/api/catalog", (route) => {
    catalogs++;
    return route.abort();
  });
  await popup.getByRole("button", { name: "Edit view", exact: true }).click();
  const frame = popup.frameLocator(".view-editor-frame");
  await frame.locator("#editor[open]").waitFor({ timeout: 2000 });
  assert.equal(
    catalogs,
    0,
    "Detached editor uses the existing catalog snapshot",
  );
  await frame.locator('#editor [data-close="editor"]').last().click();
  release();
  await popup.close();
});

test("Reports group sessions, show device datetime, and confirm deletion; session controls stay in Settings", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await deskFixture(context, { views: 1 });
  const items = [
    {
      id: "device/a",
      kind: "device",
      title: "Phone issue",
      comment: "Phone issue",
      url: "/reports/device/a/index.html",
      createdAt: "2026-10-22T13:20:00Z",
      views: [],
      context: {
        kind: "session",
        id: "session",
        name: "Phone test",
        startedAt: "2026-10-22T13:00:00Z",
      },
      archived: false,
    },
  ];
  const calls = [];
  await context.route("**/api/reports", (route) =>
    route.fulfill({
      json: {
        reports: items,
        warnings: [],
        currentSession: {
          name: "Phone test",
          startedAt: "2026-10-22T13:00:00Z",
        },
      },
    }),
  );
  await context.route("**/api/reports/manage", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "archive" || body.action === "archive-all")
      items.forEach((item) => (item.archived = true));
    if (body.action === "restore") items[0].archived = false;
    if (body.action === "delete" || body.action === "delete-archive")
      items.splice(0);
    await route.fulfill({ json: { ok: true } });
  });
  const page = await context.newPage();
  await page.goto("http://desk.test/");
  await page.locator('[data-page="reports"]').click();
  await page.locator(".report-card").waitFor();
  assert.equal(await page.locator(".report-group > h2").count(), 1);
  assert.match(
    await page.locator(".report-group > h2").textContent(),
    /Phone test/,
  );
  assert.equal(
    await page.locator(".report-card time").getAttribute("datetime"),
    items[0].createdAt,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "New session", exact: true })
      .isVisible(),
    false,
  );
  await page.getByLabel("Actions for report Phone issue").click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.locator(".report-card").waitFor({ state: "detached" });
  await page.locator("#reportStatus").selectOption("archived");
  await page.locator(".report-card").waitFor();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#reportsDeleteArchive").click();
  assert.equal(
    calls.filter((call) => call.action === "delete-archive").length,
    0,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#reportsDeleteArchive").click();
  await page.locator(".report-card").waitFor({ state: "detached" });
  await page.locator('[data-page="settings"]').click();
  await page.getByText("Reporting session", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "New session", exact: true })
      .isVisible(),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
});

test("Reviews use compact rows and offer archive/restore and confirmed deletion", async (t) => {
  const { page } = await fixture(t, 1);
  await page.locator(".review-history-card").first().waitFor({ state: "attached" });
  const review = {
    id: "a".repeat(24),
    name: "Planning checks",
    archived: false,
    runs: [
      {
        id: "b".repeat(24),
        reviewId: "a".repeat(24),
        reviewRevision: 1,
        name: "Planning checks",
        createdAt: "2026-10-22T10:00:00Z",
        status: "ended",
        total: 4,
        visited: 4,
        reports: 2,
        position: 4,
        reportedSituations: 2,
        views: 1,
        reportKinds: { device: 2 },
        url: "/reports/reviews/test/index.html",
      },
    ],
  };
  review.runs.unshift({ ...review.runs[0], id: "c".repeat(24), performedBy: "agent", createdAt: "2026-10-23T10:00:00Z" });
  let deleted = false;
  const requests = [];
  await page.context().route("**/api/reviews", (route) =>
    route.fulfill({
      json: { reviews: deleted ? [] : [review], warnings: [] },
    }),
  );
  await page.context().route("**/api/reviews/manage", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.action === "archive" || body.action === "archive-all")
      review.archived = true;
    if (body.action === "restore") review.archived = false;
    if (body.action === "delete" || body.action === "delete-archive")
      deleted = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.locator('[data-page="reviews"]').click();
  await page.locator(".review-history-card").first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".review-history-card").length === 1);
  assert.equal(await page.locator(".review-history-card").count(), 1);
  assert.equal(await page.locator("[data-performed-by=agent]").count(), 0);
  assert.equal(await page.locator("#reviewHistoryCount").textContent(), "1");
  assert.equal(await page.locator(".review-older-runs").count(), 0);
  await page.getByLabel("Show agentic reviews").check();
  assert.equal(await page.locator(".review-history-card").count(), 2);
  assert.match(await page.locator("[data-performed-by=agent] h3").textContent(), /Agentic review/);
  await page.getByLabel("Show agentic reviews").uncheck();
  assert.equal(await page.locator(".review-history-card").count(), 1);
  assert.ok(
    await page
      .locator(".review-history-card")
      .first()
      .evaluate((card) => card.getBoundingClientRect().height < 100),
  );
  await page
    .locator(".review-group-heading")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await page.locator(".review-history-card").waitFor({ state: "detached" });
  await page.locator("#reviewHistoryStatus").selectOption("archived");
  await page.locator(".review-history-card").waitFor();
  await page
    .locator(".review-group-heading")
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await page.locator(".review-history-card").waitFor({ state: "detached" });
  await page.locator("#reviewHistoryStatus").selectOption("active");
  await page.locator(".review-history-card").waitFor();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .locator(".review-group-heading")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  assert.ok(!requests.some((request) => request.action === "delete"));
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".review-group-heading")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.locator(".review-history-card").waitFor({ state: "detached" });
});

test("Layout and Situation are primary independent controls; Review setup owns optional per-inspection Presentation", async (t) => {
  const { page, requests, catalog } = await fixture(t, 1);
  assert.equal(await page.locator("#preset").isVisible(), true);
  assert.equal(await page.locator("#situation").isVisible(), true);
  await page
    .locator("#preset")
    .selectOption("Desktop vs mobile · Working tree");
  await page.locator("#inspectionPresentation").selectOption("template");
  const id = catalog.situations[1].id;
  await page.locator("#situation").selectOption(id);
  await page.locator("#load").click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  const body = requests.find((r) => r.path === "/api/load").body;
  assert.equal(body.situationId, id);
  assert.equal(body.slots.length, 2);
  assert.deepEqual(
    body.slots.map((s) => s.uiMode),
    ["desktop", "mobile"],
  );
  assert.equal(body.presentation.sessionState.pane, "hand");
  await page.locator("[data-page=situations]").click();
  await page.locator(".situation-select input").first().check();
  await page.locator("#reviewStart").click();
  await page.locator("#reviewSetupDialog[open]").waitFor();
  await page
    .getByRole("button", { name: "Add another inspection", exact: true })
    .click();
  const rows = page.locator("#reviewSetupEntries .review-entry-setup");
  assert.equal(await rows.count(), 2);
  await rows.nth(1).locator("select").first().selectOption("");
  await page.locator("#reviewSetupForm [type=submit]").click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  const start = requests.find((r) => r.path === "/api/review-runs/start").body;
  assert.equal(start.entries.length, 2);
  assert.equal(start.entries[0].situationId, start.entries[1].situationId);
  assert.equal(start.entries[0].presentation.sessionState.pane, "hand");
  assert.equal(start.entries[1].presentation, undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
});

test("specific cards are attached only to their Review inspection and do not modify the reusable preset", async (t) => {
  const { page, requests, catalog } = await fixture(t, 1);
  const before = JSON.stringify(catalog.presentations);
  await page.locator("[data-page=situations]").click();
  await page.locator(".situation-select input").first().check();
  await page.locator("#reviewStart").click();
  const row = page.locator("#reviewSetupEntries .review-entry-setup").first();
  await row.locator("select").first().selectOption("template");
  await row.locator("details summary").click();
  await row.locator("input").fill("noble_blade");
  await page.locator("#reviewSetupForm [type=submit]").click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  const entry = requests.find((r) => r.path === "/api/review-runs/start").body
    .entries[0];
  assert.equal(entry.presentation.sessionState.pane, "hand");
  assert.equal(entry.presentation.sessionState.inspectedCard, "noble_blade");
  assert.equal(JSON.stringify(catalog.presentations), before);
});
