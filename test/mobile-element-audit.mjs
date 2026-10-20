// Evidence collection, not a userscript-equality acceptance test.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
for (const [key, port] of Object.entries({
  DESK: 5900,
  BASE: 5901,
  COMPARATOR: 5902,
  LIVE: 5903,
  BACKEND: 10900,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);
const { DATA } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { showPane } = await import("../presentation.mjs");
const { captureReport } = await import("../report.mjs");
const { extractSources } = await import("../source-inspection.mjs");
const root = path.join(DATA, "reviews", "m1-m4-elements-" + Date.now());
await fs.mkdir(root, { recursive: true });
const records = [];
const sizes = [
  ["portrait", { width: 390, height: 844 }],
  ["compact", { width: 360, height: 800 }],
  ["landscape", { width: 844, height: 390 }],
];
const allCases = [
  {
    key: "m1-board-shell",
    id: "a00000000001",
    seat: "hero_arien",
    pane: "board",
    selector:
      'header, .m2-hud-top, .m2-hud-bottom, nav[aria-label="Game views"], #goa2-m2-nav',
  },
  ...["heroes", "hand", "deck", "log", "settings"].map((pane) => ({
    key: "m1-pane-" + pane,
    id: "a00000000001",
    seat: "hero_arien",
    pane,
    selector: `[data-mobile-panel="${pane}"] > div:first-child, #goa2-m2-nav, nav[aria-label="Game views"], #goa2-m2-close`,
  })),
  {
    key: "m2-m3-hand-selected",
    id: "e81bc3bd5fff",
    seat: "hero_arien",
    pane: "hand",
    selector: "button[data-lab-card], .m2-list-card",
  },
  {
    key: "m2-action",
    id: "e6cf117c8910",
    seat: "hero_arien",
    selector:
      "[data-decision-type] button[aria-pressed], [data-m2-action-choice]",
  },
  {
    key: "m2-defense",
    id: "2b928b7b0ab4",
    seat: "hero_brogan",
    selector:
      '[data-decision-type] [class*="cardRow"] > button:first-child, button[class*="_option_"]',
  },
  {
    key: "m2-discard",
    id: "30735050fbde",
    seat: "hero_brogan",
    selector: "[data-decision-type] button[aria-pressed], .m2-discard-row",
  },
  {
    key: "m2-upgrade",
    id: "7596eb876af3",
    seat: "hero_arien",
    selector:
      'button[class*="upgradeCard_"], .m2-upgrade-content button[aria-label$="Available upgrade"]',
  },
  ...["tree", "list", "grid"].map((layout) => ({
    key: "m4-arien-" + layout,
    id: "e81bc3bd5fff",
    seat: "hero_arien",
    pane: "deck",
    layout,
    selector:
      '[data-deck-layout], [role="switch"], [data-deck-card="noble_blade"], .m2-deck-controls, [aria-label="View Noble Blade"]',
  })),
  ...["tree", "list", "grid"].map((layout) => ({
    key: "m4-gydion-" + layout,
    id: "00357f1d97ab",
    seat: "hero_gydion",
    pane: "deck",
    layout,
    selector:
      '[data-deck-layout], [role="switch"], [data-deck-card="cantrip"], .m2-deck-controls, [aria-label="View Cantrip"], [aria-label="View Magic Missile"]',
  })),
  ...["hero_arien", "hero_gydion"].map((seat) => ({
    key: "m4-preview-" + seat,
    id: seat === "hero_arien" ? "e81bc3bd5fff" : "00357f1d97ab",
    seat,
    pane: "deck",
    layout: "list",
    preview: seat === "hero_arien" ? "Noble Blade" : "Cantrip",
    selector: '[aria-label="Deck card preview"], .m2-deck-preview',
  })),
];
const requested = process.argv
  .find((a) => a.startsWith("--case="))
  ?.slice(7)
  .split(",");
const cases = allCases.filter(
  (s) => !requested || requested.some((prefix) => s.key.startsWith(prefix)),
);
if (!cases.length) throw Error("No matching audit cases");
let desk;
async function observation(page, selector) {
  return page.evaluate((selector) => {
    const keys = [
      "display",
      "position",
      "font-size",
      "font-family",
      "font-weight",
      "line-height",
      "color",
      "background-color",
      "min-height",
      "min-width",
      "padding",
      "gap",
      "overflow",
      "z-index",
    ];
    const nodes = [...document.querySelectorAll(selector)];
    function info(e) {
      const r = e.getBoundingClientRect(),
        s = getComputedStyle(e),
        x = Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2)),
        y = Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      return {
        tag: e.localName,
        id: e.id,
        label: e.getAttribute("aria-label"),
        role: e.getAttribute("role"),
        text: e.textContent?.trim().replace(/\s+/g, " ").slice(0, 160),
        visible:
          e.checkVisibility() &&
          r.width > 0 &&
          r.height > 0 &&
          r.right > 0 &&
          r.bottom > 0 &&
          r.left < innerWidth &&
          r.top < innerHeight,
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        inert: !!e.closest("[inert]"),
        disabled: !!e.disabled,
        hitAtCenter: !!hit && (e === hit || e.contains(hit)),
        style: Object.fromEntries(keys.map((k) => [k, s.getPropertyValue(k)])),
      };
    }
    const roots = nodes.map(info);
    const controls = [
      ...document.querySelectorAll('button,[role="button"],select,input'),
    ]
      .filter(
        (e) =>
          e.checkVisibility() &&
          e.getBoundingClientRect().width &&
          e.getBoundingClientRect().height,
      )
      .map(info)
      .filter((e) => e.visible);
    const text = [
      ...new Set(nodes.flatMap((e) => [e, ...e.querySelectorAll("*")])),
    ]
      .filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      )
      .map(info)
      .filter((e) => e.visible);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      roots,
      controls,
      text,
    };
  }, selector);
}
try {
  desk = await startDesk({
    flags: new Set([
      "--headless",
      "--verification",
      "--no-open",
      "--no-auto-load",
    ]),
  });
  const c = desk.comparison;
  for (const spec of cases) {
    console.log("AUDIT LOAD", spec.key);
    const s = await c.api("/situations/" + spec.id, undefined, "GET");
    const slots = [
      { source: "comparator", layout: "mobile" },
      { source: "target", layout: "desktop" },
    ].map((w) => ({
      ...w,
      seat: spec.seat,
      render: "2d",
      profile: "portrait",
    }));
    await c.load(
      s.id,
      slots,
      { 0: s.presentations?.[1], 1: s.presentations?.[2] },
      s,
    );
    if (spec.pane)
      for (const w of c.windows) await showPane(w.page, spec.pane, w.config);
    if (spec.layout) {
      await c.windows[0].page
        .locator(`[data-deck-layout="${spec.layout}"]`)
        .tap();
      await c.windows[1].page
        .locator(".m2-deck-controls")
        .getByRole("button", {
          name: spec.layout[0].toUpperCase() + spec.layout.slice(1),
          exact: true,
        })
        .tap();
    }
    if (spec.preview) {
      for (const w of c.windows) {
        const scope =
          w.config.source === "target"
            ? w.page.locator(".m2-deck-row-list")
            : w.page.locator('[aria-label$="deck browser"]');
        await scope
          .getByRole("button", { name: "View " + spec.preview, exact: true })
          .first()
          .tap();
      }
    }
    const baseline = await Promise.all(
      c.windows.map((w) =>
        c.api("/games/" + w.clone.game_id, undefined, "GET"),
      ),
    );
    assert.equal(baseline[0].hash, baseline[1].hash);
    for (const [profile, size] of sizes) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      for (const w of c.windows) {
        await w.page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        if (w.config.source === "target")
          await w.page.waitForFunction(() => {
            const height = getComputedStyle(
              document.documentElement,
            ).getPropertyValue("--m2-vh");
            return !height || Math.abs(parseFloat(height) - innerHeight) < 1;
          });
      }
      const record = {
        key: spec.key,
        profile,
        situation: spec.id,
        seat: spec.seat,
        selector: spec.selector,
        hash: baseline[0].hash,
        decision: baseline[0].decision,
        observations: await Promise.all(
          c.windows.map((w) => observation(w.page, spec.selector)),
        ),
      };
      try {
        record.image = await captureReport(c, [0, 1]);
        record.css = await extractSources(c, {
          indexes: [0, 1],
          mode: "element",
          selector: spec.selector,
        });
        record.cssDirectory = path.join(DATA, "reports", record.css.id);
        const metadata = JSON.parse(
          await fs.readFile(
            path.join(record.cssDirectory, "comparison.json"),
            "utf8",
          ),
        );
        record.elements = metadata.views.map((v) => v.snapshot.elements.length);
        record.warnings = metadata.views.map((v) => v.snapshot.warnings);
      } catch (error) {
        record.error = error.message;
        console.log("AUDIT ERROR", spec.key, profile, error.message);
      }
      const after = await Promise.all(
        c.windows.map((w) =>
          c.api("/games/" + w.clone.game_id, undefined, "GET"),
        ),
      );
      assert.ok(
        after.every((v) => v.hash === record.hash),
        "Presentation collection changed game state",
      );
      record.diagnostics = c.status().windows.map((w) => ({
        source: w.config.source,
        warnings: w.warnings,
        errors: w.errors,
        assets: w.assets,
      }));
      records.push(record);
      await fs.writeFile(
        path.join(root, "evidence.json"),
        JSON.stringify(
          {
            method:
              "Independent native/target assessment; userscript is comparative evidence, not an oracle.",
            status: c.status(),
            records,
          },
          null,
          2,
        ),
      );
      console.log(
        "AUDIT",
        spec.key,
        profile,
        "roots",
        record.observations.map((o) => o.roots.filter((e) => e.visible).length),
        "controls",
        record.observations.map((o) => o.controls.length),
        "css",
        record.elements || record.error,
      );
    }
  }
  console.log("AUDIT OUTPUT", root);
} finally {
  await desk?.close();
}
