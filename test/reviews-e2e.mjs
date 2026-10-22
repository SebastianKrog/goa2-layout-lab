// Owns its desk. Run with distinct GOA2_LAB_*_PORT values on Windows.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startDesk } from "../desk.mjs";
import { DATA, PORTS } from "../config.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const c = app.comparison,
  origin = `http://127.0.0.1:${PORTS.desk}`;
const out = path.join(DATA, "reviews", "review-workflow");
await fs.mkdir(out, { recursive: true });
async function api(name, body, ok = true) {
  const r = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  assert.equal(r.ok, ok, JSON.stringify(v));
  return v;
}
async function until(fn, label = "Review condition") {
  for (let n = 0; n < 600; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(label);
}
let diagnosticPage;
try {
  const catalog = await c.api("/situations", undefined, "GET");
  const entries = [];
  const group = "review-qa/" + Date.now();
  for (const [source, seat, pane] of [
    ["a00000000001", "hero_arien", "heroes"],
    ["09fa8b1ac243", "hero_snorri", "hand"],
  ]) {
    const s = structuredClone(catalog.find((s) => s.id === source));
    delete s.checkpoint; // Clone the exact Python-owned Decision State by reference.
    s.provenance = { kind: "review-qa" };
    s.presentation = {
      schema: 2,
      viewpoint: seat,
      sessionState: { render: "2d", pane },
      userState: {},
    };
    const saved = await api("import", {
      content: s,
      name: `QA review ${entries.length + 1} ${pane} ${Date.now()}`,
    });
    await api("organize", { id: saved.id, group, shared: false });
    entries.push(saved);
  }
  const slots = [0, 1].map(() => ({
    source: "live",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
  }));
  await api("load", { situationId: entries[0].id, slots });
  const desk = await c.browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  diagnosticPage = desk;
  const errors = [];
  desk.on("pageerror", (e) => errors.push(e.message));
  await desk.goto(origin);
  await desk.locator('[data-page="situations"]').click();
  await until(
    () => desk.locator(`#libraryGroup option[value="${group}"]`).count(),
    "Library folder catalog did not initialize",
  );
  await desk.locator("#libraryGroup").selectOption(group);
  assert.equal(await desk.locator("#library input[type=checkbox]").count(), 2);
  await desk.locator("#library input[type=checkbox]").first().check();
  assert.equal(
    await desk
      .locator("#reviewSelectFiltered")
      .evaluate((e) => e.indeterminate),
    true,
  );
  // Hidden selections survive changing filters; bulk toggles affect only the filter.
  await desk.locator("#libraryOrigin").selectOption("library");
  assert.equal(await desk.locator("#library input[type=checkbox]").count(), 0);
  assert.match(
    await desk.locator("#reviewSelectedCount").textContent(),
    /^1 selected/,
  );
  await desk.locator("#libraryOrigin").selectOption("local");
  await desk.locator("#reviewSelectFiltered").check();
  assert.match(
    await desk.locator("#reviewSelectedCount").textContent(),
    /^2 selected/,
  );
  await desk.locator("#reviewSelectFiltered").uncheck();
  assert.match(
    await desk.locator("#reviewSelectedCount").textContent(),
    /^0 selected/,
  );
  await desk.locator("#reviewSelectFiltered").check();
  await desk.locator("#reviewName").fill("QA review workflow");
  await desk.locator("#reviewStart").click();
  await until(async () => {
    const s = await api("status");
    return !s.busy && s.reviewRun?.active;
  });
  let review = (await api("status")).reviewRun;
  assert.equal(review.total, 2);
  assert.equal(review.index, 0);
  await desk.locator("#reviewBar").waitFor();
  assert.equal(await desk.locator("#reviewPrevious").isDisabled(), true);
  assert.ok(c.windows.every((w) => w.config.seat === "hero_arien"));
  for (const w of c.windows)
    assert.equal(
      await w.page.locator("[data-pane=heroes][aria-pressed=true]").count(),
      1,
    );
  const device = await api("device-open", {
    situationId: entries[1].id,
    slot: slots[0],
    bots: {},
  });
  const phone = await c.browser.newPage({
    viewport: { width: 378, height: 781 },
    hasTouch: true,
  });
  await phone.goto(device.localURL);
  const bubble = phone.locator("#goa2-device-report");
  await bubble
    .getByRole("button", { name: "Next situation", exact: true })
    .waitFor({ timeout: 120000 });
  assert.equal(
    await bubble
      .getByRole("button", { name: "Previous situation", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await phone.locator("[data-pane=heroes][aria-pressed=true]").count(),
    1,
  );
  const firstPhoneGame = new URL(phone.url()).pathname;
  // Existing element reporting captures both views into the review's collection.
  await api("element-report/mode", { enabled: true });
  const source = c.windows[0];
  const descriptor = await source.page.evaluate(() =>
    window.__GOA2_ELEMENT_PICKER__.describe(
      document.querySelector('[aria-label="Match overview"]'),
    ),
  );
  await c.reporter.select(source, descriptor);
  assert.match(
    (
      await api(
        "review-runs/step",
        { id: review.id, index: 0, direction: 1 },
        false,
      )
    ).error,
    /report/,
  );
  await desk.locator("#elementReportDialog[open]").waitFor();
  await desk
    .locator("#elementReportComment")
    .fill("QA review element across both views");
  await desk.locator("#elementReportComment").press("Enter");
  await until(async () => !!(await api("element-report/status")).lastReport);
  await desk.locator("#elementReportDialog").waitFor({ state: "hidden" });
  const element = (await api("element-report/status")).lastReport;
  assert.ok(
    element.url.startsWith(`/reports/reviews/${review.id}/reports/element-`),
  );
  const capture = await api("capture", { indexes: [0, 1] });
  assert.ok(capture.url.startsWith(`/reports/reviews/${review.id}/reports/`));
  const extracted = await api("extract", {
    indexes: [0, 1],
    mode: "element",
    selector: '[aria-label="Match overview"]',
  });
  assert.ok(
    extracted.url.startsWith(`/reports/reviews/${review.id}/reports/source-`),
  );
  // Phone capture, close/resume and draft guard.
  await bubble
    .getByRole("button", { name: "Report testing issue", exact: true })
    .click();
  await bubble.locator("textarea").fill("QA phone report within review");
  await until(
    () =>
      bubble
        .getByRole("button", { name: "Save report", exact: true })
        .isEnabled(),
    "Phone screenshot unavailable",
  );
  await bubble.getByRole("button", { name: "Close", exact: true }).click();
  assert.match(
    (
      await api(
        "review-runs/step",
        { id: review.id, index: 0, direction: 1 },
        false,
      )
    ).error,
    /device/,
  );
  await bubble
    .getByRole("button", { name: "Report testing issue", exact: true })
    .click();
  assert.equal(
    await bubble.locator("textarea").inputValue(),
    "QA phone report within review",
  );
  await bubble
    .getByRole("button", { name: "Save report", exact: true })
    .click();
  await bubble.getByRole("button", { name: "Done", exact: true }).waitFor();
  await bubble.getByRole("button", { name: "Done", exact: true }).click();
  await bubble
    .getByRole("button", { name: "Next situation", exact: true })
    .click();
  await until(async () => {
    const s = await api("status");
    return !s.busy && s.reviewRun?.index === 1;
  });
  await phone.waitForURL((url) => url.pathname !== firstPhoneGame, {
    timeout: 120000,
  });
  await phone
    .locator("[data-pane=hand][aria-pressed=true]")
    .waitFor({ timeout: 120000 });
  await phone
    .locator("#goa2-device-report")
    .getByRole("button", { name: "Next situation", exact: true })
    .waitFor();
  assert.equal(
    await phone
      .locator("#goa2-device-report")
      .getByRole("button", { name: "Next situation", exact: true })
      .isDisabled(),
    true,
  );
  assert.ok(
    c.windows.every(
      (w) => w.config.seat === "hero_snorri" && w.config.source === "live",
    ),
  );
  for (const w of c.windows)
    assert.equal(
      await w.page.locator("[data-pane=hand][aria-pressed=true]").count(),
      1,
    );
  await desk.screenshot({ path: path.join(out, "desk.png") });
  await phone.screenshot({ path: path.join(out, "phone.png") });
  await until(() => desk.locator("#reviewPrevious").isEnabled());
  await desk.locator("#reviewPrevious").click();
  await until(async () => {
    const s = await api("status");
    return !s.busy && s.reviewRun.index === 0;
  });
  const revision = [...app.devices.sessions.values()][0].revision;
  await phone.waitForFunction(
    (revision) =>
      window.__GOA2_DEVICE__?.revision === revision &&
      window.__GOA2_DEVICE__?.config.seat === "hero_arien",
    revision,
    { timeout: 30000 },
  );
  await phone
    .locator("[data-pane=heroes][aria-pressed=true]")
    .waitFor({ timeout: 120000 });
  assert.ok(c.windows.every((w) => w.config.seat === "hero_arien"));
  await until(() => desk.locator("#reviewEnd").isEnabled());
  await desk.locator("#reviewEnd").click();
  await until(async () => !(await api("status")).reviewRun.active);
  const folder = path.join(DATA, "reports", "reviews", review.id);
  const manifest = JSON.parse(
    await fs.readFile(path.join(folder, "review.json"), "utf8"),
  );
  assert.equal(manifest.reports.length, 4);
  assert.ok(
    manifest.reports.every(
      (r) => r.index === 0 && r.situationId === entries[0].id,
    ),
  );
  for (const r of manifest.reports) {
    assert.equal((await fetch(origin + r.url)).status, 200);
    const relative = r.url
      .slice("/reports/".length)
      .replace(
        "/index.html",
        r.kind === "html-css" ? "/comparison.json" : "/report.json",
      );
    const saved = JSON.parse(
      await fs.readFile(path.join(DATA, "reports", relative), "utf8"),
    );
    assert.equal(saved.review.id, review.id);
  }
  assert.equal((await app.devices.status())[0].id, device.id);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        reviewId: review.id,
        entries: entries.map((e) => e.id),
        reports: manifest.reports,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Review workflow acceptance passed:", folder);
} catch (error) {
  if (diagnosticPage) {
    await fs.writeFile(
      path.join(out, "failure.txt"),
      await diagnosticPage.locator("body").innerText(),
    );
    await diagnosticPage.screenshot({ path: path.join(out, "failure.png") });
  }
  throw error;
} finally {
  await app.close();
}
