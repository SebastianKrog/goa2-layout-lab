import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
for (const [key, port] of Object.entries({
  DESK: 5300,
  BASE: 5301,
  COMPARATOR: 5302,
  LIVE: 5303,
  BACKEND: 10300,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);
const { DATA, BACKEND, TOOL } = await import("../src/config.mjs");
const { startDesk } = await import("../src/desk.mjs");
const { showPane } = await import("../src/presentation.mjs");
const { captureReport } = await import("../src/report.mjs");
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
const output = path.join(DATA, "reviews", "resolution-" + Date.now());
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
  for (const key of ["team-tie", "selected-teammate"]) {
    const s = await c.api("/import", {
      content: JSON.parse(
        await fs.readFile(
          path.join(DATA, "situation-recipes/mobile-resolution", key + ".json"),
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
        seat: "hero_hanu",
        profile: "portrait",
        render: "2d",
      })),
      {},
      s,
    );
    for (const w of c.windows) {
      const peek =
        w.config.uiMode === "mobile"
          ? w.page
              .locator("[data-decision-type]")
              .getByRole("button", { name: "Board", exact: true })
          : w.page.getByRole("button", { name: /Board$/ }).first();
      await peek.click();
    }
    for (const [profile, size] of [
      ["portrait", { width: 390, height: 844 }],
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
    ]) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      for (const pane of ["board", "heroes"]) {
        for (const w of c.windows) await showPane(w.page, pane, w.config);
        const native = c.windows[0].page;
        const root =
          pane === "board"
            ? "[data-mobile-board-summary]"
            : '[data-mobile-panel="heroes"]';
        await native
          .locator(root + " [data-mobile-resolution]")
          .first()
          .waitFor();
        const peekBounds = await native
          .locator("[data-mobile-board-peek]")
          .boundingBox();
        assert.ok(peekBounds);
        const clear = (a, b) =>
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        const navigation = await native
          .locator('[aria-label="Game views"]')
          .boundingBox();
        assert.ok(navigation);
        assert.ok(
          clear(peekBounds, navigation),
          "Board-peek controls must clear navigation",
        );
        const roster = await native.locator(root).boundingBox();
        assert.ok(
          roster && clear(peekBounds, roster),
          "Board-peek controls must clear the visible hero roster",
        );
        const labels = await native
          .locator(root + " [data-mobile-resolution]")
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              id: n.dataset.mobileResolution,
              label: n.getAttribute("aria-label"),
              box: {
                width: n.getBoundingClientRect().width,
                height: n.getBoundingClientRect().height,
              },
            })),
          );
        assert.equal(labels.length, 4);
        assert.equal(
          labels[0].id,
          key === "selected-teammate" ? "hero_hanu" : "hero_arien",
        );
        assert.ok(labels[0].label.includes("NOW"));
        assert.ok(labels[1].label.includes("TIE"));
        assert.ok(labels[2].label.includes("initiative 13"));
        assert.ok(labels[3].label.includes("initiative 11"));
        assert.ok(labels.every((n) => n.box.width > 0 && n.box.height > 0));
        const states = await Promise.all(
          c.windows.map((w) =>
            c.api("/games/" + w.clone.game_id, undefined, "GET"),
          ),
        );
        assert.equal(states[0].hash, states[1].hash);
        const report = await captureReport(c, [0, 1]);
        records.push({ key, profile, pane, labels, ...report });
        await fs.writeFile(
          path.join(output, "reports.json"),
          JSON.stringify({ records, status: c.status() }, null, 2),
        );
        console.log("RESOLUTION", key, profile, pane, report.id);
      }
    }
  }
  console.log("Resolution evidence:", output);
} finally {
  await desk.close();
}
