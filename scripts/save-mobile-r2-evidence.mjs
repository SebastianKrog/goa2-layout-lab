import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PNG } from "pngjs";
import { execFileSync } from "node:child_process";
import { ROOT, DATA, PATCH } from "../src/config.mjs";
const out = path.join(ROOT, "docs/acceptance/mobile-refactor/evidence/R2");
await fs.mkdir(out, { recursive: true });
const latest = JSON.parse(
  await fs.readFile(
    path.join(DATA, "reviews/mobile-r2-final-latest.json"),
    "utf8",
  ),
);
const handoff = JSON.parse(
  await fs.readFile(path.join(latest.output, "handoff.json"), "utf8"),
);
const verified = JSON.parse(
  await fs.readFile(path.join(latest.output, "verified.json"), "utf8"),
);
for (const [source, target] of [
  [".r2-tests.txt", "tests.txt"],
  [".r2-build.txt", "build.txt"],
  [".r2-lint.txt", "lint.txt"],
  [".r2-mask-tests.txt", "mask-and-navigation.txt"],
]) {
  const text = await fs.readFile(path.join(ROOT, source), "utf8");
  await fs.writeFile(
    path.join(out, target),
    text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .join("\n")
      .trimEnd() + "\n",
  );
}
const matrix = path.join(DATA, "reviews/mobile-r2-renderers/delivered-dpr2");
await fs.cp(matrix, path.join(out, "renderer-matrix"), { recursive: true });
for (const file of ["motion.json", "motion-peak.png", "reduced-motion.png"])
  await fs.copyFile(
    path.join(DATA, "reviews/mobile-r2-renderers/motion-final", file),
    path.join(out, file),
  );
const sampleKeys = ["basic-small", "basic-tiny", "REDII-extended"];
const sampleRecords = [];
for (let i = 0; i < sampleKeys.length; i++) {
  const key = sampleKeys[i],
    label = ["small", "tiny", "extended"][i];
  for (const [source, kind] of [
    ["r1-final-sample", "before"],
    ["r2-final-sample", "after"],
  ]) {
    const file = kind + "-" + label + ".png";
    await fs.copyFile(
      path.join(
        DATA,
        "reviews/mobile-r2-renderers",
        source,
        "native-" + key + ".png",
      ),
      path.join(out, file),
    );
    sampleRecords.push({ kind, key, file });
  }
}
const images = await Promise.all(
  sampleRecords.map(async (r) => ({
    ...r,
    png: PNG.sync.read(await fs.readFile(path.join(out, r.file))),
  })),
);
const rowHeights = sampleKeys.map((_, i) =>
  Math.max(images[i * 2].png.height, images[i * 2 + 1].png.height),
);
const strip = new PNG({
  width: 724,
  height: rowHeights.reduce((a, b) => a + b, 0) + 16,
});
for (let i = 0; i < strip.data.length; i += 4) {
  strip.data[i] = 16;
  strip.data[i + 1] = 23;
  strip.data[i + 2] = 34;
  strip.data[i + 3] = 255;
}
let y = 0;
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 2; col++) {
    const img = images[row * 2 + col].png;
    PNG.bitblt(img, strip, 0, 0, img.width, img.height, col * 368, y);
  }
  y += rowHeights[row] + 8;
}
await fs.writeFile(path.join(out, "before-after.png"), PNG.sync.write(strip));
const smokeDirs = [
  "mobile-r2-smoke-1792835503496",
  "mobile-r2-smoke-1792834764164",
  "mobile-r2-smoke-1792834885933",
];
const smoke = [];
for (const name of smokeDirs)
  smoke.push({
    directory: name,
    results: JSON.parse(
      await fs.readFile(
        path.join(DATA, "reviews", name, "results.json"),
        "utf8",
      ),
    ),
  });
