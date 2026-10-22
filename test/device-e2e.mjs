// Run against an owned Windows lab desk. Leaves one verified device link ready.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { DATA, PORTS } from "../config.mjs";
const origin = `http://127.0.0.1:${PORTS.desk}`;
const request = async (route, body) => {
  const response = await fetch(origin + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || "Lab request failed");
  return value;
};
const evidence = path.join(DATA, "reviews/device-testing");
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .locator('#situation option[value="e81bc3bd5fff"]')
    .waitFor({ state: "attached" });
  await page.locator("#situation").selectOption("e81bc3bd5fff");
  await page
    .getByRole("button", { name: "Open on device", exact: true })
    .first()
    .click();
  await page.getByRole("dialog", { name: "Open on device" }).waitFor();
  await page.locator("#deviceSource").selectOption("live");
  await page.locator("#deviceSeat").selectOption("hero_arien");
  console.log("Starting live device view from shared planning-card situation");
  await page.getByRole("button", { name: "Start device website" }).click();
  await page.locator("#deviceURL").waitFor({ timeout: 600000 });
  const url = await page.locator("#deviceURL").getAttribute("href");
  assert.ok(
    (await page.locator("#deviceQR").getAttribute("src")).startsWith(
      "data:image/png;base64,",
    ),
  );
  await page
    .getByRole("dialog", { name: "Open on device" })
    .screenshot({ path: path.join(evidence, "qr-dialog.png") });
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  phone.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("device error:", error.message);
  });
  await phone.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await phone
    .getByRole("button", { name: "Report testing issue" })
    .waitFor({ timeout: 90000 });
  assert.equal(
    await phone.evaluate(() => window.__GOA2_LAB_STATE__.view.phase),
    "PLANNING",
  );
  const selected = await phone
    .locator("[data-lab-card][data-lab-selected]")
    .first()
    .getAttribute("data-lab-card");
  assert.ok(selected, "saved planning selection restored");
  await phone.screenshot({
    path: path.join(evidence, "phone-with-report-button.png"),
  });
  console.log("Phone view and saved card selection restored; capturing report");
  await phone.getByRole("button", { name: "Report testing issue" }).click();
  await phone
    .getByRole("dialog", { name: "Report an issue or idea" })
    .waitFor({ timeout: 60000 });
  await phone
    .getByAltText("Captured game screen without reporting controls")
    .waitFor({ timeout: 60000 });
  const screenshot = await phone
    .getByAltText("Captured game screen without reporting controls")
    .getAttribute("src");
  await fs.writeFile(
    path.join(evidence, "phone-capture.png"),
    Buffer.from(screenshot.split(",")[1], "base64"),
  );
  await phone
    .getByRole("textbox")
    .fill(
      "Device acceptance: saved situation, phone screenshot and comment; reporting controls excluded.",
    );
  await phone.getByRole("button", { name: "Save report", exact: true }).click();
  const saved = phone
    .getByRole("status")
    .filter({ hasText: "Saved in layout lab" });
  await saved.waitFor({ timeout: 60000 });
  const id = (await saved.innerText()).match(/[a-f0-9]{12}/)[0];
  const catalog = await request("/api/catalog");
  const report = catalog.situations.find((s) => s.id === id);
  assert.equal(report.group, "device-reports");
  assert.equal(report.summary.phase, "PLANNING");
  const views = await request("/api/device/views");
  const original = views.find((v) => v.urls[0] === url);
  const reopened = await request("/api/device-open", {
    situationId: id,
    slot: original.config,

  });
  const replay = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await replay.goto(reopened.urls[0], {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await replay
    .getByRole("button", { name: "Report testing issue" })
    .waitFor({ timeout: 90000 });
  assert.equal(
    await replay
      .locator("[data-lab-card][data-lab-selected]")
      .first()
      .getAttribute("data-lab-card"),
    selected,
  );
  assert.deepEqual(
    await replay.evaluate(() => window.__GOA2_DEVICE_RESTORE_WARNINGS__),
    [],
  );
  await request("/api/device-stop", { id: reopened.id });
  await fs.writeFile(
    path.join(evidence, "acceptance.json"),
    JSON.stringify(
      {
        reportId: id,
        deviceViewId: original.id,
        selectedCard: selected,
        errors,
        reopened: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      reportId: id,
      selectedCard: selected,
      errors,
      reopened: true,
    }),
  );
} finally {
  await browser.close();
}
