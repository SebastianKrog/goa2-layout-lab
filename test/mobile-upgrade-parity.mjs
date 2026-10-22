// Paired M6 presentation evidence. The separate item-history case advances
// four single upgrades on isolated clones to observe earlier item awards.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
for (const [k, p] of Object.entries({
  DESK: 5920,
  BASE: 5921,
  COMPARATOR: 5922,
  LIVE: 5923,
  BACKEND: 10920,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(p);
process.env.NODE_ENV = "production";
process.env.WSLENV = [process.env.WSLENV, "NODE_ENV"].filter(Boolean).join(":");
const { startDesk } = await import("../src/desk.mjs");
const { captureReport } = await import("../src/report.mjs");
const { DATA } = await import("../src/config.mjs");
const desk = await startDesk({
  flags: new Set([
    "--headless",
    "--verification",
    "--no-open",
    "--no-auto-load",
  ]),
});
const c = desk.comparison;
const out = DATA + "/reviews/m6-parity-" + Date.now();
await fs.mkdir(out, { recursive: true });
const records = [];
try {
  for (const profile of process.argv
    .find((a) => a.startsWith("--profile="))
    ?.slice(10)
    .split(",") ?? ["portrait", "compact", "landscape"]) {
    await c.load(
      "3fd1f952c1a6",
      [
        { source: "live", uiMode: "mobile" },
        { source: "target", uiMode: "desktop" },
      ].map((w) => ({ ...w, profile, render: "2d", seat: "hero_arien" })),
    );
    let [n, t] = c.windows.map((w) => w.page);
    for (const p of [n, t]) await p.emulateMedia({ reducedMotion: "reduce" });
    const hashes = await Promise.all(
      c.windows.map((w) =>
        c
          .api("/games/" + w.clone.game_id, undefined, "GET")
          .then((g) => g.hash),
      ),
    );
    assert.equal(hashes[0], hashes[1]);
    const card = (p, id) =>
      p.locator(
        p === n
          ? `[data-deck-card="${id}"] > button`
          : `.m2-upgrade-browser button[data-card-id="${id}"]`,
      );
    async function record(state, only) {
      const ids = await n
        .locator("[data-deck-card]")
        .evaluateAll((ns) => ns.map((n) => n.dataset.deckCard));
      for (const id of ids.filter((id) => !only || id === only)) {
        const buttons = [card(n, id), card(t, id)];
        const pngs = [];
        const css = [];
        for (const b of buttons) {
          pngs.push(
            PNG.sync.read(await b.screenshot({ animations: "disabled" })),
          );
          css.push(
            await b.evaluate((b) => {
              const s = getComputedStyle(b);
              return {
                width: b.offsetWidth,
                height: b.offsetHeight,
                border: s.borderColor,
                background: s.backgroundColor,
                shadow: s.boxShadow,
                opacity: s.opacity,
                outline: s.outline,
                children: [...b.querySelectorAll("img")].map((i) => {
                  const r = i.getBoundingClientRect(),
                    p = b.getBoundingClientRect();
                  return {
                    src: new URL(i.src).pathname,
                    x: r.x - p.x,
                    y: r.y - p.y,
                    width: r.width,
                    height: r.height,
                  };
                }),
              };
            }),
          );
        }
        for (const property of [
          "width",
          "height",
          "border",
          "background",
          "shadow",
          "opacity",
        ])
          assert.deepEqual(
            css[0][property],
            css[1][property],
            `${profile}/${state}/${id}: ${property}`,
          );
        if (state === "focus")
          assert.equal(
            css[0].outline,
            css[1].outline,
            "keyboard focus outline",
          );
        assert.deepEqual(
          css[0].children,
          css[1].children,
          `${profile}/${state}/${id}: icon geometry`,
        );
        const [a, b] = pngs;
        assert.equal(a.width, b.width, `${state}/${id}: width`);
        assert.equal(a.height, b.height, `${state}/${id}: height`);
        const combined = new PNG({ width: a.width * 2, height: a.height });
        PNG.bitblt(a, combined, 0, 0, a.width, a.height, 0, 0);
        PNG.bitblt(b, combined, 0, 0, b.width, b.height, a.width, 0);
        const diff = new PNG({ width: a.width, height: a.height });
        const changed = pixelmatch(
          a.data,
          b.data,
          diff.data,
          a.width,
          a.height,
          { threshold: 0.1 },
        );
        await fs.writeFile(
          `${out}/${profile}-${state}-${id}.png`,
          PNG.sync.write(combined),
        );
        await fs.writeFile(
          `${out}/${profile}-${state}-${id}-diff.png`,
          PNG.sync.write(diff),
        );
        records.push({
          profile,
          state,
          id,
          changed,
          pixels: a.width * a.height,
          css,
        });
      }
      await fs.writeFile(
        out + "/cards.json",
        JSON.stringify(
          {
            references: c.services.references,
            source: "live working tree",
            records,
          },
          null,
          2,
        ),
      );
      console.log("CAPTURE", profile, state);
    }
    await n
      .getByRole("button", { name: /^Choose / })
      .first()
      .waitFor();
    await record("initial");
    for (const p of [n, t]) await card(p, "raging_stream").tap();
    await n
      .getByRole("button", { name: /^Choose / })
      .first()
      .waitFor();
    await record("staged");
    for (const p of [n, t]) await card(p, "raging_stream").hover();
    await record("hover", "raging_stream");
    for (const p of [n, t]) {
      await card(p, "raging_stream").focus();
      await p.keyboard.press("Shift+Tab");
      await p.keyboard.press("Tab");
    }
    await record("focus", "raging_stream");
    for (const p of [n, t])
      await p.getByRole("switch", { name: "Preview", exact: true }).tap();
    for (const p of [n, t]) await card(p, "arcane_whirlpool").tap();
    await record("preview");
    for (const p of [n, t])
      await p.getByRole("switch", { name: "Preview", exact: true }).tap();
    for (const p of [n, t])
      await p.getByRole("button", { name: "Reset", exact: true }).tap();
    for (const p of [n, t])
      await p
        .locator(
          '[aria-label="Deck upgrade paths"],.m2-upgrade-browser .m2-deck-row-list',
        )
        .evaluate((node) => {
          const scroll = node.closest('[class*="scroll"]') ?? node;
          scroll.scrollTop = 0;
        });
    await n
      .getByRole("button", { name: /^Choose / })
      .first()
      .waitFor();
    for (const p of [n, t])
      await p.screenshot({
        path: `${out}/${profile}-${p === n ? "native" : "target"}-reset.png`,
        animations: "disabled",
      });
    const report = await captureReport(c, [0, 1]);
    await fs.writeFile(
      `${out}/${profile}-viewer.json`,
      JSON.stringify(report, null, 2),
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await c.api("/games/" + c.windows[i].clone.game_id, undefined, "GET"))
          .hash,
        hashes[i],
      );
    assert.deepEqual(c.windows[0].errors, []);
    if (profile === "compact") {
      // Reuse the normalized shared fixture; do not generate another local draft.
      await c.load(
        "d296bd2e5d3d",
        [
          { source: "live", uiMode: "mobile" },
          { source: "target", uiMode: "desktop" },
        ].map((w) => ({ ...w, profile, render: "2d", seat: "hero_arien" })),
      );
      [n, t] = c.windows.map((w) => w.page);
      for (const p of [n, t]) await p.emulateMedia({ reducedMotion: "reduce" });
      for (let i = 0; i < 4; i++) {
        for (const p of [n, t]) {
          const old = await p.evaluate(
            () => window.__GOA2_LAB_STATE__.input_request.request_id,
          );
          await p.evaluate(() => {
            const req = window.__GOA2_LAB_STATE__.input_request;
            const socket = [...window.__GOA2_LAB_SYNC__.sockets].find(
              (s) => s.readyState === 1,
            );
            socket.send(
              JSON.stringify({
                type: "SUBMIT_INPUT",
                request_id: req.request_id,
                selection: {
                  hero_id: "hero_arien",
                  card_id: req.players.hero_arien.options[0].pair[0],
                },
              }),
            );
          });
          await p.waitForFunction(
            (old) =>
              window.__GOA2_LAB_STATE__.input_request?.request_id !== old,
            old,
          );
        }
        await n
          .getByRole("button", { name: /^Choose / })
          .first()
          .waitFor();
      }
      await n.locator('[data-state="Item"]').first().waitFor();
      await t.locator(".m2-upgrade-browser .m2-tree-item").first().waitFor();
      await record("item-history");
      for (const w of c.windows) assert.deepEqual(w.errors, []);
    }
  }
  console.log("Evidence:", out);
} finally {
  await desk.close();
}
