import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
for (const [k, v] of Object.entries({
  DESK: 5200,
  BASE: 5201,
  COMPARATOR: 5202,
  LIVE: 5203,
  BACKEND: 10200,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(v);
const { DATA, BACKEND, TOOL } = await import("../src/config.mjs");
const { startDesk } = await import("../src/desk.mjs");
const { captureReport } = await import("../src/report.mjs");
const { showPane, capturePresentation, restorePresentation } = await import(
  "../src/presentation.mjs"
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
const output = path.join(DATA, "reviews", "decision-final-" + Date.now());
await fs.mkdir(output, { recursive: true });
const records = [];
const sizes = [
  ["portrait", { width: 390, height: 844 }],
  ["compact", { width: 360, height: 800 }],
  ["landscape", { width: 844, height: 390 }],
];
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
  async function capture(key, profile, alignment) {
    const states = await Promise.all(
      c.windows.map((w) =>
        c.api("/games/" + w.clone.game_id, undefined, "GET"),
      ),
    );
    assert.equal(states[0].hash, states[1].hash);
    assert.ok(
      await c.windows[0].page
        .locator('[data-card-size="large"] img[src^="/icons/"]')
        .evaluateAll((images) =>
          images.every((image) => image.getBoundingClientRect().width <= 64),
        ),
      "Card icon layout must be applied before a visual comparison",
    );
    const report = await captureReport(c, [0, 1]);
    records.push({ key, profile, alignment, ...report });
    await fs.writeFile(
      path.join(output, "reports.json"),
      JSON.stringify({ records, status: c.status() }, null, 2),
    );
    console.log("DECISION FINAL", key, profile, report.id);
  }
  for (const [key, seat] of [
    ["defense-card", "hero_brogan"],
    ["discard-card", "hero_brogan"],
    ["gydion-spell-choice", "hero_gydion"],
    ["takahide-gold-card-choice", "hero_takahide"],
  ]) {
    let s = library.find(
      (s) => s.origin === "library" && s.provenance?.fixture?.case === key,
    );
    if (!s)
      s = await c.api("/import", {
        content: JSON.parse(
          await fs.readFile(
            path.join(DATA, "situation-recipes/mobile-gameplay", key + ".json"),
            "utf8",
          ),
        ),
      });
    await load(s, seat);
    const native = c.windows[0];
    await capture(
      key + "-offered",
      "portrait",
      "Both awaiting the same backend decision",
    );
    const panel = native.page.getByRole("region", {
      name: "Game decision",
      exact: true,
    });
    if (key === "gydion-spell-choice") {
      const reader = panel.getByLabel("Action card preview", { exact: true });
      const before = await reader.boundingBox();
      const embedded = reader
        .getByRole("button", { name: /^Inspect / })
        .first();
      const label = await embedded.getAttribute("aria-label");
      await embedded.tap();
      await native.page
        .getByRole("dialog", { name: label, exact: true })
        .waitFor();
      if (!(await native.page.locator("[data-decision-inspection]").count())) {
        await fs.writeFile(
          path.join(output, "missing-decision-context.html"),
          await native.page.content(),
        );
        const sources = await native.page.evaluate(async () =>
          Object.fromEntries(
            await Promise.all(
              ["GameView.tsx", "MobileDecisionPanel.tsx"].map(async (name) => [
                name,
                await fetch(
                  "/src/components/" +
                    (name === "GameView.tsx" ? "pages/" : "mobile/") +
                    name,
                ).then((r) => r.text()),
              ]),
            ),
          ),
        );
        await fs.writeFile(
          path.join(output, "served-sources.json"),
          JSON.stringify(sources),
        );
      }
      await native.page
        .locator("[data-decision-inspection] [role=dialog]")
        .waitFor({ state: "visible", timeout: 5000 });
      await c.windows[1].page
        .getByRole("button", {
          name: label.replace(/^Inspect /, "View "),
          exact: true,
        })
        .first()
        .tap();
      await capture(
        "decision-embedded-spell",
        "portrait",
        "Both inspect the same embedded spell without submitting the decision",
      );
      const saved = await capturePresentation(native.page, "2d");
      assert.equal(saved.inspectionMobileContext, "decision");
      assert.equal(saved.inspectionMobileParent, "cantrip");
      await native.page
        .getByRole("button", { name: "Close inspection", exact: true })
        .tap();
      await c.windows[1].page
        .getByRole("button", { name: "Back to card", exact: true })
        .tap();
      assert.deepEqual(
        await restorePresentation(native.page, saved, native.config),
        [],
      );
      await native.page
        .getByRole("dialog", { name: label, exact: true })
        .waitFor();
      await native.page.keyboard.press("Escape");
      assert.deepEqual(
        await reader.boundingBox(),
        before,
        "Closing embedded details must preserve the decision reader bounds",
      );
    }
    await panel.locator("button[aria-pressed]").first().tap();
    if (key === "discard-card")
      await c.windows[1].page.locator(".m2-discard-row").first().tap();
    for (const [profile, size] of sizes) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      const confirm = panel.getByRole("button", {
        name: key === "discard-card" ? "Confirm discard" : "Confirm choice",
        exact: true,
      });
      await confirm.scrollIntoViewIfNeeded();
      const b = await confirm.boundingBox();
      assert.ok(
        b && b.height >= 44 && b.y >= 0 && b.y + b.height <= size.height,
        "Selected Confirm must remain tappable",
      );
      assert.equal(await confirm.isEnabled(), true);
      await capture(
        key + "-staged",
        profile,
        key === "discard-card"
          ? "Both stage the same discard; neither has submitted"
          : "Native stages a choice for explicit Confirm; target remains before its immediate-submit choice",
      );
    }
  }
  const s = library.find(
    (s) =>
      s.origin === "library" &&
      s.name === "M3 presentation - brogan-public-active-history",
  );
  assert.ok(s);
  await load(s, "hero_brogan");
  for (const w of c.windows) await showPane(w.page, "heroes", w.config);
  const native = c.windows[0];
  await native.page
    .locator(
      '[data-mobile-panel="heroes"] [data-mobile-hero="hero_brogan"] button[aria-expanded]',
    )
    .tap();
  for (const [profile, size] of sizes) {
    for (const w of c.windows) await w.page.setViewportSize(size);
    const panel = native.page.locator('[data-mobile-panel="heroes"]');
    assert.ok(
      await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Expanded hero must not cause horizontal overflow",
    );
    await capture(
      "brogan-supplementary-details",
      profile,
      "Native supplementary disclosure; pinned target has only its compact roster",
    );
  }
  for (const w of c.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
  }
  console.log("Final decision evidence", output);
} finally {
  await desk.close();
}
