// Shared card rendering against the frozen userscript; presentation-only checks.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
for (const [k, p] of Object.entries({
  DESK: 5940,
  BASE: 5941,
  COMPARATOR: 5942,
  LIVE: 5943,
  BACKEND: 10940,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(p);
process.env.NODE_ENV = "production";
process.env.WSLENV = [process.env.WSLENV, "NODE_ENV"].filter(Boolean).join(":");
const { startDesk } = await import("../src/desk.mjs");
const { DATA } = await import("../src/config.mjs");
const { showPane } = await import("../src/presentation.mjs");
const { captureReport } = await import("../src/report.mjs");
const cases = [
  ...["history", "nano"].map((kind) => ({
    key: kind,
    id: kind === "history" ? "5f40e18e9cf2" : "7cc3ce17c3e7",
    seat: "hero_brogan",
    kind,
    native: `[data-mobile-hero="hero_brogan"] [class*="_${kind === "history" ? "historyCard" : "nanoCard"}_"]`,
    target: `.m2-hero-dashboard:has(img[alt="Brogan"]) ${kind === "history" ? ".m2-micro-hero" : ".m2-discard-cards .m2-nano-card"}`,
  })),
  {
    key: "upgrade-large",
    id: "3fd1f952c1a6",
    seat: "hero_arien",
    kind: "upgrade",
    card: "raging_stream",
    native: '[data-mobile-upgrade-picker] [data-card-size="large"]',
    target: ".m2-upgrade-details > .m2-text-card",
  },
  {
    key: "deck-large",
    id: "e81bc3bd5fff",
    seat: "hero_arien",
    kind: "deck",
    card: "Noble Blade",
    mode: "large",
    native: '[aria-label="Deck card preview"] [data-card-size="large"]',
    target: ".m2-deck-preview > .m2-text-card",
  },

  ...["small", "tiny"].map((size) => ({
    key: "hand-" + size,
    id: "e81bc3bd5fff",
    seat: "hero_arien",
    kind: "hand",
    size,
    native: `[data-mobile-panel="hand"] [data-card-size="${size}"]`,
    target: '[data-m2="hand-list"] .m2-list-card',
  })),
  ...["large", "image"].map((mode) => ({
    key: "spell-" + mode,
    id: "5949a8eccf40",
    seat: "hero_gydion",
    kind: "spell",
    mode,
    native: '[aria-label="Public spell preview"]',
    target: "#goa2-m2-hero-display",
  })),
  {
    key: "spell-rank4",
    id: "cd4b7845c42a",
    seat: "spectator",
    kind: "spell",
    mode: "large",
    native: '[aria-label="Public spell preview"]',
    target: "#goa2-m2-hero-display",
  },
];
const selected = process.argv
  .find((a) => a.startsWith("--case="))
  ?.slice(7)
  .split(",");
const profiles = process.argv
  .find((a) => a.startsWith("--profile="))
  ?.slice(10)
  .split(",") ?? ["portrait", "compact", "landscape"];
const desk = await startDesk({
  flags: new Set([
    "--headless",
    "--verification",
    "--no-auto-load",
    "--no-open",
  ]),
});
const c = desk.comparison;
const root = DATA + "/reviews/cards-" + Date.now();
await fs.mkdir(root, { recursive: true });
const records = [];
async function snapshot(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((root) => ({
      html: root.outerHTML,
      elements: [root, ...root.querySelectorAll("*")].map((el, index) => {
        const s = getComputedStyle(el),
          r = el.getBoundingClientRect(),
          b = root.getBoundingClientRect();
        return {
          index,
          tag: el.tagName,
          text: el.children.length ? undefined : el.textContent,
          rect: {
            x: r.x - b.x,
            y: r.y - b.y,
            width: r.width,
            height: r.height,
          },
          style: Object.fromEntries(
            [
              "font",
              "font-size",
              "line-height",
              "font-weight",
              "color",
              "background-color",
              "display",
              "position",
              "z-index",
              "padding",
              "gap",
              "min-height",
              "height",
              "width",
              "filter",
              "backdrop-filter",
              "mask-image",
              "transform",
              "transform-origin",
              "opacity",
              "grid-template-columns",
            ].map((k) => [k, s.getPropertyValue(k)]),
          ),
        };
      }),
    }));
}
try {
  for (const spec of cases.filter(
    (s) =>
      (!selected || selected.some((k) => s.key.startsWith(k))) &&
      (!process.argv.includes("--selected") ||
        ["hand", "deck", "spell"].includes(s.kind)),
  )) {
    console.log("CARD LOAD", spec.key);
    await c.load(
      spec.id,
      [
        { source: "live", uiMode: "mobile" },
        { source: "target", uiMode: "desktop" },
      ].map((w) => ({
        ...w,
        profile: "portrait",
        render: "2d",
        seat: spec.seat,
      })),
    );
    const [n, t] = c.windows.map((w) => w.page);
    for (const p of [n, t]) await p.emulateMedia({ reducedMotion: "reduce" });
    if (spec.mode || spec.size)
      for (const w of c.windows) {
        await showPane(w.page, "settings", w.config);
        await (
          w.config.source === "target"
            ? w.page.locator(
                spec.size
                  ? '[data-setting="hand-cards"]'
                  : '[data-setting="spell-view"]',
              )
            : w.page.getByLabel(
                spec.size ? "Hand card size" : "Inspection style",
                { exact: true },
              )
        ).selectOption(spec.size ?? spec.mode);
      }
    if (spec.kind === "upgrade") {
      await n
        .getByRole("button", { name: /^Choose / })
        .first()
        .waitFor();
      await n.locator(`[data-deck-card="${spec.card}"] > button`).tap();
      await t
        .locator(`.m2-upgrade-browser [data-card-id="${spec.card}"]`)
        .tap();
    }
    if (spec.kind === "deck") {
      for (const w of c.windows) await showPane(w.page, "deck", w.config);
      await n.locator('[data-deck-layout="list"]').tap();
      await t
        .locator(".m2-deck-controls")
        .getByRole("button", { name: "List", exact: true })
        .tap();
      await n
        .getByRole("button", { name: "View " + spec.card, exact: true })
        .tap();
      await t
        .locator(".m2-deck-row-list")
        .getByRole("button", { name: "View " + spec.card, exact: true })
        .tap();
    }
    if (["history", "nano"].includes(spec.kind))
      for (const w of c.windows) await showPane(w.page, "heroes", w.config);
    if (spec.kind === "hand")
      for (const w of c.windows) await showPane(w.page, "hand", w.config);
    if (spec.kind === "spell") {
      for (const w of c.windows) {
        await showPane(w.page, "heroes", w.config);
        await w.page
          .getByRole("button", { name: /^Spells cast:/ })
          .first()
          .tap();
      }
      const spell = await n.evaluate(
        () =>
          Object.values(window.__GOA2_LAB_STATE__.view.teams)
            .flatMap((t) => t.heroes)
            .find((h) => h.id === "hero_gydion").cast_spells[0],
      );
      await n
        .getByRole("button", { name: "View " + spell.name, exact: true })
        .tap();
      await t
        .locator(`#goa2-m2-spells [data-spell-id="${spell.id}"]`)
        .first()
        .tap();
    }
    if (process.argv.includes("--selected") && spec.kind === "hand") {
      await n.locator(spec.native).first().tap();
      await t.locator(spec.target).first().tap();
    }
    if (process.argv.includes("--selected")) {
      const selectors = [
        '[data-card-viewed="true"]:visible',
        ".m2-card-source[data-m2-viewed]:visible",
      ];
      const results = [];
      for (const [i, p] of [n, t].entries()) {
        const source = p.locator(selectors[i]).first();
        await source.waitFor();
        const read = () =>
          source.evaluate((el) => {
            const s = getComputedStyle(el, "::after");
            return {
              background: s.backgroundImage,
              pointer: s.pointerEvents,
              z: s.zIndex,
            };
          });
        const reduced = await read();
        await p.emulateMedia({ reducedMotion: "no-preference" });
        const animation = await source.evaluate(async (el) => {
          await new Promise(requestAnimationFrame);
          const animations = el
            .getAnimations({ subtree: true })
            .filter((a) => /viewed/i.test(a.animationName));
          for (const a of animations) {
            a.pause();
            a.currentTime = 1000;
          }
          await new Promise(requestAnimationFrame);
          const s = getComputedStyle(el, "::after");
          return {
            count: animations.length,
            durations: animations
              .map((a) => a.effect.getTiming().duration)
              .sort(),
            background: s.backgroundImage,
          };
        });
        assert.equal(animation.count, 2);
        assert.deepEqual(animation.durations, [4000, 4200]);
        assert.notEqual(
          animation.background,
          reduced.background,
          "Selected sheen must animate",
        );
        assert.equal(reduced.pointer, "none");
        assert.equal(reduced.z, "10");
        results.push({ reduced, animation });
        await p.emulateMedia({ reducedMotion: "reduce" });
      }
      assert.deepEqual(
        results[0],
        results[1],
        "Native selection sheen must match the userscript",
      );
      await fs.writeFile(
        root + "/" + spec.key + "-selection.json",
        JSON.stringify(results, null, 2),
      );
    }
    await n.locator(spec.native).first().waitFor();
    await t.locator(spec.target).first().waitFor();
    for (const profile of profiles) {
      const size = {
        portrait: { width: 390, height: 844 },
        compact: { width: 360, height: 800 },
        landscape: { width: 844, height: 390 },
      }[profile];
      assert.ok(size);
      for (const p of [n, t]) await p.setViewportSize(size);
      for (const p of [n, t])
        await p.waitForFunction(() =>
          [...document.images]
            .filter((i) => i.getBoundingClientRect().width > 0)
            .every((i) => i.complete),
        );
      const sources = await Promise.all([
        snapshot(n, spec.native),
        snapshot(t, spec.target),
      ]);
      await fs.writeFile(
        `${root}/${spec.key}-${profile}.json`,
        JSON.stringify(sources, null, 2),
      );
      const layers = await Promise.all(
        [n, t].map((p, i) =>
          p
            .locator(i ? spec.target : spec.native)
            .first()
            .evaluate((root) => {
              const art = root.querySelector(
                '[aria-hidden="true"] > img[class*="backdrop"], .m2-card-art > img',
              );
              const read = (el, pseudo) =>
                el
                  ? Object.fromEntries(
                      [
                        "filter",
                        "backdrop-filter",
                        "mask-image",
                        "transform",
                        "opacity",
                      ].map((k) => [
                        k,
                        getComputedStyle(el, pseudo).getPropertyValue(k),
                      ]),
                    )
                  : null;
              return {
                image: read(art),
                mask: read(art?.parentElement),
                bars: [
                  ...root.querySelectorAll(
                    "header,footer,.m2-card-top,.m2-card-foot",
                  ),
                ].map((el) => read(el, "::before")),
              };
            }),
        ),
      );
      if (
        !spec.key.includes("image") &&
        !["history", "nano"].includes(spec.kind)
      ) {
        assert.ok(
          layers[0].image && layers[1].image,
          spec.key + " artwork must be loaded in both views",
        );
        assert.deepEqual(
          layers[0].image,
          layers[1].image,
          spec.key + " artwork blur/scale",
        );
        assert.deepEqual(
          layers[0].mask,
          layers[1].mask,
          spec.key + " artwork mask/opacity",
        );
        assert.ok(
          layers[0].bars.every((b) => b["backdrop-filter"] === "blur(5px)"),
          spec.key + " blurred bars",
        );
      }
      await fs.writeFile(
        root + "/" + spec.key + "-" + profile + "-layers.json",
        JSON.stringify(layers, null, 2),
      );
      for (const [i, p] of [n, t].entries())
        await p
          .locator(i ? spec.target : spec.native)
          .evaluateAll((els) =>
            els.forEach((el) => el.setAttribute("data-lab-card-crop", "")),
          );
      const crops = await captureReport(c, [0, 1], {
        crop: {
          selector: "[data-lab-card-crop]",
          match: ["hand", "history", "nano"].includes(spec.kind)
            ? "combine"
            : "nth",
          ...(["hand", "history", "nano"].includes(spec.kind)
            ? {}
            : { occurrence: 1 }),
        },
      }).catch((error) => {
        if (!error.message.includes("no visible matches")) throw error;
        return { unavailable: error.message };
      });
      if (crops.id && ["hand", "history", "nano"].includes(spec.kind)) {
        const meta = JSON.parse(
          await fs.readFile(
            DATA + "/reports/" + crops.id + "/report.json",
            "utf8",
          ),
        );
        assert.equal(
          meta.captures[0].parts.length,
          meta.captures[1].parts.length,
          "Combined crops must match the same number of cards",
        );
      }
      const report = await captureReport(c, [0, 1]);
      assert.equal(report.diverged, false);
      records.push({ key: spec.key, profile, crops, ...report });
      await fs.writeFile(
        root + "/reports.json",
        JSON.stringify(
          { references: c.services.references, workingTree: true, records },
          null,
          2,
        ),
      );
      console.log("CARD", spec.key, profile, report.id);
      assert.deepEqual(c.windows[0].errors, []);
    }
  }
  console.log("Card evidence:", root);
} catch (error) {
  for (const [i, w] of c.windows.entries()) {
    await w.page
      .screenshot({ path: root + "/failure-" + i + ".png" })
      .catch(() => {});
    console.error("Render errors", i, w.errors);
  }
  throw error;
} finally {
  await desk.close();
}
