// Real shared-situation checks. Owns isolated services; never replaces an existing desk.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
for (const [key, port] of Object.entries({
  DESK: 5700,
  BASE: 5701,
  COMPARATOR: 5702,
  LIVE: 5703,
  BACKEND: 10700,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);
const { DATA, TOOL, PORTS } = await import("../src/config.mjs");
const { startDesk } = await import("../src/desk.mjs");
const { resolveCrop, normalizeCrop } = await import("../src/element-crop.mjs");
const { PNG } = await import("pngjs");
const { expandMatched } = await import("../src/source-inspection.mjs");
const root = path.join(DATA, "reviews", "element-tools-" + Date.now());
await fs.mkdir(root, { recursive: true });
const records = [];
let desk;
let passed = false,
  failure = null;
const origin = `http://127.0.0.1:${PORTS.desk}`;
async function api(name, body) {
  const r = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const v = await r.json();
  if (!r.ok) throw Error(name + ": " + (v.error || JSON.stringify(v)));
  return v;
}
async function verifyViewer(filename, source) {
  const page = await desk.comparison.browser
    .newContext({ viewport: { width: 1400, height: 900 } })
    .then((c) => c.newPage());
  try {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(filename).href);
    if (source) {
      for (const mode of [
        "html",
        "stylesheets",
        "computed",
        "matched",
        "definitions",
      ]) {
        await page.selectOption("#mode", mode);
        assert.ok((await page.locator("#left").textContent()).length > 0);
        assert.ok((await page.locator("#right").textContent()).length > 0);
      }
    } else {
      assert.ok(
        await page
          .locator("img[src]")
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every((i) => i.complete && i.naturalWidth > 0),
          ),
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.context().close();
  }
}
try {
  console.log("Starting isolated Windows comparison on", origin);
  desk = await startDesk({
    flags: new Set([
      "--headless",
      "--verification",
      "--no-open",
      "--no-auto-load",
    ]),
  });
  const situations = [
    {
      id: "e81bc3bd5fff",
      case: "select-card",
      selector: "button[data-lab-card], .m2-list-card",
    },
    {
      id: "e6cf117c8910",
      case: "choose-action",
      selector:
        "[data-decision-type] button[aria-pressed], [data-m2-action-choice]",
    },
    {
      id: "30735050fbde",
      case: "discard-card",
      selector: "[data-decision-type] button[aria-pressed], .m2-discard-row",
    },
  ];
  const requested = process.argv
    .find((a) => a.startsWith("--case="))
    ?.slice(7)
    .split(",");
  for (const item of situations.filter(
    (item) => !requested || requested.includes(item.case),
  )) {
    console.log("Loading", item.case);
    await api("load", { situationId: item.id });
    const before = await api("views");
    const status = await api("status");
    assert.equal(status.windows.length, 3);
    assert.ok(before.every((v) => v.state.hash === before[0].state.hash));
    assert.ok(before[2].scriptActive);
    for (const w of status.windows) {
      assert.deepEqual(w.errors, []);
      assert.deepEqual(w.assets, []);
      assert.deepEqual(w.warnings, []);
    }
    const c = desk.comparison;
    const crops = await Promise.all(
      [1, 2].map((i) =>
        resolveCrop(
          c.windows[i].page,
          normalizeCrop({ selector: item.selector, match: "individual" }),
        ),
      ),
    );
    console.log(
      "Visible matches",
      item.case,
      crops.map((v) => v.visibleMatches),
    );
    assert.ok(crops.every((v) => v.visibleMatches > 1));
    const record = {
      ...item,
      hash: before[0].state.hash,
      matches: crops.map((c) => ({
        count: c.visibleMatches,
        selected: c.selected,
      })),
      captures: [],
      extracts: [],
    };
    records.push(record);
    for (const match of ["individual", "combine"]) {
      const result = await api("capture", {
        indexes: [1, 2],
        crop: { selector: item.selector, match },
      });
      const metadata = await (
        await fetch(origin + `/reports/${result.id}/report.json`)
      ).json();
      for (const capture of metadata.captures) {
        const image = PNG.sync.read(
          await fs.readFile(
            path.join(DATA, "reports", result.id, capture.file),
          ),
        );
        assert.equal(image.width, capture.width);
        assert.equal(image.height, capture.height);
      }
      assert.equal(metadata.diverged, false);
      record.captures.push({
        match,
        ...result,
        count: metadata.captures.length,
        pairs: metadata.pairs.map((p) => ({
          available: p.available,
          reason: p.reason,
        })),
        directory: path.join(DATA, "reports", result.id),
      });
      console.log("CAPTURE", item.case, match, result.id);
      if (match === "combine") {
        const out = path.join(root, item.case + "-images");
        await promisify(execFile)(
          process.execPath,
          [
            path.join(
              TOOL,
              "agent/skills/goa2-compare-views/scripts/capture-comparison.mjs",
            ),
            "--origin",
            origin,
            "--out",
            out,
            "--indexes",
            "1,2",
            "--selector",
            item.selector,
            "--match",
            "combine",
          ],
          { windowsHide: true, maxBuffer: 1024 * 1024 },
        );
        await verifyViewer(path.join(out, "index.html"), false);
        record.imageExport = out;
      }
    }
    if (item.case === "select-card") {
      await assert.rejects(
        api("capture", { indexes: [1, 2], crop: { selector: item.selector } }),
        /visible matches/,
      );
      await assert.rejects(
        api("capture", {
          indexes: [1, 2],
          crop: { selector: ".no-element-tools-match" },
        }),
        /no visible matches/,
      );
      for (const match of ["nth", "union"]) {
        const result = await api("capture", {
          indexes: [1, 2],
          crop: {
            selector: item.selector,
            match,
            ...(match === "nth" ? { occurrence: 1 } : {}),
          },
        });
        record.captures.push({ match, ...result });
      }
    }
    const modes =
      item.case === "select-card" ? ["full", "active", "element"] : ["element"];
    for (const mode of modes) {
      const out = path.join(root, item.case + "-" + mode);
      await promisify(execFile)(
        process.execPath,
        [
          path.join(TOOL, "scripts/extract-sources.mjs"),
          "--origin=" + origin,
          "--indexes=1,2",
          "--mode=" + mode,
          "--selector=" + item.selector,
          "--out=" + out,
        ],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
      );
      const data = JSON.parse(
        await fs.readFile(path.join(out, "comparison.json"), "utf8"),
      );
      assert.equal(data.diverged, false);
      assert.ok(data.views.every((v) => v.stateHash === record.hash));
      for (const view of data.views) {
        assert.ok(view.snapshot.elements.length);
        assert.ok(view.snapshot.stylesheets.length);
        assert.ok(
          view.snapshot.elements.some(
            (e) =>
              expandMatched(e.matched, view.snapshot.matchedDefinitions)
                .matchedCSSRules.length,
          ),
        );
        assert.ok(
          (
            await fs.readFile(path.join(out, view.computedCSSFile), "utf8")
          ).includes("font-size:"),
        );
        if (mode === "full")
          assert.ok(view.snapshot.html.startsWith("<!DOCTYPE"));
        if (mode === "active") assert.equal(view.snapshot.html, null);
      }
      await verifyViewer(path.join(out, "index.html"), true);
      record.extracts.push({
        mode,
        directory: out,
        elements: data.views.map((v) => v.snapshot.elements.length),
        stylesheets: data.views.map((v) => v.snapshot.stylesheets.length),
        warnings: data.views.map((v) => v.snapshot.warnings),
      });
      console.log("EXTRACT", item.case, mode, out);
    }
    const after = await api("views");
    assert.ok(after.every((v) => v.state.hash === record.hash));
    await fs.writeFile(
      path.join(root, "verification.json"),
      JSON.stringify({ records, status: await api("status") }, null, 2),
    );
  }
  passed = true;
  console.log("VERIFIED", root);
} catch (error) {
  failure = error.message;
  throw error;
} finally {
  await fs.writeFile(
    path.join(root, "verification.json"),
    JSON.stringify(
      {
        passed,
        error: failure,
        records,
        status: desk ? desk.comparison.status() : null,
      },
      null,
      2,
    ),
  );
  await desk?.close();
}
