import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
for (const [key, port] of Object.entries({
  DESK: 5500,
  BASE: 5501,
  COMPARATOR: 5502,
  LIVE: 5503,
  BACKEND: 10500,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);
const { DATA, BACKEND, TOOL } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { captureReport } = await import("../report.mjs");
const { showPane } = await import("../presentation.mjs");
execFileSync(
  process.env.GOA2_LAB_PYTHON ||
    path.join(
      BACKEND,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  [
    path.join(TOOL, "scripts/create-mobile-resolution-situations.py"),
    "--backend",
    BACKEND,
  ],
  { stdio: "ignore", windowsHide: true },
);
execFileSync(
  process.env.GOA2_LAB_PYTHON ||
    path.join(
      BACKEND,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  [
    path.join(TOOL, "scripts/create-mobile-gameplay-situations.py"),
    "--backend",
    BACKEND,
  ],
  { stdio: "ignore", windowsHide: true },
);
const { waitFor } = await import("../services.mjs");
const output = path.join(DATA, "reviews", "turn-states-" + Date.now());
await fs.mkdir(output, { recursive: true });
const records = [];
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
try {
  const c = desk.comparison;
  const filter = process.argv
    .find((arg) => arg.startsWith("--case="))
    ?.slice(7)
    .split(",");
  for (const key of [
    "completed-turn",
    "unqueued-no-card",
    "offboard-and-completed",
    "emmitt-two-commits",
    "offboard-completed-turn",
  ].filter((key) => !filter || filter.includes(key))) {
    const emmitt = key === "emmitt-two-commits";
    const s = await c.api("/import", {
      content: JSON.parse(
        await fs.readFile(
          path.join(
            DATA,
            "situation-recipes",
            emmitt ? "mobile-gameplay" : "mobile-resolution",
            emmitt ? "emmitt-second-card.json" : key + ".json",
          ),
          "utf8",
        ),
      ),
    });
    await c.load(
      s.id,
      [
        { source: "live", uiMode: "mobile" },
        { source: "target", uiMode: "desktop" },
      ].map((w) => ({
        ...w,
        seat: emmitt ? "hero_emmitt" : "hero_hanu",
        profile: "portrait",
        render: "2d",
      })),
      {},
      s,
    );
    if (emmitt) {
      await c.sync.setMode("api");
      const native = c.windows[0];
      await showPane(native.page, "hand", native.config);
      await native.page.locator("[data-lab-card]:visible").first().tap();
      await native.page.getByRole("button", { name: /^Commit/ }).tap();
      await waitFor(async () => {
        await c.sync.queue;
        const views = await Promise.all(
          c.windows.map((w) =>
            w.page.evaluate(() => window.__GOA2_LAB_STATE__.view),
          ),
        );
        return views.every((view) => {
          const hero = Object.values(view.teams)
            .flatMap((t) => t.heroes)
            .find((h) => h.id === "hero_emmitt");
          return hero.current_turn_card && hero.extra_turn_card;
        });
      }, "two committed Emmitt cards in both views");
      await c.sync.setMode("none");
    }
    for (const [profile, size] of [
      ["portrait", { width: 390, height: 844 }],
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
    ]) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      for (const pane of ["board", "heroes"]) {
        for (const w of c.windows) await showPane(w.page, pane, w.config);
        const root =
          pane === "board"
            ? "[data-mobile-board-summary]"
            : '[data-mobile-panel="heroes"]';
        const page = c.windows[0].page;
        const completed = page.locator(
          root + ' [data-mobile-resolution="hero_hanu"]',
        );
        if (!emmitt) {
          await completed.waitFor();
          assert.equal(
            await completed.getAttribute("aria-label"),
            key === "offboard-completed-turn" ? "Off board" : "Turn completed",
          );
          if (key !== "completed-turn")
            assert.equal(
              await page
                .locator(root + ' [data-mobile-resolution="hero_brogan"]')
                .getAttribute("aria-label"),
              ["offboard-and-completed", "offboard-completed-turn"].includes(
                key,
              )
                ? "Off board"
                : "No card played this turn",
            );
        }
        if (pane === "heroes" && key === "offboard-completed-turn") {
          const portrait = completed.locator("..");
          assert.deepEqual(
            await portrait.evaluate((el) => ({
              border: getComputedStyle(el).borderColor,
              width: el.getBoundingClientRect().width,
              filter: getComputedStyle(el.querySelector("img")).filter,
            })),
            { border: "rgb(229, 109, 109)", width: 34, filter: "grayscale(1)" },
            "Fade only portrait art; preserve the team-colored ring",
          );
          assert.equal(
            await completed.getAttribute("data-done"),
            "true",
            "Off-board marker and completed-row styling are independent",
          );
        }
        if (pane === "board") {
          if (emmitt) {
            const cards = page.locator(
              root + ' [aria-label="Two committed cards"]',
            );
            assert.equal(await cards.getByRole("button").count(), 2);
            const hero = await page.evaluate(() =>
              Object.values(window.__GOA2_LAB_STATE__.view.teams)
                .flatMap((t) => t.heroes)
                .find((h) => h.id === "hero_emmitt"),
            );
            assert.deepEqual(
              await cards
                .getByRole("button")
                .evaluateAll((buttons) =>
                  buttons.map((b) => b.getAttribute("aria-label")),
                ),
              [
                `Inspect ${hero.current_turn_card.name}`,
                `Inspect ${hero.extra_turn_card.name}`,
              ],
              "Use the canonical current-then-extra order shown by the target",
            );
            const box = await cards.boundingBox();
            assert.ok(box && box.width >= 60 && box.width <= 66);
          } else {
            const row = completed.locator("xpath=ancestor::div[@data-team]");
            assert.equal(
              await row
                .getByRole("button", {
                  name: "Inspect Fight and Flight",
                  exact: true,
                })
                .count(),
              1,
              "Retain the just-resolved card in its fixed Board column",
            );
            const card = await row
              .locator('[data-resolved="true"]')
              .boundingBox();
            assert.ok(card && card.width >= 60 && card.width <= 66);
          }
          const rows = await page
            .locator(root + " > div")
            .evaluateAll((nodes) =>
              nodes.map((n) => {
                const box = n.getBoundingClientRect();
                return {
                  height: box.height,
                  scroll: n.scrollWidth,
                  width: n.clientWidth,
                };
              }),
            );
          assert.ok(
            rows.every(
              (row) => row.height <= 31 && row.scroll <= row.width + 1,
            ),
            "Board rows retain fixed height without horizontal overflow",
          );
        }
        const states = await Promise.all(
          c.windows.map((w) =>
            c.api("/games/" + w.clone.game_id, undefined, "GET"),
          ),
        );
        assert.equal(states[0].hash, states[1].hash);
        const report = await captureReport(c, [0, 1]);
        records.push({ key, pane, profile, ...report });
        await fs.writeFile(
          path.join(output, "reports.json"),
          JSON.stringify({ records, status: c.status() }, null, 2),
        );
        console.log("TURN STATE", key, profile, pane, report.id);
      }
    }
  }
  console.log("Turn-state evidence:", output);
} finally {
  await desk.close();
}
