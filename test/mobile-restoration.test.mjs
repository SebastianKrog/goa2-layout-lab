import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { DeviceServer } from "../device-server.mjs";
import { restorePresentation } from "../presentation.mjs";

const config = {
  source: "live",
  profile: "portrait",
  render: "2d",
  uiMode: "mobile",
  seat: "hero_arien",
};
const html = `<!doctype html><html><head></head><body>
<button data-lab-open-spells="hero_arien" onclick="document.querySelector('[data-lab-mobile-spells]').hidden=false">Spells</button>
<div data-lab-mobile-spells hidden><button data-lab-preview-spell="spell" onclick="document.querySelector('#parent').hidden=false">Preview</button>
<button id="parent" hidden data-lab-inspect-card="parent" onclick="document.querySelector('#parentPanel').hidden=false">Parent</button></div>
<div id="parentPanel" hidden data-lab-mobile-inspection="parent"><button data-lab-inspect-card="child" onclick="document.querySelector('#childPanel').hidden=false">Child</button></div>
<div data-decision-parent="decision"><button data-lab-inspect-card="child" onclick="document.querySelector('#childPanel').hidden=false">Decision child</button></div>
<div id="childPanel" hidden data-lab-mobile-inspection="child">Final inspection</div>
<script>window.__GOA2_LAB_STATE__={view:{phase:"PLANNING",teams:{}}};</script></body></html>`;

test("desktop and phone restore nested spell inspections and decision-context children from frozen input", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true });
  let saved;
  const calls = [];
  const devices = new DeviceServer(
    { frontend: async () => server.address().port },
    async (route, body) => {
      calls.push(route);
      if (route.startsWith("/review/snapshot?")) return structuredClone(saved);
      if (route.startsWith("/situations/"))
        throw Error("Mutable library must never be read");
      if (route === "/health") return {};
      if (route === "/clone")
        return {
          game_id: "frozen",
          seats: { hero_arien: "secret" },
          spectator_token: "watch",
        };
      return {};
    },
    { port: 0, hosts: () => ["127.0.0.1"] },
  );
  try {
    for (const decision of [false, true]) {
      const raw = decision
        ? {
            pane: "board",
            inspectionMobileContext: "decision",
            inspectionMobileParent: "decision",
            inspectionMobile: "child",
          }
        : {
            pane: "board",
            spellBrowserMobile: { heroId: "hero_arien", selectedId: "spell" },
            inspectionMobileParent: "parent",
            inspectionMobile: "child",
          };
      saved = {
        id: "frozen",
        name: "Frozen",
        checkpoint: {
          state: { teams: { RED: { heroes: [{ id: "hero_arien" }] } } },
        },
        presentation: {
          schema: 2,
          viewpoint: "hero_arien",
          sessionState: raw,
          userState: {},
        },
      };
      const desktop = await browser.newPage();
      await desktop.goto(`http://127.0.0.1:${server.address().port}`);
      assert.deepEqual(await restorePresentation(desktop, raw, config), []);
      assert.equal(await desktop.locator("#childPanel").isVisible(), true);
      const link = await devices.open({
        situationId: "frozen",
        slot: config,
        reviewSnapshot: { reviewId: "a".repeat(24), index: 0 },
      });
      assert.equal(link.config.seat, "hero_arien");
      assert.equal(
        (await devices.options("frozen", saved)).seats[0].id,
        "hero_arien",
      );
      const phone = await browser.newPage();
      await phone.goto(link.urls[0]);
      await phone.getByRole("button", {name:"Report testing issue"}).waitFor();
      assert.equal(await phone.locator("#childPanel").isVisible(), true);
      assert.deepEqual(
        await phone.evaluate(() => window.__GOA2_DEVICE_RESTORE_WARNINGS__),
        [],
      );
      await desktop.close();
      await phone.close();
      await devices.stop(link.id);
    }
    assert.equal(
      calls.filter((r) => r.startsWith("/review/snapshot?")).length,
      2,
    );
  } finally {
    await browser.close();
    await devices.close();
    await new Promise((r) => server.close(r));
  }
});
