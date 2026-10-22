import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { startDesk } from "../src/desk.mjs";
import { DATA } from "../src/config.mjs";
import { showPane } from "../src/presentation.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const c = app.comparison;
const out = path.join(
  DATA,
  "reviews/mobile-motion",
  process.env.GOA2_REVIEW_TAG || "baseline",
);
await fs.mkdir(out, { recursive: true });
try {
  const situations = await c.api("/situations", undefined, "GET");
  const s = situations.find((s) => s.id === "a00000000001");
  await c.load(
    s.id,
    [
      { source: "live", uiMode: "mobile" },
      { source: "target", uiMode: "desktop" },
    ].map((w) => ({
      ...w,
      profile: "portrait",
      render: "2d",
      seat: "hero_arien",
    })),
    {},
    s,
  );
  const record = { reference: c.status(), samples: [] };
  const save = () =>
    fs.writeFile(
      path.join(out, "motion.json"),
      JSON.stringify(record, null, 2),
    );
  for (const [index, w] of c.windows.entries()) {
    await w.page.setViewportSize({ width: 378, height: 781 });
    for (const motion of [null, "no-preference", "reduce"]) {
      await w.page.emulateMedia({ reducedMotion: motion });
      for (const pane of ["board", "heroes"]) {
        await showPane(w.page, pane, w.config);
        const selector =
          index === 0
            ? `${pane === "board" ? "[data-mobile-board-summary]" : "[data-mobile-panel=heroes]"} [class*=selectingDots]`
            : `${pane === "board" ? "#goa2-m2-summary" : "[data-m2-mode=heroes]"} .m2-selecting-dots`;
        await w.page.locator(selector).first().waitFor();
        const frames = [];
        for (let sample = 0; sample < 10; sample++) {
          frames.push(
            await w.page
              .locator(selector)
              .first()
              .evaluate((e) => {
                const s = getComputedStyle(e),
                  r = e.getBoundingClientRect();
                return {
                  clip: s.clipPath,
                  width: r.width,
                  height: r.height,
                  animation: s.animation,
                  animations: e
                    .getAnimations()
                    .map((a) => ({ state: a.playState, time: a.currentTime })),
                  reduce: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches,
                };
              }),
          );
          await w.page.waitForTimeout(180);
        }
        const uniqueClips = [...new Set(frames.map((f) => f.clip))];
        if (motion !== null)
          assert.equal(frames[0].reduce, motion === "reduce");
        if (!frames[0].reduce) {
          assert.equal(
            uniqueClips.length,
            3,
            `${index}/${pane}: dots visibly cycle all three stages`,
          );
          const images = [];
          for (const [frame, time] of [0, 550, 1050].entries()) {
            await w.page
              .locator(selector)
              .first()
              .evaluate((e, time) => {
                e.getAnimations()[0].pause();
                e.getAnimations()[0].currentTime = time;
              }, time);
            const bytes = await w.page
              .locator(selector)
              .first()
              .screenshot({
                path: path.join(
                  out,
                  `dots-${index}-${pane}-${motion}-${frame}.png`,
                ),
              });
            images.push(createHash("sha256").update(bytes).digest("hex"));
          }
          assert.equal(
            new Set(images).size,
            3,
            `${index}/${pane}: all three dots stages have different pixels`,
          );
          await w.page
            .locator(selector)
            .first()
            .evaluate((e) => e.getAnimations()[0].play());
        } else assert.equal(uniqueClips.length, 1, "Reduced motion is static");
        const rows = await w.page
          .locator(
            index === 0
              ? "[data-mobile-board-summary] > div"
              : "#goa2-m2-summary > article",
          )
          .evaluateAll((es) =>
            es.map((e) => ({
              background: getComputedStyle(e).backgroundColor,
              blur: getComputedStyle(e).backdropFilter,
            })),
          );
        if (pane === "board")
          for (const row of rows) {
            assert.equal(row.blur, "blur(3px)");
            assert.equal(row.background, "rgba(32, 41, 54, 0.72)");
          }
        record.samples.push({ index, motion, pane, frames, rows });
        await save();
        console.log(
          JSON.stringify({
            index,
            motion,
            pane,
            clips: [...new Set(frames.map((f) => f.clip))],
            reduce: frames[0].reduce,
            animation: frames[0].animation,
            rows,
          }),
        );
      }
    }
    await w.page.emulateMedia({ reducedMotion: "no-preference" });
    await showPane(w.page, "board", w.config);
    await w.page
      .locator(
        index === 0
          ? 'button[aria-label="Focus Arien"]'
          : ".m2-summary-identity",
      )
      .first()
      .click();
    const focused = w.page
      .locator(
        index === 0
          ? "[data-mobile-board-summary][data-focused] [data-mobile-hero]"
          : ".m2-focused-hero",
      )
      .first();
    await focused.waitFor();
    const glass = await focused.evaluate((e) => ({
      blur: getComputedStyle(e).backdropFilter,
      background: getComputedStyle(e).backgroundColor,
    }));
    assert.equal(glass.blur, "blur(3px)");
    assert.equal(glass.background, "rgba(27, 34, 45, 0.72)");
    await focused.screenshot({ path: path.join(out, `focused-${index}.png`) });
    record.samples.push({ index, focused: glass });
    await save();
  }
  for (const [id, seat, kind] of [
    ["7cc3ce17c3e7", "hero_brogan", "active-pile"],
    ["f2728687d079", "hero_gydion", "ultimate"],
  ]) {
    const fixture = situations.find((s) => s.id === id);
    assert.ok(fixture);
    await c.load(
      id,
      [
        { source: "live", uiMode: "mobile" },
        { source: "target", uiMode: "desktop" },
      ].map((w) => ({ ...w, profile: "portrait", render: "2d", seat })),
      {},
      fixture,
    );
    for (const [index, w] of c.windows.entries()) {
      await showPane(w.page, "board", w.config);
      const selector =
        kind === "active-pile"
          ? index === 0
            ? "[data-mobile-board-summary] i[data-card-active]"
            : "#goa2-m2-summary .m2-summary-piles i.m2-effect-active"
          : index === 0
            ? "[data-mobile-board-summary] [class*=boardUltimate][data-unlocked]"
            : "#goa2-m2-summary .m2-ultimate-unlocked";
      const element = w.page.locator(selector).first();
      await element.waitFor();
      for (const motion of ["no-preference", "reduce"]) {
        await w.page.emulateMedia({ reducedMotion: motion });
        const frames = [];
        for (let frame = 0; frame < 8; frame++) {
          frames.push(
            await element.evaluate((e) => ({
              animation: getComputedStyle(e).animation,
              shadow: getComputedStyle(e).boxShadow,
              background: getComputedStyle(e).backgroundColor,
              states: e.getAnimations().map((a) => a.playState),
            })),
          );
          await w.page.waitForTimeout(180);
        }
        const shadows = new Set(frames.map((f) => f.shadow));
        if (motion === "reduce") {
          assert.equal(shadows.size, 1);
          assert.ok(frames.every((f) => f.states.length === 0));
        } else {
          assert.ok(shadows.size > 2, `${index}/${kind}: glow visibly changes`);
          assert.ok(frames.every((f) => f.states.includes("running")));
        }
        record.samples.push({ index, kind, motion, frames });
        await save();
      }
      await w.page.emulateMedia({ reducedMotion: "no-preference" });
      await w.page.screenshot({ path: path.join(out, `${kind}-${index}.png`) });
    }
  }
  console.log("Motion and blur acceptance passed:", out);
} finally {
  await app.close();
}
