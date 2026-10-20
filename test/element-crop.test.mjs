import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { DATA } from "../config.mjs";
import { normalizeCrop, resolveCrop, cropImage } from "../element-crop.mjs";
import { stableScreenshot, captureReport, reportHTML } from "../report.mjs";

test("crop options reject ambiguous configuration and use one-based occurrences", () => {
  assert.equal(normalizeCrop(null), null);
  assert.deepEqual(normalizeCrop({ selector: ".card" }), {
    selector: ".card",
    match: "unique",
  });
  for (const bad of [
    "",
    [],
    { selector: "" },
    { selector: ".x", match: "first" },
    { selector: ".x", match: "nth", occurrence: 0 },
    { selector: ".x", match: "nth", occurrence: 1.5 },
  ])
    assert.throws(() => normalizeCrop(bad));
});

test("viewport crop matches use visible DOM order, intersect clipping and preserve actual high-DPI pixels", async () => {
  const browser = await chromium.launch({ headless: true });
  const server = http.createServer((req, res) =>
    res.end("<!doctype html><html><body></body></html>"),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let reportId;
  const reportIds = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 400, height: 300 },
      deviceScaleFactor: 2,
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.setContent(
      `<style>html,body{margin:0;height:100%;background:white}.card{position:absolute;width:40px;height:30px;background:rgb(255,0,0)}#one{left:20px;top:30px}#two{left:100px;top:80px;background:rgb(0,0,255)}#hidden{display:none}#transparent{opacity:0}#offscreen{top:900px}.clip{position:absolute;left:200px;top:100px;width:30px;height:20px;overflow:hidden;border:2px solid black}.clipped{position:absolute;left:10px;top:5px;width:50px;height:40px;background:green}.outside{position:absolute;left:-10px;top:240px;width:30px;height:30px;background:black}</style><div id="hidden" class="card"></div><div id="one" class="card"></div><div id="transparent" class="card"></div><div id="two" class="card"></div><div id="offscreen" class="card"></div><div class="clip"><div class="clipped"></div></div><div class="outside"></div>`,
    );
    const options = (value) => normalizeCrop(value);
    await assert.rejects(
      resolveCrop(page, options({ selector: ".card" })),
      /2 visible matches/,
    );
    await assert.rejects(
      resolveCrop(page, options({ selector: ".missing" })),
      /no visible matches/,
    );
    await assert.rejects(
      resolveCrop(page, options({ selector: "[" })),
      /Invalid crop CSS selector/,
    );
    await assert.rejects(
      resolveCrop(
        page,
        options({ selector: ".card", match: "nth", occurrence: 3 }),
      ),
      /only 2 visible/,
    );
    const second = await resolveCrop(
      page,
      options({ selector: ".card", match: "nth", occurrence: 2 }),
    );
    assert.equal(second.totalMatches, 5);
    assert.equal(second.visibleMatches, 2);
    assert.equal(second.selected[0].id, "two");
    assert.equal(second.selected[0].domIndex, 3);
    assert.deepEqual(second.bounds, { x: 100, y: 80, width: 40, height: 30 });
    const union = await resolveCrop(
      page,
      options({ selector: ".card", match: "union" }),
    );
    assert.deepEqual(union.bounds, { x: 20, y: 30, width: 120, height: 80 });
    const clipped = await resolveCrop(page, options({ selector: ".clipped" }));
    assert.deepEqual(clipped.bounds, { x: 212, y: 107, width: 20, height: 15 });
    const outside = await resolveCrop(page, options({ selector: ".outside" }));
    assert.deepEqual(outside.bounds, { x: 0, y: 240, width: 20, height: 30 });
    const full = PNG.sync.read(await page.screenshot());
    const cropped = cropImage(full, second);
    assert.equal(cropped.image.width, 80);
    assert.equal(cropped.image.height, 60);
    assert.deepEqual([...cropped.image.data.slice(0, 4)], [0, 0, 255, 255]);
    assert.equal(cropped.crop.scaleX, 2);
    const win = {
      page,
      config: { source: "comparator", render: "2d", seat: "hero_arien" },
      clone: { game_id: "fixture" },
      warnings: [],
      errors: [],
      assets: [],
    };
    const shot = await stableScreenshot(win, options({ selector: "#two" }));
    assert.equal(shot.image.width, 80);
    assert.equal(shot.image.height, 60);
    assert.deepEqual(
      await page.evaluate(() => ({
        x: scrollX,
        y: scrollY,
        width: innerWidth,
      })),
      { x: 0, y: 0, width: 400 },
    );
    const secondPage = await browser.newPage({
      viewport: { width: 400, height: 300 },
      deviceScaleFactor: 2,
    });
    await secondPage.goto(`http://127.0.0.1:${server.address().port}`);
    await secondPage.setContent(
      '<div id="two" style="position:absolute;left:12px;top:20px;width:40px;height:30px;background:blue"></div>',
    );
    const comparison = {
      windows: [win, { ...win, page: secondPage }],
      window(i) {
        return this.windows[i];
      },
      ready: async () => {},
      api: async () => ({ hash: "same" }),
      status() {
        return {
          references: { base: "base" },
          comparator: "sha",
          situationId: "fixture",
          windows: [],
        };
      },
    };
    await Promise.all(
      [page, secondPage].map((p) => p.waitForLoadState("networkidle")),
    );
    let activeCaptures = 0,
      maxActiveCaptures = 0;
    for (const p of [page, secondPage]) {
      const screenshot = p.screenshot.bind(p);
      p.screenshot = async (options) => {
        activeCaptures++;
        maxActiveCaptures = Math.max(maxActiveCaptures, activeCaptures);
        try {
          await new Promise((r) => setTimeout(r, 30));
          return await screenshot(options);
        } finally {
          activeCaptures--;
        }
      };
    }
    const result = await captureReport(comparison, [0, 1], {
      crop: { selector: "#two" },
    });
    assert.ok(
      maxActiveCaptures >= 2,
      "Independent browser view captures should overlap",
    );
    reportId = result.id;
    reportIds.push(reportId);
    const meta = JSON.parse(
      await fs.readFile(
        path.join(DATA, "reports", reportId, "report.json"),
        "utf8",
      ),
    );
    assert.equal(meta.captures[0].crop.selected[0].id, "two");
    assert.equal(meta.captures[0].width, 80);
    assert.equal(meta.pairs[0].available, true);
    assert.equal(meta.pairs[0].ratio, 0);
    assert.match(reportHTML(meta), /1 visible matches; 1 selected/);
    await secondPage.evaluate(() => {
      document.querySelector("#two").className = "card";
      document.body.insertAdjacentHTML(
        "afterbegin",
        '<div class="card" style="position:absolute;left:200px;top:150px;width:40px;height:30px;background:red"></div>',
      );
    });
    for (const match of ["individual", "combine"]) {
      const result = await captureReport(comparison, [0, 1], {
        crop: { selector: ".card", match },
      });
      reportIds.push(result.id);
      const dir = path.join(DATA, "reports", result.id);
      const viewer = await browser.newPage();
      const viewerErrors = [];
      viewer.on("pageerror", (e) => viewerErrors.push(e.message));
      await viewer.goto(pathToFileURL(path.join(dir, "index.html")).href);
      assert.deepEqual(viewerErrors, []);
      assert.ok(
        await viewer
          .locator("img")
          .evaluateAll((images) =>
            images.every((i) => i.complete && i.naturalWidth > 0),
          ),
      );
      if (match === "individual")
        assert.match(await viewer.locator("#pair").textContent(), /match 2/);
      else
        assert.equal(
          await viewer.getByText("Individual crops:", { exact: false }).count(),
          2,
        );
      await viewer.close();

      const metadata = JSON.parse(
        await fs.readFile(path.join(dir, "report.json"), "utf8"),
      );
      const red = PNG.sync.read(
        await fs.readFile(path.join(dir, "window-1-match-1.png")),
      );
      const blue = PNG.sync.read(
        await fs.readFile(path.join(dir, "window-1-match-2.png")),
      );
      assert.equal(red.width, 80);
      assert.equal(blue.width, 80);
      assert.deepEqual([...red.data.slice(0, 4)], [255, 0, 0, 255]);
      assert.deepEqual([...blue.data.slice(0, 4)], [0, 0, 255, 255]);
      if (match === "individual") {
        assert.equal(metadata.captures.length, 4);
        assert.equal(metadata.pairs.length, 2);
        assert.ok(metadata.pairs.every((p) => p.ratio === 0));
        assert.ok(
          metadata.pairs.every(
            (p) =>
              metadata.captures[p.a].occurrence ===
              metadata.captures[p.b].occurrence,
          ),
        );
        assert.ok(!metadata.captures.some((c) => c.file === "window-1.png"));
      } else {
        assert.equal(metadata.captures.length, 2);
        const strip = PNG.sync.read(
          await fs.readFile(path.join(dir, "window-1.png")),
        );
        assert.equal(strip.width, 160);
        assert.equal(strip.height, 60);
        assert.deepEqual(
          [...strip.data.slice(80 * 4, 80 * 4 + 4)],
          [0, 0, 255, 255],
        );
        assert.equal(metadata.captures[0].parts.length, 2);
        assert.equal(metadata.captures[0].crop.tiles[1].output.x, 80);
        assert.equal(metadata.pairs[0].ratio, 0);
      }
    }
    await secondPage.evaluate(() => document.querySelector(".card").remove());
    const mismatch = await captureReport(comparison, [0, 1], {
      crop: { selector: ".card", match: "combine" },
    });
    reportIds.push(mismatch.id);
    const mismatchMeta = JSON.parse(
      await fs.readFile(
        path.join(DATA, "reports", mismatch.id, "report.json"),
        "utf8",
      ),
    );
    assert.equal(mismatchMeta.pairs[0].available, false);
    assert.match(mismatchMeta.pairs[0].reason, /Different match counts/);

    await assert.rejects(
      captureReport(comparison, [0, 1], { crop: { selector: ".card" } }),
      /View 1:.*2 visible matches/,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    for (const reportId of reportIds) {
      const root = path.resolve(DATA, "reports");
      const dir = path.resolve(root, reportId);
      assert.equal(path.dirname(dir), root);
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});
