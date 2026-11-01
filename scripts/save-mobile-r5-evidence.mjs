// Save credential-free R5 acceptance evidence from successful local checks.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DATA, ROOT, BACKEND } from "../src/config.mjs";
const followup = process.argv.includes("--grant-fix");
const expectedTests = followup ? 599 : 598;
const browserDir = path.resolve(process.argv[2] || "");
const desktopDir = path.resolve(process.argv[3] || "");
assert.ok(
  process.argv[2] && process.argv[3],
  "Supply browser and desktop evidence directories",
);
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const handoff = await read(
  path.join(DATA, "reviews", "mobile-r5-handoff.json"),
);
const result = await read(path.join(browserDir, "results.json"));
const desktop = await read(path.join(desktopDir, "results.json"));
assert.equal(result.ref, handoff.candidate);
if (!followup) for (const name of ["r4-card-height-390", "r4-card-height-844", "r4-defense", "r4-discard-hand", "r4-actor", "r4-swap-hero_arien", "r4-swap-hero_hanu", "upgrades-hero_arien-1", "upgrades-hero_arien-6", "upgrades-hero_gydion-6", "bounded-nested-spell", "deck-cast-reference", "runes-staged", "runes-acknowledged"]) assert.ok(result.records.some(record => record.name === name), "Missing browser check: " + name);
assert.equal(result.records.filter((record) => record.capture).length, 1);
assert.equal(result.baseline, handoff.baseline);
assert.equal(handoff.reviewRun.total, 6);
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  handoff.candidate,
);
const dirty = execFileSync("git", ["diff", "--name-only"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
assert.ok(
  !dirty.split(/\r?\n/).some((file) => file.startsWith("src/")),
  "Source changed after candidate checks",
);
for (const item of desktop) {
  assert.equal(item.source, handoff.candidate);
  assert.deepEqual(item.errors, []);
  assert.deepEqual(item.assets, []);
}
assert.equal(desktop.length, 2);
const dest = path.join(
  ROOT,
  "docs",
  "acceptance",
  "mobile-refactor",
  "evidence",
  "R5",
  ...(followup ? ["grant-fix"] : []),
);
assert.equal(
  await fs.stat(dest).then(
    () => true,
    () => false,
  ),
  false,
  "Preserve existing evidence; choose a new location rather than overwrite it",
);
await fs.mkdir(path.join(dest, "browser"), { recursive: true });
for (const name of await fs.readdir(browserDir)) {
  if (name === "results.json" || name === "verification-origin.json" || name.endsWith(".png"))
    await fs.copyFile(
      path.join(browserDir, name),
      path.join(dest, "browser", name),
    );
}
await fs.writeFile(
  path.join(dest, "desktop.json"),
  JSON.stringify(desktop, null, 2) + "\n",
);
await fs.writeFile(
  path.join(dest, "handoff.json"),
  JSON.stringify(handoff, null, 2) + "\n",
);
for (const [source, name] of [
  [".r5-tests.txt", "tests.txt"],
  [".r5-build.txt", "build.txt"],
])
  await fs.copyFile(path.join(ROOT, source), path.join(dest, name));
assert.match(
  await fs.readFile(path.join(dest, "tests.txt"), "utf8"),
  new RegExp(expectedTests + " passed"),
);
await fs.writeFile(
  path.join(dest, "lint.txt"),
  "Touched-file ESLint passed on Windows, 1 November 2026.\n",
);
await fs.copyFile(path.join(ROOT, ".r5-lint.txt"), path.join(dest, "repository-lint.txt"));
assert.equal((await fs.readFile(path.join(ROOT, ".r5-touched-lint.txt"), "utf8")).trim(), "", "Changed-file lint must pass");
const log = await fs.readFile(
  path.join(DATA, "reviews", followup ? "mobile-r5-grant-verified.log" : "mobile-r5-verified.log"),
  "utf8",
);
await fs.writeFile(
  path.join(dest, "browser.txt"),
  log
    .split(/\r?\n/)
    .filter((line) =>
      /^(PASS |R5 evidence |Starting isolated|Comparison desk|Stopping)/.test(
        line,
      ),
    )
    .join("\n") + "\n",
);
for (const rec of result.records.filter((rec) => rec.capture)) {
  const orientation = "gydion-upgrades";
  const target = path.join(dest, orientation);
  await fs.mkdir(target, { recursive: true });
  const source = path.join(DATA, "reports", rec.capture.id);
  const report = await read(path.join(source, "report.json"));
  assert.equal(report.diverged, false);
  assert.equal(report.captures[0].state.hash, report.captures[1].state.hash);
  for (const name of [
    "window-1.png",
    "window-2.png",
    "side-by-side.png",
    "diff-0-1.png",
  ])
    await fs.copyFile(path.join(source, name), path.join(target, name));
  await fs.writeFile(
    path.join(target, "comparison.json"),
    JSON.stringify(
      {
        id: report.id,
        capturedAt: report.capturedAt,
        situationId: report.situationId,
        baseline: handoff.baseline,
        candidate: handoff.candidate,
        diverged: false,
        synchronization: report.synchronization,
        captures: report.captures.map((c) => ({
          index: c.index,
          source: c.source,
          profile: c.profile,
          render: c.render,
          uiMode: c.uiMode,
          seat: c.seat,
          state: c.state,
          width: c.width,
          height: c.height,
          checksum: c.checksum,
          presentation: {
            pane: c.presentation.pane,
            selectedCard: c.presentation.selectedCard,
            camera: c.presentation.camera,
            inspectionMobile: c.presentation.inspectionMobile,
          },
        })),
      },
      null,
      2,
    ) + "\n",
  );
  await fs.writeFile(
    path.join(target, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>R5 Gydion upgrade comparison</title><style>body{background:#111925;color:#eee;font:15px system-ui;margin:20px}.overlay{display:grid;width:fit-content;max-width:100%}.overlay img{grid-area:1/1;max-width:100%;height:auto}input{width:300px}</style><h1>R5 Gydion upgrades — ${orientation}</h1><p>Before: ${handoff.baseline.slice(0,7)} · After: ${handoff.candidate.slice(0,7)}. Same Gydion upgrade moment, first staged card and viewport. Layout and reserved Board geometry intentionally differ.</p><p>After opacity <input type="range" min="0" max="1" value=".5" step=".01" oninput="document.getElementById('after').style.opacity=this.value"></p><div class="overlay"><img src="window-1.png" alt="Before"><img id="after" src="window-2.png" style="opacity:.5" alt="After"></div><p><a href="side-by-side.png">Side by side</a> · <a href="diff-0-1.png">Pixel diff</a></p>`,
  );
}
const sha = async (file) =>
  crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const tools = [
  "test/mobile-r5.mjs",
  "scripts/prepare-mobile-r5.mjs",
  "scripts/create-mobile-r5-situations.py",
  "scripts/save-mobile-r5-evidence.mjs",
  "src/desk.mjs",
  "src/config.mjs",
  "src/backend.py",
  "src/instrument.mjs",
  "src/presentation.mjs",
];
const git = (repo, ...args) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
async function files(dir) {
  const all = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) all.push(...(await files(p)));
    else all.push(p);
  }
  return all;
}
await fs.writeFile(
  path.join(dest, "manifest.json"),
  JSON.stringify(
    {
      date: "2026-11-01",
      scope: followup ? "Final paired-grant correction; the unchanged workflow cases remain in the parent 0eb17cf evidence. Full tests/build/lint and desktop checks rerun on this candidate." : "R4 review fixes and R5 workflows",
      baseline: handoff.baseline,
      candidate: handoff.candidate,
      tests: { files: 74, passed: expectedTests },
      reviewRun: handoff.reviewRun.id,
      deferredEngineFacts: ["F2: required per-tier upgrade quotas absent; compact aggregate progress only"],
      humanEvaluation: "Ready; not evaluated",
      lab: {
        revision: git(process.cwd(), "rev-parse", "HEAD"),
        dirty: git(process.cwd(), "status", "--porcelain") !== "",
      },
      backend: {
        revision: git(BACKEND, "rev-parse", "HEAD"),
        dirty: git(BACKEND, "status", "--porcelain") !== "",
      },
      tools: await Promise.all(
        tools.map(async (file) => ({ file, sha256: await sha(file) })),
      ),
      artifacts: await Promise.all(
        (await files(dest)).map(async (file) => ({
          file: path.relative(dest, file).replaceAll("\\", "/"),
          sha256: await sha(file),
        })),
      ),
    },
    null,
    2,
  ) + "\n",
);
console.log(dest);
