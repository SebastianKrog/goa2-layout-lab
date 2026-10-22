import fs from "node:fs/promises";
import assert from "node:assert/strict";
for (const [k, v] of Object.entries({
  DESK: 4800,
  BASE: 4801,
  COMPARATOR: 4802,
  LIVE: 4803,
  BACKEND: 9800,
}))
  process.env[`GOA2_LAB_${k}_PORT`] = String(v);
import path from "node:path";
import { execFileSync } from "node:child_process";
const { DATA, BACKEND, TOOL } = await import("../config.mjs");
execFileSync(
  process.env.GOA2_LAB_PYTHON ||
    path.join(
      BACKEND,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  [
    path.join(TOOL, "scripts/create-mobile-presentation-situations.py"),
    "--backend",
    BACKEND,
  ],
  { stdio: "ignore", windowsHide: true },
);
const output = path.join(DATA, "reviews", `shell-parity-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const records = [];
const { startDesk } = await import("../desk.mjs");
const { captureReport } = await import("../report.mjs");
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
  for (const key of [
    "shell-paused",
    "shell-suspended_for_inactivity",
    "shell-finished",
  ]) {
    const s = await c.api("/import", {
      content: JSON.parse(
        await fs.readFile(
          path.join(
            DATA,
            "situation-recipes/mobile-presentation",
            key + ".json",
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
        seat: "hero_arien",
        render: "2d",
        profile: "portrait",
      })),
      {},
      s,
    );
    for (const [profile, size] of [
      ["portrait", { width: 390, height: 844 }],
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
    ]) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      const states = await Promise.all(
        c.windows.map((w) =>
          c.api("/games/" + w.clone.game_id, undefined, "GET"),
        ),
      );
      assert.equal(states[0].hash, states[1].hash);
      for (const w of c.windows) {
        assert.deepEqual(w.errors, []);
        assert.deepEqual(w.assets, []);
      }
      const report = await captureReport(c, [0, 1]);
      records.push({ key, profile, ...report });
      await fs.writeFile(
        path.join(output, "reports.json"),
        JSON.stringify(
          { workingTree: true, status: c.status(), records },
          null,
          2,
        ),
      );
      console.log("SHELL", key, profile, report.id);
    }
  }
} finally {
  await desk.close();
}
