// Browser UI regression checks. Mutations are mocked in this browser context;
// the developer's open game windows and saved situations remain untouched.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { DATA, TOOL, PORTS, STARTUP } from "../config.mjs";

const origin = `http://localhost:${PORTS.desk}`;
const catalog = await (await fetch(origin + "/api/catalog")).json();
let state = await (await fetch(origin + "/api/status")).json();
catalog.settings ||= {
  ...STARTUP,
  backend: "../goa2-backend",
  patch: "../goa2-mobile-2d-patch",
};
state.synchronization = {
  mode: "none",
  cheats: false,
  pending: 0,
  error: null,
  skipped: 0,
};
catalog.situations ||= catalog.scenarios; // Existing desk can stay open while these UI files are verified.
state.situationId ||= state.scenarioId;
for (const s of catalog.situations) {
  s.origin ||= "local";
  s.group ||= "";
}
catalog.situations.push({
  id: "ui-folder-fixture",
  name: "Snorri rune selection",
  origin: "library",
  group: "heroes/snorri",
  summary: { phase: "RESOLUTION", round: 2, decision: "SELECT_OPTION" },
  presentations: {},
});
const actions = [];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1512, height: 1050 },
  });
  await context.route(origin + "/", (route) =>
    route.fulfill({
      path: path.join(TOOL, "public/index.html"),
      contentType: "text/html",
    }),
  );
  await context.route("**/desk.mjs", (route) =>
    route.fulfill({
      path: path.join(TOOL, "public/desk.mjs"),
      contentType: "text/javascript",
    }),
  );
  await context.route("**/desk.css", (route) =>
    route.fulfill({
      path: path.join(TOOL, "public/desk.css"),
      contentType: "text/css",
    }),
  );
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    if (pathname === "/api/catalog") return route.fulfill({ json: catalog });
    if (pathname === "/api/status") return route.fulfill({ json: state });
    if (pathname === "/api/preview") return route.continue();
    const body = request.postDataJSON();
    actions.push({ pathname, body });
    if (pathname === "/api/synchronize") state.synchronization.mode = body.mode;
    if (pathname === "/api/cheats") state.synchronization.cheats = body.show;
    if (pathname === "/api/live")
      for (const w of state.windows)
        if (["comparator", "live"].includes(w.config.source))
          w.config.source = body.enabled ? "live" : "comparator";
    if (pathname === "/api/configure")
      state.windows[body.index].config = {
        ...state.windows[body.index].config,
        ...body.update,
      };
    if (pathname === "/api/organize") {
      const original = catalog.situations.find((s) => s.id === body.id);
      const result = {
        ...original,
        group: body.group,
        origin: body.shared ? "library" : "local",
      };
      if (original.origin === "local" && body.shared) {
        result.id = "ui-promoted-fixture";
        catalog.situations.push(result);
      } else Object.assign(original, result);
      return route.fulfill({ json: result });
    }
    if (pathname === "/api/preset") catalog.presets[body.name] = body.slots;
    return route.fulfill({ json: state });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForSelector(".slot");
  assert.equal(await page.locator("h1:visible").textContent(), "Compare");
  assert.equal(await page.locator(".slot").count(), state.windows.length);
  assert.equal(
    await page.locator(".slot select").count(),
    state.windows.length,
    "Only viewport scale belongs on the view card",
  );
  assert.equal(await page.locator("#settingsPage").isVisible(), false);
  for (const mode of ["api", "api-clicks", "none"]) {
    await page.getByLabel("Synchronize", { exact: true }).selectOption(mode);
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.ok(
      actions.some(
        (a) => a.pathname === "/api/synchronize" && a.body.mode === mode,
      ),
    );
    assert.equal(await page.locator("#synchronize").inputValue(), mode);
  }
  for (const enabled of [true, false]) {
    await page.locator("#liveUpdates").setChecked(enabled);
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.ok(
      actions.some(
        (a) => a.pathname === "/api/live" && a.body.enabled === enabled,
      ),
    );
    assert.equal(await page.locator("#liveUpdates").isChecked(), enabled);
  }

  await page
    .locator(".slot")
    .first()
    .getByRole("button", { name: "Edit view", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("View name", { exact: true })
    .fill("Arien / close camera");
  await page
    .getByRole("dialog")
    .getByLabel("Device", { exact: true })
    .selectOption("landscape");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  assert.ok(
    actions.some(
      (a) =>
        a.pathname === "/api/configure" &&
        a.body.update.profile === "landscape",
    ),
  );
  assert.equal(
    await page.locator(".slot").first().locator("h3").textContent(),
    "Arien / close camera",
  );
  await page.locator("#preset").selectOption("3D regression");
  assert.equal(await page.locator(".slot").count(), 2);
  assert.equal(await page.locator("#restore").isChecked(), false);
  await page.locator("#count").selectOption("3");
  assert.equal(
    await page.getByRole("checkbox", { name: "Include in capture" }).count(),
    3,
  );
  await page.getByRole("button", { name: /^Situations/ }).click();
  assert.equal(
    await page.locator(".situation-card").count(),
    catalog.situations.length,
  );
  await page.locator("#libraryGroup").selectOption("heroes");
  assert.equal(
    await page.locator(".situation-card").count(),
    1,
    "Folder includes nested situations",
  );
  await page.locator("#libraryGroup").selectOption("");
  await page.locator("#libraryOrigin").selectOption("local");
  const firstDraft = catalog.situations.find((s) => s.origin === "local");
  await page
    .locator(".situation-card")
    .first()
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.locator("#organizeGroup").fill("heroes/arien/decisions");
  await page.locator("#organizeSubmit").click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  assert.ok(
    actions.some(
      (a) =>
        a.pathname === "/api/organize" &&
        a.body.id === firstDraft.id &&
        a.body.group === "heroes/arien/decisions" &&
        a.body.shared,
    ),
  );
  assert.ok(
    catalog.situations.some(
      (s) => s.id === firstDraft.id && s.origin === "local",
    ),
  );
  await page.locator("#libraryOrigin").selectOption("library");
  await page.locator("#libraryGroup").selectOption("heroes/arien");
  assert.equal(await page.locator(".situation-card").count(), 1);
  await page
    .locator(".situation-card")
    .first()
    .getByRole("button", { name: "Move", exact: true })
    .click();
  await page.locator("#organizeGroup").fill("cards/action-selection");
  await page.locator("#organizeSubmit").click();
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  await page.locator("#libraryGroup").selectOption("");
  await page.locator("#libraryOrigin").selectOption("");
  assert.ok((await page.locator("#situation optgroup").count()) >= 2);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Library fits " + width,
    );
  }
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.screenshot({
    path: path.join(DATA, "situation-library-preview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#kind").selectOption("replay");
  assert.equal(await page.locator("#decisionField").isVisible(), true);
  await page.getByRole("button", { name: "Close import dialog" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(await page.locator("#refs input").count(), 0);
  for (const show of [true, false]) {
    await page.locator("#showCheats").setChecked(show);
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.ok(
      actions.some((a) => a.pathname === "/api/cheats" && a.body.show === show),
    );
    assert.equal(await page.locator("#showCheats").isChecked(), show);
  }

  assert.ok(
    (await page.locator("#settingsPage").textContent()).includes(
      "GOA2_LAB_BASE_REF",
    ),
  );
  await page
    .getByRole("button", { name: /^.*Compare/ })
    .first()
    .click();
  // Reconnection after an interrupted request must restore the workspace.
  await page.route("**/api/status", (route) => route.abort());
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "Disconnected",
  );
  await page.unroute("**/api/status");
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "Connected",
  );
  // Initial catalog failure must retry as well.
  const retry = await context.newPage();
  await retry.route("**/api/catalog", (route) => route.abort());
  await retry.goto(origin);
  await retry.waitForFunction(
    () => document.querySelector("#connection").textContent === "Disconnected",
  );
  await retry.unroute("**/api/catalog");
  await retry.waitForSelector(".slot");
  await retry.close();
  await page.screenshot({
    path: path.join(DATA, "desk-preview.png"),
    fullPage: true,
  });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Horizontal overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({
    path: path.join(DATA, "desk-preview-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: simplified cards, edit flow, presets, library, startup settings, reconnection and responsive layout. No live games modified.",
  );
} finally {
  await browser.close();
}
