// Real Windows browser checks: ready control bounds/taps and running clocks.
for (const [k, v] of Object.entries({
  DESK: 4500,
  BASE: 4501,
  COMPARATOR: 4502,
  LIVE: 4503,
  BACKEND: 9500,
}))
  process.env[`GOA2_LAB_${k}_PORT`] = String(v);
import assert from "node:assert/strict";
const { startDesk } = await import("../src/desk.mjs");
const { showPane } = await import("../src/presentation.mjs");
const { captureReport } = await import("../src/report.mjs");
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
  for (const ready of [false, true]) {
    const s = await c.api("/starter", {
      name: `M1 visual audit - timed ${ready ? "running" : "ready"}`,
      timed: true,
      ready_all: ready,
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
      for (const pane of ready ? ["board", "heroes"] : ["board"]) {
        for (const w of c.windows) await showPane(w.page, pane, w.config);
        if (!ready) {
          for (const w of c.windows) {
            const b = await w.page
              .getByRole("button", { name: /ready$/i })
              .first()
              .boundingBox();
            if (w.config.source === "live") {
              const lastHero = await w.page
                .getByRole("dialog", { name: "Ready check" })
                .locator("section > div > div")
                .last()
                .boundingBox();
              assert.ok(
                lastHero && b && b.y >= lastHero.y + lastHero.height,
                "Ready must not overlap the roster",
              );
              assert.ok(
                b.height >= 44,
                "Native Ready must retain a 44px tap target",
              );
            }
            if (
              !b ||
              b.y < 0 ||
              b.y + b.height > size.height ||
              b.height < 32
            ) {
              console.log("FAIL REPORT", (await captureReport(c, [0, 1])).id);
              throw Error("Ready control out of bounds");
            }
          }
        }
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
        console.log(
          "TIMED",
          ready,
          profile,
          pane,
          (await captureReport(c, [0, 1])).id,
        );
      }
    }
    if (!ready) {
      for (const w of c.windows)
        await w.page
          .getByRole("button", { name: /ready$/i })
          .first()
          .tap();
      for (const w of c.windows)
        await w.page.waitForFunction(() =>
          window.__GOA2_LAB_STATE__.view.clock.ready_hero_ids.includes(
            "hero_arien",
          ),
        );
      console.log("PASS actual readiness tap on both clones");
    }
  }
} finally {
  await desk.close();
}
