import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
for (const [k, v] of Object.entries({
  DESK: 4900,
  BASE: 4901,
  COMPARATOR: 4902,
  LIVE: 4903,
  BACKEND: 9900,
}))
  process.env[`GOA2_LAB_${k}_PORT`] = String(v);
const { DATA, BACKEND, TOOL } = await import("../src/config.mjs");
const { startDesk } = await import("../src/desk.mjs");
const { captureReport } = await import("../src/report.mjs");
const { showPane } = await import("../src/presentation.mjs");
execFileSync(
  process.env.GOA2_LAB_PYTHON ||
    path.join(
      BACKEND,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  [path.join(TOOL, "scripts/create-mobile-gameplay-situations.py")],
  { stdio: "ignore", windowsHide: true },
);
execFileSync(
  process.env.GOA2_LAB_PYTHON ||
    path.join(
      BACKEND,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  [path.join(TOOL, "scripts/create-mobile-presentation-situations.py")],
  { stdio: "ignore", windowsHide: true },
);
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
const sizes = [
  ["portrait", { width: 390, height: 844 }],
  ["compact", { width: 360, height: 800 }],
  ["landscape", { width: 844, height: 390 }],
];
const records = [];
const out = path.join(DATA, "reviews", "final-cases-" + Date.now());
await fs.mkdir(out, { recursive: true });
try {
  const c = desk.comparison;
  async function load(s, seat) {
    await c.load(
      s.id,
      [
        { source: "live", uiMode: "mobile" },
        { source: "target", uiMode: "desktop" },
      ].map((w) => ({ ...w, seat, render: "2d", profile: "portrait" })),
      {},
      s,
    );
  }
  async function capture(key) {
    for (const [profile, size] of sizes) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      const states = await Promise.all(
        c.windows.map((w) =>
          c.api("/games/" + w.clone.game_id, undefined, "GET"),
        ),
      );
      assert.equal(states[0].hash, states[1].hash);
      const report = await captureReport(c, [0, 1]);
      records.push({ key, profile, ...report });
      await fs.writeFile(
        path.join(out, "reports.json"),
        JSON.stringify({ records, status: c.status() }, null, 2),
      );
      console.log("CASE", key, profile, report.id);
    }
  }
  let s = await c.api("/import", {
    content: JSON.parse(
      await fs.readFile(
        path.join(
          DATA,
          "situation-recipes/mobile-gameplay/emmitt-second-card.json",
        ),
        "utf8",
      ),
    ),
  });
  await load(s, "hero_emmitt");
  await capture("emmitt-awaiting-second-board");
  for (const w of c.windows) {
    await w.page.setViewportSize(sizes[0][1]);
    await showPane(w.page, "hand", w.config);
  }
  await capture("emmitt-awaiting-second-hand");
  const [native, target] = c.windows;
  for (const w of c.windows) await w.page.setViewportSize(sizes[0][1]);
  const card = await native.page.evaluate(
    () =>
      Object.values(window.__GOA2_LAB_STATE__.view.teams)
        .flatMap((t) => t.heroes)
        .find((h) => h.id === "hero_emmitt").hand[0],
  );
  await native.page.getByRole("button", { name: card.name, exact: true }).tap();
  await target.page
    .locator('[data-m2="hand-list"] .m2-adapted-row')
    .filter({ hasText: card.name })
    .first()
    .tap();
  await capture("emmitt-second-selected");
  s = await c.api("/starter", { name: "M1 final audit - starting position" });
  await load(s, "hero_arien");
  for (const w of c.windows) {
    const button = w.page.getByRole("button", {
      name: /^(Change starting position|Position)$/,
      exact: true,
    });
    console.log("STARTING AVAILABLE", w.config.source, await button.count());
    if (await button.count()) await button.tap();
  }
  await capture("starting-position");
  for (const w of c.windows) {
    const button = w.page.getByRole("button", {
      name: "Done adjusting",
      exact: true,
    });
    if (await button.count()) await button.tap();
  }
  const routes = [];
  for (const w of c.windows) {
    const route = { outage: false, handles: [] };
    routes.push(route);
    await w.page.routeWebSocket(/\/games\/[^/]+\/ws/, (ws) => {
      if (route.outage)
        ws.close({ code: 1013, reason: "Layout lab transport outage" });
      else {
        route.handles.push(ws);
        ws.connectToServer();
      }
    });
    await w.page.reload();
    await w.page.waitForFunction(() => !!window.__GOA2_LAB_STATE__?.view);
  }
  for (const route of routes) {
    route.outage = true;
    for (const ws of route.handles)
      ws.close({ code: 1013, reason: "Layout lab transport outage" });
  }
  for (const w of c.windows)
    await w.page.waitForFunction(
      () =>
        document.body.textContent.includes("Reconnecting...") ||
        document.body.textContent.includes("Reconnecting…"),
    );
  await capture("reconnecting");
  for (const route of routes) route.outage = false;
  for (const w of c.windows)
    await w.page.waitForFunction(
      () =>
        !document.body.textContent.includes("Reconnecting...") &&
        !document.body.textContent.includes("Reconnecting…"),
      null,
      { timeout: 30000 },
    );
  await capture("reconnected");
  for (const w of c.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
  }
  s = await c.api("/import", {
    content: JSON.parse(
      await fs.readFile(
        path.join(
          DATA,
          "situation-recipes/mobile-presentation/snorri-empty-history-runes.json",
        ),
        "utf8",
      ),
    ),
  });
  await load(s, "hero_snorri");
  for (const w of c.windows) {
    await w.page.setViewportSize(sizes[0][1]);
    await showPane(w.page, "hand", w.config);
  }
  await c.windows[0].page
    .getByRole("button", { name: "Inscribe the Runes", exact: true })
    .tap();
  await c.windows[1].page
    .locator('[data-m2="hand-list"] .m2-adapted-row')
    .filter({ hasText: "Inscribe the Runes" })
    .first()
    .tap();
  await capture("long-rune-card");
  for (const w of c.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
  }
  console.log("Final case evidence", out);
} finally {
  await desk.close();
}
