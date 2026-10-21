// Run against your running lab; creates independent clones and leaves one QR ready.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { DATA, PORTS } from "../config.mjs";
import { showPane } from "../presentation.mjs";
const origin = `http://127.0.0.1:${PORTS.desk}`;
const out = path.join(DATA, "reviews/device-bots");
await fs.mkdir(out, { recursive: true });
async function api(route, body) {
  const response = await fetch(origin + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
const browser = await chromium.launch({ headless: true });
const checks = [];
let active, currentPhone;
try {
  const desk = await browser.newPage({
    viewport: { width: 1200, height: 1100 },
  });
  await desk.goto(origin);
  await desk
    .locator('#situation option[value="a00000000001"]')
    .waitFor({ state: "attached" });
  await desk.locator("#situation").selectOption("a00000000001");
  await desk.locator("#openDevice").click();
  await desk.locator("#deviceBots").waitFor();
  await desk.locator("#deviceSource").selectOption("live");
  await desk.locator("#deviceSeat").selectOption("hero_arien");
  for (const kind of ["random", "heuristic"]) {
    console.log(`Checking ${kind} bot phone play`);
    await desk.locator("#deviceBotPreset").selectOption(kind);
    const before = new Set((await api("device/views")).map((v) => v.id));
    await desk
      .getByRole("button", { name: "Start device website", exact: true })
      .click();
    await desk.locator("#deviceLink").waitFor({ timeout: 240000 });
    const url = await desk.locator("#deviceURL").getAttribute("href");
    active = (await api("device/views")).find((v) => !before.has(v.id));
    assert.ok(active);
    assert.equal(Object.keys(active.bots).length, 3);
    assert.ok(Object.values(active.bots).every((value) => value === kind));
    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    currentPhone = phone;
    const errors = [];
    phone.on("pageerror", (e) => errors.push(e.message));
    await phone.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await phone
      .getByRole("button", { name: "Report testing issue" })
      .waitFor({ timeout: 90000 });
    await phone.waitForFunction(
      () => {
        const teams = window.__GOA2_LAB_STATE__?.view?.teams;
        return (
          teams &&
          Object.values(teams)
            .flatMap((t) => t.heroes)
            .filter((h) => h.id !== "hero_arien")
            .every((h) => h.current_turn_card)
        );
      },
      null,
      { timeout: 20000 },
    );
    const own = await phone.evaluate(() =>
      Object.values(window.__GOA2_LAB_STATE__.view.teams)
        .flatMap((t) => t.heroes)
        .find((h) => h.id === "hero_arien"),
    );
    assert.equal(own.current_turn_card, null);
    await phone.screenshot({ path: path.join(out, `${kind}-planning.png`) });
    console.log(`${kind}: bots committed; human hand remains manual`);
    await showPane(phone, "hand", active.config);
    const card = phone.locator("[data-lab-card]:visible").first();
    await card.tap();
    await phone.getByRole("button", { name: /^Commit/ }).tap();
    await phone.waitForFunction(
      () => window.__GOA2_LAB_STATE__?.view?.phase !== "PLANNING",
      null,
      { timeout: 20000 },
    );
    await phone.screenshot({
      path: path.join(out, `${kind}-after-commit.png`),
    });
    const state = await phone.evaluate(() => ({
      phase: window.__GOA2_LAB_STATE__.view.phase,
      decision: window.__GOA2_LAB_STATE__.input_request?.type || null,
    }));
    assert.deepEqual(errors, []);
    checks.push({ kind, ...state, bots: active.bots, human: "hero_arien" });
    await phone.close();
    await api("device-stop", { id: active.id });
    active = null;
    await desk.evaluate(() => {
      document.querySelector("#deviceLink").hidden = true;
    });
  }
  // Leave an untouched planning clone for the user, with the QR dialog visible.
  await desk.locator("#deviceBotPreset").selectOption("random");
  await desk
    .getByRole("button", { name: "Start device website", exact: true })
    .click();
  await desk.locator("#deviceLink").waitFor({ timeout: 120000 });
  await desk.waitForFunction(
    () => !document.querySelector("#deviceForm button[type=submit]").disabled,
  );
  const readyURL = await desk.locator("#deviceURL").getAttribute("href");
  const ready = (await api("device/views")).find((v) => v.urls[0] === readyURL);
  await fs.writeFile(
    path.join(out, "qr.png"),
    Buffer.from(ready.qr.split(",")[1], "base64"),
  );
  await desk
    .locator("#deviceDialog")
    .screenshot({ path: path.join(out, "qr-dialog.png") });
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify({ checks, readyId: ready.id, url: readyURL }, null, 2),
  );
  console.log(JSON.stringify({ checks, readyId: ready.id, evidence: out }));
} catch (error) {
  if (currentPhone && !currentPhone.isClosed()) {
    await currentPhone
      .screenshot({ path: path.join(out, "failure.png") })
      .catch(() => {});
    console.log(
      await currentPhone
        .locator("body")
        .innerText()
        .catch(() => "No rendered page"),
    );
  }
  if (active) await api("device-stop", { id: active.id }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
