// Evidence collection, not a userscript-equality acceptance test.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
for (const [key, port] of Object.entries({
  DESK: 5900,
  BASE: 5901,
  COMPARATOR: 5902,
  LIVE: 5903,
  BACKEND: 10900,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);
const { DATA, TOOL } = await import("../config.mjs");
const lab = {
  head: execFileSync("git", [`--work-tree=${TOOL}`, "rev-parse", "HEAD"], {
    cwd: TOOL,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  dirty: !!execFileSync(
    "git",
    [`--work-tree=${TOOL}`, "status", "--porcelain"],
    { cwd: TOOL, encoding: "utf8", windowsHide: true },
  ).trim(),
  runnerSha256: createHash("sha256")
    .update(await fs.readFile(fileURLToPath(import.meta.url)))
    .digest("hex"),
};
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
const requestedProfiles = process.argv
  .find((a) => a.startsWith("--profile="))
  ?.slice(10)
  .split(",");
const selectedSizes = sizes.filter(
  ([name]) => !requestedProfiles || requestedProfiles.includes(name),
);
if (
  !selectedSizes.length ||
  requestedProfiles?.some((name) => !sizes.some(([known]) => known === name))
)
  throw Error("Use --profile=portrait,compact,landscape or a subset");
const allCases = [
  {
    key: "m3-gold-choice",
    id: "555d71a47fd2",
    seat: "hero_takahide",
    selector: "[data-decision-type], [data-m2-gold-choice]",
  },
  ...["hero_arien", "hero_gydion"].flatMap((seat) =>
    ["tree", "list", "grid"].map((layout) => ({
      key: "m4-plan-color-" + seat + "-" + layout,
      id: seat === "hero_arien" ? "e81bc3bd5fff" : "00357f1d97ab",
      seat,
      pane: "deck",
      plan: true,
      sortColor: true,
      layout,
      selector:
        '[aria-label="Projected item upgrade totals"], [data-state="Planned"], .m2-tree-planned, [data-deck-layout], .m2-deck-controls, [role="switch"]',
    })),
  ),
  {
    key: "m1-starting-position",
    id: "a00000000001",
    seat: "hero_arien",
    pane: "board",
    startingPosition: true,
    selector:
      '[aria-label="Starting position"], [class*="startingControls"], [class*="startingPosition"]',
  },
  {
    key: "m1-connection-outage",
    id: "a00000000001",
    seat: "hero_arien",
    pane: "board",
    connectionOutage: true,
    selector: "header, .m2-hud-top, .m2-hud-bottom",
  },
  {
    key: "m2-team-choice",
    id: "50205badf8ea",
    seat: "hero_arien",
    pane: "board",
    selector: '[data-decision-type], [class*="picker"]',
  },
  {
    key: "m3-nested-spell",
    id: "00357f1d97ab",
    seat: "hero_gydion",
    pane: "hand",
    nestedSpell: true,
    selector: '[role="dialog"][aria-label^="Inspect "], .m2-nested-spell-frame',
  },
  ...[
    ["tie", "50205badf8ea", "hero_arien"],
    ["selected", "371c8eb12f74", "hero_arien"],
    ["unqueued", "fa7fa8532f2e", "hero_brogan"],
    ["completed", "cc3e0199b87a", "hero_hanu"],
    ["offboard-completed", "4c76d386ddc6", "hero_hanu"],
    ["emmitt", "f3b4b937c7ab", "hero_emmitt"],
  ].map(([name, id, seat]) => ({
    key: "m3-board-" + name,
    id,
    seat,
    pane: "board",
    selector: "[data-mobile-board-summary], #goa2-m2-summary",
  })),
  {
    key: "m3-focused-gydion",
    id: "00357f1d97ab",
    seat: "hero_gydion",
    pane: "board",
    focusHero: "Gydion",
    selector: "[data-mobile-board-summary], #goa2-m2-summary",
  },
  {
    key: "m3-expanded-brogan",
    id: "5f40e18e9cf2",
    seat: "hero_brogan",
    pane: "heroes",
    expandHero: true,
    selector:
      '[data-mobile-panel="heroes"] [data-mobile-hero="hero_brogan"], [data-m2="sidebar"] [data-m2="hero"]',
  },
  ...[
    [0, "0756dc7f3f79"],
    [1, "158474129d8a"],
    [3, "00357f1d97ab"],
    [9, "5949a8eccf40"],
    [10, "3ae94d18bc3b"],
  ].map(([count, id]) => ({
    key: "m3-public-list-" + count,
    id,
    seat: "hero_gydion",
    pane: "heroes",
    publicSpells: count,
    selector:
      '[role="dialog"][aria-label="Gydion cast spells"], #goa2-m2-spells',
  })),
  ...["large", "image"].map((inspection) => ({
    key: "m3-public-preview-" + inspection,
    id: "cd4b7845c42a",
    seat: "spectator",
    pane: "heroes",
    publicSpells: 1,
    spellPreview: true,
    inspection,
    selector:
      '[aria-label="Public spell preview"], #goa2-m2-details, #goa2-m2-spells',
  })),
  ...["hero_wasp", "spectator"].map((seat) => ({
    key: "m3-private-boundary-" + seat,
    id: "00357f1d97ab",
    seat,
    pane: "heroes",
    publicSpells: 3,
    selector:
      '[role="dialog"][aria-label="Gydion cast spells"], #goa2-m2-spells',
  })),
  ...["tiny", "small"].map((handSize) => ({
    key: "m3-hand-size-" + handSize,
    id: "e81bc3bd5fff",
    seat: "hero_arien",
    pane: "hand",
    handSize,
    selector: "button[data-lab-card], .m2-list-card",
  })),
  ...["large", "image"].map((inspection) => ({
    key: "m4-deck-image-" + inspection,
    id: "00357f1d97ab",
    seat: "hero_gydion",
    pane: "deck",
    layout: "list",
    preview: "Cantrip",
    inspection,
    selector: '[aria-label="Deck card preview"], .m2-deck-preview',
  })),
  ...[
    ["gydion-0", "0756dc7f3f79", "hero_gydion"],
    ["gydion-1", "158474129d8a", "hero_gydion"],
    ["gydion-3", "00357f1d97ab", "hero_gydion"],
    ["gydion-9", "5949a8eccf40", "hero_gydion"],
    ["gydion-10", "3ae94d18bc3b", "hero_gydion"],
    ["gydion-crowded", "f2728687d079", "hero_gydion"],
    ["snorri-empty", "4372410c2d87", "hero_snorri"],
    ["snorri-history", "09fa8b1ac243", "hero_snorri"],
    ["razzle-markers", "3536c730ea73", "hero_razzle"],
    ["emmitt-pair", "f3b4b937c7ab", "hero_emmitt"],
    ["brogan-public", "5f40e18e9cf2", "hero_brogan"],
    ["brogan-masked", "7cc3ce17c3e7", "hero_brogan"],
    ["brogan-offboard", "4c80e4e5f69b", "hero_brogan"],
  ].map(([name, id, seat]) => ({
    key: "m3-roster-" + name,
    id,
    seat,
    pane: "heroes",
    selector: `[data-mobile-panel="heroes"] [data-mobile-hero="${seat}"], [data-m2="sidebar"] [data-m2="hero"]`,
  })),
  ...[
    ["ready", "a00000000002"],
    ["suspended", "15776afb8667"],
    ["finished", "75b7580a23ba"],
    ["paused", "dc818586ba77"],
    ["long-status", "ee0dd0fe03ce"],
  ].map(([name, id]) => ({
    key: "m1-state-" + name,
    id,
    seat: "hero_arien",
    pane: "board",
    selector:
      'header, .m2-hud-top, .m2-hud-bottom, nav[aria-label="Game views"], #goa2-m2-nav, [role="dialog"], [role="region"][aria-labelledby="ready-title"]',
  })),
  {
    key: "m2-snorri-runes",
    id: "0601f17bbdab",
    seat: "hero_snorri",
    selector: "[data-decision-type], .m2-rune-choices",
  },
  {
    key: "m2-gydion-spell",
    id: "dbd50506df47",
    seat: "hero_gydion",
    selector: "[data-decision-type], [data-m2-spell-choice]",
  },
  {
    key: "m2-emmitt-second",
    id: "eebbbbab698b",
    seat: "hero_emmitt",
    pane: "hand",
    selector: "button[data-lab-card], .m2-list-card",
  },
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
    selector: `[data-mobile-panel="${pane}"], ${{ heroes: '[data-m2="sidebar"]', hand: '[data-m2="hand-list"]', deck: ".m2-deck-browser", log: "#goa2-m2-log", settings: "#goa2-m2-settings" }[pane]}, #goa2-m2-nav, nav[aria-label="Game views"], #goa2-m2-close`,
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
    selector: '[data-decision-type], [class*="_picker_"], header',
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
      { source: "comparator", uiMode: "mobile" },
      { source: "target", uiMode: "desktop" },
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
    if (spec.inspection || spec.handSize) {
      for (const w of c.windows) {
        await showPane(w.page, "settings", w.config);
        if (spec.inspection)
          await (
            w.config.source === "target"
              ? w.page.locator('[data-setting="spell-view"]')
              : w.page.getByLabel("Inspection style", { exact: true })
          ).selectOption(spec.inspection);
        if (spec.handSize)
          await (
            w.config.source === "target"
              ? w.page.locator('[data-setting="hand-cards"]')
              : w.page.getByLabel("Hand card size", { exact: true })
          ).selectOption(spec.handSize);
      }
    }
    if (spec.pane)
      for (const w of c.windows) await showPane(w.page, spec.pane, w.config);
    if (spec.startingPosition) {
      for (const w of c.windows)
        await w.page
          .getByRole("button", {
            name: /^(Change starting position|Position)$/,
            exact: true,
          })
          .tap();
    }
    if (spec.connectionOutage) {
      for (const w of c.windows) {
        const connection = { outage: false, handles: [] };
        await w.page.routeWebSocket(/\/games\/[^/]+\/ws/, (ws) => {
          if (connection.outage)
            ws.close({ code: 1013, reason: "Layout lab transport outage" });
          else {
            connection.handles.push(ws);
            ws.connectToServer();
          }
        });
        await w.page.reload();
        await w.page.waitForFunction(() => !!window.__GOA2_LAB_STATE__?.view);
        connection.outage = true;
        for (const ws of connection.handles)
          ws.close({ code: 1013, reason: "Layout lab transport outage" });
        await w.page.waitForFunction(() =>
          /Reconnecting[.…]/.test(document.body.textContent),
        );
      }
    }
    if (spec.nestedSpell) {
      const native = c.windows[0],
        target = c.windows[1];
      await native.page
        .getByRole("button", { name: "Cantrip", exact: true })
        .tap();
      await native.page
        .locator('[data-mobile-panel="hand"]')
        .getByRole("button", { name: "Inspect Cantrip", exact: true })
        .tap();
      await native.page
        .getByRole("dialog", { name: "Inspect Cantrip", exact: true })
        .getByRole("button", { name: /^Inspect / })
        .first()
        .tap();
      await target.page
        .locator('[data-m2="hand-list"] .m2-adapted-row')
        .filter({ hasText: "Cantrip" })
        .first()
        .tap();
      await target.page
        .locator(".m2-text-card:visible .m2-inline-spell")
        .first()
        .tap();
      await target.page.locator(".m2-nested-spell-frame").waitFor();
    }
    if (spec.focusHero) {
      await c.windows[0].page
        .getByRole("button", { name: "Focus " + spec.focusHero, exact: true })
        .tap();
      await c.windows[1].page
        .getByRole("button", { name: new RegExp("^Open " + spec.focusHero) })
        .first()
        .tap();
    }
    if (spec.expandHero)
      await c.windows[0].page
        .locator(
          '[data-mobile-panel="heroes"] [data-mobile-hero="hero_brogan"] button[aria-expanded]',
        )
        .tap();
    if (spec.handSize) {
      // Settings closes the native transient reader, while Target retains it.
      // Reopen the same selected card before judging card-size parity.
      await c.windows[0].page
        .getByRole("button", { name: "Noble Blade", exact: true })
        .tap();
    }
    if (spec.plan) {
      const native = c.windows[0],
        target = c.windows[1];
      await native.page.locator('[data-deck-layout="tree"]').tap();
      await target.page
        .locator(".m2-deck-controls")
        .getByRole("button", { name: "Tree", exact: true })
        .tap();
      const offered = native.page
        .locator('[data-tier="2"] [data-deck-card][data-state="Available"]')
        .first()
        .getByRole("button");
      const label = await offered.getAttribute("aria-label");
      await offered.tap();
      await native.page
        .getByRole("button", { name: "Close preview", exact: true })
        .tap();
      const button = target.page
        .locator(".m2-deck-browser")
        .getByRole("button", {
          name: new RegExp(
            "^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\.|$)",
          ),
        })
        .first();
      await button.tap();
      await target.page
        .getByRole("button", { name: "Close card details", exact: true })
        .tap();
    }
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
    if (spec.sortColor) {
      for (const w of c.windows) {
        const sort =
          w.config.source === "target"
            ? w.page.locator('.m2-deck-controls [role="switch"]')
            : w.page.getByRole("switch", {
                name: "Sort by color instead of tier",
                exact: true,
              });
        if ((await sort.getAttribute("aria-checked")) !== "true")
          await sort.tap();
      }
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
    if (spec.publicSpells !== undefined) {
      for (const w of c.windows) {
        await w.page
          .getByRole("button", {
            name: `Spells cast: ${spec.publicSpells}`,
            exact: true,
          })
          .first()
          .tap();
        if (spec.spellPreview) {
          if (w.config.source === "target")
            await w.page
              .locator("#goa2-m2-spells button[data-spell-id]")
              .first()
              .tap();
          else
            await w.page
              .getByRole("dialog", { name: "Gydion cast spells" })
              .getByRole("button", { name: /^View / })
              .first()
              .tap();
        }
      }
    }
    const privacy = [];
    for (const w of c.windows) {
      const scoped = await w.page.evaluate(() => {
        const hero = Object.values(window.__GOA2_LAB_STATE__.view.teams)
          .flatMap((t) => t.heroes)
          .find((h) => h.id === "hero_gydion");
        return hero
          ? {
              preparedKnown: Array.isArray(hero.spellbook),
              preparedCount: Array.isArray(hero.spellbook)
                ? hero.spellbook.length
                : hero.spellbook?.count,
              publicCast: hero.cast_spells?.length,
            }
          : null;
      });
      if (scoped)
        assert.equal(
          scoped.preparedKnown,
          spec.seat === "hero_gydion",
          "Prepared spells crossed viewer boundary",
        );
      privacy.push(scoped);
    }
    const baseline = await Promise.all(
      c.windows.map((w) =>
        c.api("/games/" + w.clone.game_id, undefined, "GET"),
      ),
    );
    assert.equal(baseline[0].hash, baseline[1].hash);
    for (const [profile, size] of selectedSizes) {
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
        privacy,
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
      record.observations = await Promise.all(
        c.windows.map((w) => observation(w.page, spec.selector)),
      );
      const targetChoices = {
        "m2-action": "[data-m2-action-choice]",
        "m3-gold-choice": "[data-m2-gold-choice]",
        "m2-defense": 'button[class*="_option_"]',
        "m2-discard": ".m2-discard-row",
        "m2-gydion-spell": "[data-m2-spell-choice]",
        "m2-snorri-runes": ".m2-rune-choices button",
      };
      if (targetChoices[spec.key] && profile === "landscape") {
        record.reachability = [];
        for (const w of c.windows) {
          const choices = w.page.locator(
            w.config.source === "target"
              ? targetChoices[spec.key]
              : "[data-decision-type] button[aria-pressed]",
          );
          const checks = [];
          const count = await choices.count();
          if (!count)
            checks.push({
              reachable: false,
              error: "No offered choices matched",
            });
          for (let i = 0; i < count; i++) {
            const choice = choices.nth(i);
            try {
              await choice.scrollIntoViewIfNeeded();
              await choice.tap({ trial: true, timeout: 5000 });
              checks.push({
                label: await choice.innerText(),
                reachable: true,
                bounds: await choice.boundingBox(),
              });
            } catch (error) {
              const obstruction = await choice.evaluate((e) => {
                const r = e.getBoundingClientRect();
                return {
                  bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
                  points: [0.1, 0.5, 0.9].flatMap((y) =>
                    [0.1, 0.5, 0.9].map((x) => {
                      const cx = r.x + r.width * x,
                        cy = r.y + r.height * y;
                      const hit = document.elementFromPoint(cx, cy);
                      return {
                        x: r.width * x,
                        y: r.height * y,
                        inViewport:
                          cx >= 0 &&
                          cy >= 0 &&
                          cx < innerWidth &&
                          cy < innerHeight,
                        hit: hit?.outerHTML.slice(0, 300),
                        ok: !!hit && (hit === e || e.contains(hit)),
                      };
                    }),
                  ),
                };
              });
              const screenshot = `${spec.key}-${profile}-${w.config.source}-obstruction.png`;
              await w.page.screenshot({
                path: path.join(root, screenshot),
                animations: "disabled",
              });
              let alternateReachable = false;
              const point = obstruction.points.find(
                (p) => p.inViewport && p.ok,
              );
              if (point) {
                try {
                  await choice.tap({
                    trial: true,
                    position: { x: point.x, y: point.y },
                    timeout: 1000,
                  });
                  alternateReachable = true;
                } catch {}
              }
              checks.push({
                label: await choice.innerText(),
                reachable: alternateReachable,
                centerReachable: false,
                obstruction,
                screenshot,
                error: error.message,
              });
            }
          }
          record.reachability.push({ source: w.config.source, checks });
        }
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
            lab,
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
