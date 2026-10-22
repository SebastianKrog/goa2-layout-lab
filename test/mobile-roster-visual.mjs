import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
for (const [key, port] of Object.entries({
  DESK: 4600,
  BASE: 4601,
  COMPARATOR: 4602,
  LIVE: 4603,
  BACKEND: 9600,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);
const { DATA, BACKEND, TOOL } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { showPane } = await import("../presentation.mjs");
const { captureReport } = await import("../report.mjs");
const python =
  process.env.GOA2_LAB_PYTHON ||
  path.join(
    BACKEND,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
execFileSync(
  python,
  [
    path.join(TOOL, "scripts/create-mobile-presentation-situations.py"),
    "--backend",
    BACKEND,
  ],
  { stdio: "ignore", windowsHide: true },
);
const output = path.join(DATA, "reviews", `roster-parity-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const records = [];
const cases = [
  ...[0, 1, 3, 9, 10].map((count) => [
    `gydion-public-spells-${count}`,
    "hero_gydion",
  ]),
  ["gydion-three-indicators-committed", "hero_gydion"],
  ["snorri-empty-history-runes", "hero_snorri"],
  ["snorri-played-history-runes", "hero_snorri"],
  ["razzle-piece-markers", "hero_razzle"],
  ["brogan-discard-active-history", "hero_brogan"],
  ["brogan-public-active-history", "hero_brogan"],
];
const filter = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
const c = desk.comparison;
try {
  const library = await c.api("/situations", undefined, "GET");
  for (const [key, seat] of cases.filter(
    ([key]) => !filter || filter.split(",").some(term => key.includes(term)),
  )) {
    let situation = library.find(
      (s) => s.origin === "library" && s.name === `M3 presentation - ${key}`,
    );
    if (!situation)
      situation = await c.api("/import", {
        content: JSON.parse(
          await fs.readFile(
            path.join(
              DATA,
              "situation-recipes/mobile-presentation",
              `${key}.json`,
            ),
            "utf8",
          ),
        ),
      });
    await c.load(
      situation.id,
      [
        { source: "live", uiMode: "mobile" },
        { source: "target", uiMode: "desktop" },
      ].map((slot) => ({ ...slot, seat, render: "2d", profile: "portrait" })),
      {},
      situation,
    );
    for (const [profile, size] of [
      ["portrait", { width: 390, height: 844 }],
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
    ]) {
      for (const win of c.windows) {
        await win.page.setViewportSize(size);
        await showPane(win.page, "heroes", win.config);
      }
      const native = c.windows[0];
      if (seat === "hero_gydion") {
        const row = await native.page
          .locator(
            `[data-mobile-panel="heroes"] [data-mobile-hero="${seat}"] [data-crowded]`,
          )
          .boundingBox();
        assert.ok(
          row && row.height <= 28,
          `${key}: indicators changed current-card row height to ${row?.height}`,
        );
        const count = key.includes("committed")
          ? 3
          : Number(key.split("-").at(-1));
        assert.equal(
          await native.page
            .getByRole("button", { name: `Spells cast: ${count}`, exact: true })
            .count(),
          1,
        );
      }
      const states = await Promise.all(
        c.windows.map((w) =>
          c.api(`/games/${w.clone.game_id}`, undefined, "GET"),
        ),
      );
      assert.equal(states[0].hash, states[1].hash);
      for (const win of c.windows) {
        assert.deepEqual(win.errors, []);
        assert.deepEqual(win.assets, []);
      }
      const report = await captureReport(c, [0, 1]);
      records.push({ key, seat, profile, ...report });
      await fs.writeFile(
        path.join(output, "reports.json"),
        JSON.stringify(
          { workingTree: true, status: c.status(), records },
          null,
          2,
        ),
      );
      console.log("ROSTER", key, profile, report.id);
    }
  }
  console.log("Roster evidence:", output);
} finally {
  await desk.close();
}
