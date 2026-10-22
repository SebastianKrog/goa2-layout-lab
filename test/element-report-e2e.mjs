// Owns an isolated desk. Set distinct GOA2_LAB_*_PORT values before running.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startDesk } from "../desk.mjs";
import { DATA, PORTS, STARTUP } from "../config.mjs";
const native = STARTUP.display === "embedded";
const app = await startDesk({
  flags: new Set([
    "--verification",
    "--no-open",
    ...(!native ? ["--headless"] : []),
  ]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
const out = path.join(
  DATA,
  "reviews/element-reports",
  native ? "native" : "browser",
);
await fs.mkdir(out, { recursive: true });
async function api(name, body) {
  const r = await fetch(origin + "/api/" + name, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  assert.ok(r.ok, JSON.stringify(v));
  return v;
}
async function until(fn, message) {
  for (let n = 0; n < 300; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(message);
}
let viewerBrowser;
try {
  if (native) await app.comparison.desktop.open(origin, true);
  const slot = {
    source: "live",
    seat: "hero_arien",
    profile: "portrait",
    layout: "mobile",
    render: "2d",
  };
  await api("load", {
    situationId: "a00000000001",
    restoreViews: false,
    slots: [slot, { ...slot, label: "Second view" }],
  });
  const desk = native
    ? app.comparison.desktop.root
    : await app.comparison.browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
  if (!native) await desk.goto(origin);
  await desk.locator(".slot").nth(1).waitFor();
  await until(async () => !(await api("status")).busy, "Desk remained busy");
  const errors = [];
  desk.on("pageerror", (e) => errors.push(e.message));
  const before = (await api("views")).map((v) => v.state.hash);
  const source = app.comparison.window(0).page;
  const point = await source.evaluate(() => {
    const picker = window.__GOA2_ELEMENT_PICKER__;
    for (const div of document.querySelectorAll("div")) {
      const r = div.getBoundingClientRect(),
        text = (div.textContent || "").trim();
      if (
        !div.checkVisibility() ||
        div.querySelector("div") ||
        !text ||
        text.length > 180 ||
        r.width < 70 ||
        r.width > 360 ||
        r.height < 20 ||
        r.height > 140 ||
        r.left < 0 ||
        r.top < 0 ||
        r.right > innerWidth ||
        r.bottom > innerHeight
      )
        continue;
      if (picker.resolve(picker.describe(div), false).error) continue;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text };
    }
    return null;
  });
  assert.ok(point, "No suitable visible game div");
  await desk.locator("#reportElement").click();
  await until(
    () => source.evaluate(() => window.__GOA2_ELEMENT_PICKER__.active),
    "Picker inactive",
  );
  for (const win of app.comparison.windows)
    assert.equal(
      await win.page.evaluate(() => window.__GOA2_ELEMENT_PICKER__.active),
      true,
    );
  if (native) {
    await source.mouse.move(point.x, point.y);
    await source.screenshot({ path: path.join(out, "picker.png") });
    await source.mouse.click(point.x, point.y);
  } else {
    await until(
      async () =>
        await desk.locator(".slot canvas").first().getAttribute("data-frames"),
      "Stream not ready",
    );
    const canvas = desk.locator(".slot canvas").first(),
      box = await canvas.boundingBox();
    const x = box.x + (point.x * box.width) / 390,
      y = box.y + (point.y * box.height) / 844;
    await desk.mouse.move(x, y);
    await until(
      () => source.locator("[data-lab-element-overlay]").isVisible(),
      "Mobile-profile stream did not highlight on hover",
    );
    await desk.screenshot({ path: path.join(out, "picker.png") });
    await desk.mouse.click(x, y);
  }
  await desk
    .locator("#elementReportDialog")
    .waitFor({ state: "visible", timeout: 120000 });
  await desk
    .locator("#elementReportComment")
    .fill(
      `QA ${native ? "native" : "browser"}: selected div report across both views`,
    );
  await desk.locator("#elementReportComment").press("Enter");
  await until(
    async () => !!(await api("element-report/status")).lastReport,
    "Report was not saved",
  );
  const saved = (await api("element-report/status")).lastReport;
  const report = JSON.parse(
    await fs.readFile(
      path.join(DATA, "reports", saved.id, "report.json"),
      "utf8",
    ),
  );
  assert.equal(report.views.length, 2);
  for (const view of report.views) {
    assert.equal(view.error, undefined, view.error);
    for (const key of [
      "image",
      "html",
      "computedCSS",
      "matchedCSS",
      "styles",
      "situation",
      "presentation",
    ])
      assert.ok(view.files[key], key);
    assert.match(view.revision.commit, /^[a-f0-9]{40}$/);
    const html = await fs.readFile(
      path.join(DATA, "reports", saved.id, view.files.html),
      "utf8",
    );
    assert.doesNotMatch(html, /data-lab-element-overlay/);
  }
  assert.deepEqual(
    (await api("views")).map((v) => v.state.hash),
    before,
    "Picking must not submit a game action",
  );
  const entry = (await api("catalog")).situations.find(
    (s) => s.id === saved.situationId,
  );
  assert.equal(entry.provenance.report, saved.id);
  assert.deepEqual(errors, []);
  viewerBrowser = await chromium.launch({ headless: true });
  const viewer = await viewerBrowser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  await viewer.goto(origin + saved.url);
  await viewer.locator("img").nth(1).waitFor();
  await viewer.screenshot({
    path: path.join(out, "report.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        native,
        report: saved.id,
        views: report.views.length,
        sourceDiv: point.text,
        noGameActions: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${native ? "native" : "browser"} picker, all-view report, Enter submission, revision/checkpoint exports and unchanged games`,
  );
} finally {
  await viewerBrowser?.close();
  await app.close();
}
