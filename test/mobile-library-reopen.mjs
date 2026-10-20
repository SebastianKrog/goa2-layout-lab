import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
for (const [key, port] of Object.entries({
  DESK: 5400,
  BASE: 5401,
  COMPARATOR: 5402,
  LIVE: 5403,
  BACKEND: 10400,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);
const { DATA, PORTS } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { captureReport } = await import("../report.mjs");
const output = path.join(DATA, "reviews", "library-reopen-" + Date.now());
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
  const library = await c.api("/situations", undefined, "GET");
  for (const [id, seat, decision] of [
    ["ee0dd0fe03ce", "hero_arien", null],
    ["555d71a47fd2", "hero_takahide", "SELECT_CARD"],
    ["50205badf8ea", "hero_hanu", "CHOOSE_ACTOR"],
    ["371c8eb12f74", "hero_hanu", "CHOOSE_ACTION"],
  ]) {
    const situation = library.find((s) => s.id === id);
    assert.equal(situation?.origin, "library");
    const response = await fetch(`http://localhost:${PORTS.desk}/api/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ situationId: id, restoreViews: true }),
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    assert.equal(c.windows.length, 3);
    assert.deepEqual(
      c.windows.map((w) => [w.config.source, w.config.layout, w.config.seat]),
      [
        ["base", "desktop", seat],
        ["comparator", "mobile", seat],
        ["target", "desktop", seat],
      ],
    );
    const states = await Promise.all(
      c.windows.map((w) =>
        c.api("/games/" + w.clone.game_id, undefined, "GET"),
      ),
    );
    assert.ok(states.every((s) => s.hash === states[0].hash));
    if (decision) assert.ok(states.every((s) => s.decision?.type === decision));
    else
      assert.ok(
        states.every(
          (s) =>
            s.phase === "PLANNING" ||
            s.summary?.phase === "PLANNING" ||
            !s.decision,
        ),
      );
    for (const w of c.windows) {
      const view = await w.page.evaluate(() => window.__GOA2_LAB_STATE__.view);
      assert.ok(
        Object.values(view.teams)
          .flatMap((t) => t.heroes)
          .some((h) => h.id === seat),
      );
      assert.deepEqual(w.errors, []);
      assert.deepEqual(w.assets, []);
    }
    const report = await captureReport(c, [0, 1, 2]);
    records.push({
      situationId: id,
      name: situation.name,
      seat,
      decision,
      configs: c.windows.map((w) => w.config),
      hash: states[0].hash,
      ...report,
    });
    await fs.writeFile(
      path.join(output, "reports.json"),
      JSON.stringify({ records, status: c.status() }, null, 2),
    );
    console.log("LIBRARY REOPEN", id, report.id);
  }
  console.log("Library evidence:", output);
} finally {
  await desk.close();
}
