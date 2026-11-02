// Owned desk only: actual phone navigation, socket replacement and planning actions.
import assert from "node:assert/strict";
import { startDesk } from "../src/desk.mjs";
import { PORTS } from "../src/config.mjs";
import { showPane } from "../src/presentation.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
async function api(name, body) {
  const response = await fetch(origin + "/api/" + name, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
try {
  const slot = {
    source: "live",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: true,
  };
  const device = await api("device-open", {
    situationId: "a00000000001",
    slot,
    bots: {},
    independent: true,
  });
  const session = [...app.devices.sessions.values()][0];
  const game = session.clone.game_id;
  const context = await app.comparison.browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const phoneURL = new URL(device.localURL);
  phoneURL.hostname = "127.0.0.1";
  await page.goto(phoneURL.href, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page
    .locator("#goa2-device-report")
    .waitFor({ state: "attached", timeout: 90000 });
  for (let i = 0; i < 5; i++) {
    console.log(`Checking phone reload ${i + 1}/5...`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        window.__GOA2_LAB_STATE__?.view &&
        document.body.innerText.includes("Arien (You)") &&
        !document.body.innerText.includes("DISCONNECTED"),
      null,
      { timeout: 8000 },
    );
  }
  await showPane(page, "hand", slot);
  await page.locator("[data-lab-card]:visible").first().tap();
  await page.getByRole("button", { name: /^Commit/ }).tap();
  await page.waitForFunction(
    () =>
      window.__GOA2_DEVICE__?.config.seat === "hero_hanu" &&
      document.body.innerText.includes("Hanu (You)") &&
      !document.body.innerText.includes("DISCONNECTED"),
    null,
    { timeout: 10000 },
  );
  assert.equal(session.clone.game_id, game);
  const wire = await app.comparison.api(
    `/games/${game}/bot-state`,
    undefined,
    "GET",
  );
  assert.deepEqual(
    Object.keys(JSON.parse(wire.checkpoint_json).state.pending_inputs),
    ["hero_arien"],
  );
  await page.screenshot({
    path: ".layout-lab/device-autoswitch-after-commit.png",
  });
  console.log(
    "PASS five phone reloads, initial state within 8 seconds, actual planning commit auto-switches to Hanu on the same game",
  );
  await context.close();
} finally {
  await app.close();
}