await fs.writeFile(
  path.join(out, "browser-smoke.json"),
  JSON.stringify(smoke, null, 2),
);
const compact = verified.map((r) => ({
  situationId: r.situationId,
  viewpoint: r.viewpoint,
  presentation: r.presentation,
  goal: r.goal,
  hashes: r.views.map((v) => v.state.hash),
  capture: r.capture,
  views: r.status.windows.map((w) => ({
    config: w.config,
    errors: w.errors,
    warnings: w.warnings,
    assets: w.assets,
  })),
}));
await fs.writeFile(
  path.join(out, "verified-situations.json"),
  JSON.stringify(compact, null, 2),
);
const final = {
  candidate: handoff.candidate,
  baseline: handoff.baseline,
  origin: handoff.origin,
  output: handoff.output,
  runId: handoff.run.id,
  reviewId: handoff.ready.reviewRun.reviewId,
  layoutId: handoff.layoutId,
  entries: handoff.entries,
  humanEvaluation: "pending",
  viewerPid: 29772,
  stop: handoff.stop,
  scope:
    "Windows Chromium UI; WSL services; pre-existing mutable backend and lab work preserved",
};
await fs.writeFile(
  path.join(out, "handoff.json"),
  JSON.stringify(final, null, 2),
);
const reference = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: PATCH,
  encoding: "utf8",
}).trim();
const referenceDirty = execFileSync(
  "git",
  ["status", "--porcelain", "--", "src"],
  { cwd: PATCH, encoding: "utf8" },
).trim();
if (reference !== "ad1eed5427b91b8daaebb56c4ceafda01db5f7de" || referenceDirty)
  throw Error("Reference source must be pinned and clean");
const tools = [
  "src/instrument.mjs",
  "src/presentation.mjs",
  "scripts/mobile-r2-renderers.mjs",
  "scripts/create-mobile-r2-situations.py",
  "scripts/prepare-mobile-r2.mjs",
  "test/mobile-r2.mjs",
  "test/mobile-r2-renderer-pixels.mjs",
  "test/mobile-card-interaction-instrumentation.test.mjs",
  "scripts/save-mobile-r2-evidence.mjs",
];
const hashes = {};
for (const file of tools)
  hashes[file] = crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const manifest = {
  date: "2026-10-24",
  candidate: handoff.candidate,
  baseline: handoff.baseline,
  reference,
  platform: "Windows Playwright Chromium",
  viewport: { width: 420, height: 900 },
  canonicalDpr: 2,
  locale: "en",
  fontScale: 1,
  originalResolution: true,
  sampleDpr: 1,
  samples: sampleRecords,
  tests: { files: 73, passed: 582, failed: 0 },
  labHead: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  labWorkingTree:
    "Pre-existing changes plus uncommitted R2 tools; exact tool hashes recorded",
  tools: hashes,
  backend: "No edits; existing mutable checkout used by the lab",
  privacy:
    "Only fabricated game moments; runtime credential URLs omitted from this compact handoff",
};
await fs.writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const results = JSON.parse(
  await fs.readFile(
    path.join(out, "renderer-matrix/pixel-comparison.json"),
    "utf8",
  ),
);
await fs.writeFile(
  path.join(out, "renderer-matrix/index.html"),
  '<meta charset="utf-8"><title>R2 renderer evidence</title><style>body{font:14px system-ui;background:#101722;color:#e1e5eb;margin:24px}a{color:#9ac7ff}td,th{padding:6px;text-align:left;border-bottom:1px solid #445}table{border-collapse:collapse}</style><h1>R2 renderer evidence</h1><p>Original PNG pixels. DPR 2; 420×900 CSS viewport, English, scale 1. No global tolerance. ' +
    results.exact +
    " exact pairs; " +
    results.capBorders +
    " approved cap-border changes; " +
    results.privacy +
    " privacy cases; " +
    results.invalidHistory +
    " invalid passive-history helper inputs.</p><table><tr><th>Fixture<th>Result<th>Originals</tr>" +
    results.rows
      .map(
        (r) =>
          "<tr><td>" +
          r.key +
          "<td>" +
          r.result +
          '<td><a href="native-' +
          r.key +
          '.png">Native</a> · <a href="reference-' +
          r.key +
          '.png">Reference</a></tr>',
      )
      .join("") +
    "</table>",
);
const imageFiles=[];
async function collectImages(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await collectImages(file);else if(item.name.endsWith('.png')){const bytes=await fs.readFile(file),png=PNG.sync.read(bytes);imageFiles.push({file:path.relative(out,file).replaceAll('\\','/'),width:png.width,height:png.height,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}}}
await collectImages(out);manifest.images=imageFiles.sort((a,b)=>a.file.localeCompare(b.file));manifest.samples=manifest.samples.map(sample=>({...sample,...imageFiles.find(image=>image.file===sample.file)}));await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(
  JSON.stringify({
    out,
    run: final.runId,
    review: final.reviewId,
    fixtures: results.total,
    exact: results.exact,
  }),
);
