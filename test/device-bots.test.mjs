import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { DeviceServer } from "../device-server.mjs";

const seats = ["arien", "hanu", "brogan", "tigerclaw"].map((name) => ({
  id: `hero_${name}`,
  name,
}));
const slot = {
  source: "live",
  seat: "hero_arien",
  profile: "portrait",
  layout: "mobile",
  render: "2d",
};

test("device clones scope bots to other heroes and stop their workers", async () => {
  const calls = [];
  const situation = {
    id: "fixture",
    name: "Bots",
    checkpoint: { state: { teams: { RED: { heroes: seats } } } },
  };
  const api = async (route, body) => {
    calls.push({ route, body });
    if (route.startsWith("/situations/")) return situation;
    if (route === "/health") return { bot_kinds: ["random", "heuristic"] };
    if (route === "/clone")
      return { game_id: "game", seats: { hero_arien: "private-token" } };
    if (route === "/device/stop") return { ok: true };
    throw Error(route);
  };
  const devices = new DeviceServer({ frontend: async () => 12345 }, api, {
    port: 0,
    hosts: () => ["127.0.0.1"],
  });
  try {
    assert.deepEqual((await devices.options("fixture")).botKinds, [
      "random",
      "heuristic",
    ]);
    for (const bots of [
      { hero_arien: "random" },
      { unknown: "random" },
      { hero_hanu: "ismcts" },
      [],
    ])
      await assert.rejects(
        devices.open({ situationId: "fixture", slot, bots }),
        /other heroes/,
      );
    assert.equal(
      calls.some((c) => c.route === "/clone"),
      false,
    );
    const bots = { hero_hanu: "random", hero_brogan: "heuristic" };
    const view = await devices.open({ situationId: "fixture", slot, bots });
    assert.deepEqual(calls.find((c) => c.route === "/clone").body, {
      situation_id: "fixture",
      human_seat: "hero_arien",
      bots,
    });
    assert.deepEqual(view.bots, bots);
    assert.ok(view.qr.startsWith("data:image/png;base64,"));
    await devices.stop(view.id);
    assert.deepEqual(calls.at(-1), {
      route: "/device/stop",
      body: { game_id: "game" },
    });
    assert.equal((await fetch(view.urls[0])).status, 410);
  } finally {
    await devices.close();
  }
});

test("device dialog assigns Random, Simple, mixed controls and preserves the human seat", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const html = (
      await fs.readFile(
        new URL("../public/index.html", import.meta.url),
        "utf8",
      )
    ).replace(
      '<script type="module" src="/desk.mjs"></script>',
      `<script type="module">
      import {initDevicePanel} from "/device-panel.mjs";
      window.posts = []; window.messages = [];
      window.fixture = {seats: ${JSON.stringify([...seats, { id: "spectator", name: "Spectator" }])}, botKinds: ["random", "heuristic"]};
      initDevicePanel({selectedSituation: () => ({id: "fixture"}), task: async (_,fn) => fn(), read: async path => path.includes("options") ? window.fixture : [], notify: m => window.messages.push(m), call: async (name, body) => { window.posts.push({name,body}); return {id: "view", name: "Bots", bots: body.bots, config: body.slot, urls: ["http://device.test"], qr: ""}; }});
      </script>`,
    );
    await page.route("http://fixture.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/")
        return route.fulfill({ contentType: "text/html", body: html });
      if (pathname === "/device-panel.mjs" || pathname === "/desk.css")
        return route.fulfill({
          contentType: pathname.endsWith("mjs")
            ? "text/javascript"
            : "text/css",
          body: await fs.readFile(
            new URL(`../public${pathname}`, import.meta.url),
          ),
        });
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto("http://fixture.test/");
    await page.locator("#openDevice").click();
    await page.locator("#deviceDialog").waitFor();
    assert.equal(await page.locator("#deviceBotRows select").count(), 3);
    assert.equal(await page.locator('[data-bot-hero="hero_arien"]').count(), 0);
    assert.deepEqual(
      await page
        .locator("#deviceBotRows select")
        .evaluateAll((nodes) => nodes.map((n) => n.value)),
      ["random", "random", "random"],
    );
    await page.locator("#deviceBotPreset").selectOption("heuristic");
    await page.locator("#deviceSeat").selectOption("hero_hanu");
    await page.locator('[data-bot-hero="hero_brogan"]').selectOption("manual");
    assert.equal(
      (await page.locator("#deviceBotPreset").inputValue?.()) ??
        (await page.locator("#deviceBotPreset").evaluate((n) => n.value)),
      "custom",
    );
    await page
      .getByRole("button", { name: "Start device website", exact: true })
      .click();
    await page.waitForFunction(() => window.posts.length > 0);
    let post = await page.evaluate(() => window.posts.at(-1));
    assert.equal(post.body.slot.seat, "hero_hanu");
    assert.deepEqual(post.body.bots, {
      hero_arien: "heuristic",
      hero_tigerclaw: "heuristic",
    });
    assert.match(await page.locator("#deviceRoster").innerText(), /hanu: You/);
    await page.evaluate(() => {
      document.querySelector("#deviceDialog").close();
      window.fixture.botKinds = [];
    });
    await page.locator("#openDevice").click();
    await page.locator("#deviceBotsUnavailable").waitFor();
    assert.equal(await page.locator("#deviceBots").isVisible(), false);
    await page
      .getByRole("button", { name: "Start device website", exact: true })
      .click();
    await page.waitForFunction(() => window.posts.length === 2);
    post = await page.evaluate(() => window.posts.at(-1));
    assert.deepEqual(post.body.bots, {});
  } finally {
    await browser.close();
  }
});
