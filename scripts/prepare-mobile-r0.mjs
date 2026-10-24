// R0 baseline preparation against an already-owned desk; uses only public APIs.
// node scripts/prepare-mobile-r0.mjs [http://127.0.0.1:6270]
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { ROOT, DATA } from "../src/config.mjs";
const origin = process.argv[2] || "http://127.0.0.1:6270";
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin));
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
}).trim();
const output =
  process.argv[3] || path.join(DATA, "reviews", "mobile-r0-" + Date.now());
await fs.mkdir(output, { recursive: true });
const write = (name, value) =>
  fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2));
async function api(route, body) {
  const r = await fetch(origin + "/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const v = await r.json();
  if (!r.ok) throw Error(route + ": " + JSON.stringify(v));
  return v;
}
const status = await api("status");
assert.equal(
  status.reviewRun?.active ?? false,
  false,
  "Use an owned desk without an active Review",
);
assert.equal(status.references.main, sha);
assert.equal(status.comparator, sha);
const slots = ["main", "comparator"].map((source, i) => ({
  label: i ? "R0 restored" : "R0 original",
  source,
  profile: "portrait",
  render: "2d",
  uiMode: "mobile",
  seat: "hero_arien",
  autoSwitch: false,
}));
const catalog = await api("catalog");
const entries = [
  {
    situationId: "e81bc3bd5fff",
    viewpoint: "hero_arien",
    presentation: { pane: "hand", inspectedCard: "noble_blade" },
    goal: "Hand menu, Small rows and Noble Blade reader; inspection submits nothing.",
  },
  {
    situationId: "2b928b7b0ab4",
    viewpoint: "hero_brogan",
    presentation: { pane: "board" },
    goal: "Defender viewpoint; offered defense cards; stage locally, confirm explicitly in a disposable clone.",
  },
  {
    situationId: "d296bd2e5d3d",
    viewpoint: "hero_arien",
    presentation: { pane: "board" },
    goal: "Six pending upgrades; Tree, tier cards, items and future Preview; no Commit.",
  },
  {
    situationId: "dbd50506df47",
    viewpoint: "hero_gydion",
    presentation: {
      pane: "board",
      inspectionMobile: "magic_missile",
      inspectionMobileParent: "cantrip",
      inspectionMobileContext: "decision",
    },
    goal: "Cantrip action source and offered spell; inspect a referenced spell then Back without casting.",
  },
  {
    situationId: "7cc3ce17c3e7",
    viewpoint: "hero_brogan",
    presentation: { pane: "heroes" },
    goal: "Brogan history/discards: active glow versus inspected sheen. Observe motion separately from screenshots.",
  },
];
for (const e of entries) {
  const s = catalog.situations.find((s) => s.id === e.situationId);
  assert.ok(s, e.situationId);
  e.name = s.name;
  e.origin = s.origin;
  e.decisionStateId = s.decisionStateId;
}
const warnings = [];
async function verify(label) {
  const s = await api("status"),
    views = await api("views");
  for (const w of s.windows) {
    assert.deepEqual(w.errors, [], label);
    assert.deepEqual(w.assets, [], label);
    assert.equal(w.config.uiMode, "mobile");
    warnings.push(...w.warnings.map((w) => ({ label, warning: w })));
  }
  assert.equal(views[0].state.hash, views[1].state.hash, label);
  return { status: s, views };
}
async function capture(name, crop) {
  const r = await api("capture", {
    indexes: [0, 1],
    ...(crop ? { crop } : {}),
  });
  const dir = path.join(DATA, "reports", r.id);
  const report = JSON.parse(
    await fs.readFile(path.join(dir, "report.json"), "utf8"),
  );
  assert.equal(report.diverged, false);
  if (!name.startsWith("review-"))
    assert.ok(
      report.pairs.every((p) => !p.available || p.pixels === 0),
      name + ": pinned Views must match",
    );
  await write(name + ".json", { ...r, directory: dir, report });
  return { ...r, directory: dir, report };
}
if (
  !(await fs.stat(path.join(output, "restore-control.json")).catch(() => null))
) {
  await api("load", {
    situationId: entries[0].situationId,
    slots,
    viewpoint: entries[0].viewpoint,
    presentation: entries[0].presentation,
  });
  const before = await verify("before-save");
  const a = await capture("before-save");
  const saved = await api("save", {
    index: 0,
    name: "Arien: opening choice normalized restore control",
  });
  await api("load", {
    situationId: saved.id,
    slots,
    viewpoint: entries[0].viewpoint,
    presentation: entries[0].presentation,
  });
  const after = await verify("after-restore");
  assert.equal(before.views[0].state.hash, after.views[0].state.hash);
  assert.equal(after.views[0].presentation.inspectionMobile, "noble_blade");
  const b = await capture("after-restore");
  const pa = PNG.sync.read(
      await fs.readFile(path.join(a.directory, "window-1.png")),
    ),
    pb = PNG.sync.read(
      await fs.readFile(path.join(b.directory, "window-1.png")),
    );
  assert.equal(pa.width, pb.width);
  assert.equal(pa.height, pb.height);
  let differingPixels = 0;
  for (let i = 0; i < pa.data.length; i += 4)
    if (!pa.data.subarray(i, i + 4).equals(pb.data.subarray(i, i + 4)))
      differingPixels++;
  assert.equal(differingPixels, 0, "Unchanged baseline restore control");
  const combined = new PNG({ width: pa.width * 2, height: pa.height });
  PNG.bitblt(pa, combined, 0, 0, pa.width, pa.height, 0, 0);
  PNG.bitblt(pb, combined, 0, 0, pb.width, pb.height, pa.width, 0);
  await fs.writeFile(
    path.join(output, "unchanged-baseline-restore-control.png"),
    PNG.sync.write(combined),
  );
  await fs.copyFile(
    path.join(a.directory, "window-1.png"),
    path.join(output, "before-save.png"),
  );
  await fs.copyFile(
    path.join(b.directory, "window-1.png"),
    path.join(output, "after-restore.png"),
  );
  await write("restore-control.json", {
    sha,
    originalSituationId: entries[0].situationId,
    normalizedSituationId: saved.id,
    decisionStateId: saved.decisionStateId,
    normalizedHash: before.views[0].state.hash,
    differingPixels,
    viewport: { width: pa.width, height: pa.height },
    dpr: 1,
    locale: "en",
    fonts:
      "document.fonts.ready and image decode awaited by stableScreenshot; CSS animations disabled at capture",
    before,
    after,
  });
}
const preset = await api("presentation/save", {
  name: "R0 Hand gold inspection",
  change: { pane: "hand", inspectedCard: { role: "gold" } },
});
const layout = await api("layout/save", {
  name: "Mobile R0 pinned baseline",
  slots,
  synchronization: "api",
});
const verified = [];
for (const [i, e] of entries.entries()) {
  await api("load", {
    situationId: e.situationId,
    slots,
    viewpoint: e.viewpoint,
    presentation: e.presentation,
  });
  const v = await verify(e.name);
  if (i === 1) {
    assert.equal(v.views[0].state.decision.type, "SELECT_CARD_OR_PASS");
    assert.equal(v.views[0].config.seat, "hero_brogan");
  }
  if (i === 2) assert.equal(v.views[0].state.decision.type, "UPGRADE_PHASE");
  if (i === 3) assert.equal(v.views[0].state.decision.type, "SELECT_CARD");
  const image = await capture("review-" + (i + 1));
  verified.push({
    ...e,
    ...v,
    capture: { id: image.id, directory: image.directory },
  });
  await write("verified-situations.json", verified);
  console.log("Verified", e.situationId, e.name);
}
const run = await api("review-runs/start", {
  name: "Mobile box refactor — R0: Baseline and coverage",
  performedBy: "human",
  layoutId: layout.layout.id,
  entries: entries.map(({ situationId, viewpoint, presentation }) => ({
    situationId,
    viewpoint,
    presentation,
  })),
});
const ready = await verify("human-review-first-entry");
const references = [];
for (const file of (await fs.readdir(path.join(ROOT, "docs/figures"))).filter(
  (f) => /^card-.*\.png$/.test(f),
)) {
  const bytes = await fs.readFile(path.join(ROOT, "docs/figures", file));
  const png = PNG.sync.read(bytes);
  references.push({
    file: "docs/figures/" + file,
    width: png.width,
    height: png.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    purpose: file.includes("proposed")
      ? "intentional design deviation"
      : "original documented userscript pixel reference",
  });
}
await write("card-reference-manifest.json", {
  frontendSha: sha,
  userscriptSha: status.references.script,
  locale: "en",
  dpr: 1,
  references,
  nativeCaptures: verified.map((v) => v.capture),
});
await write("handoff.json", {
  createdAt: new Date().toISOString(),
  sha,
  origin,
  output,
  layoutId: layout.layout.id,
  presentationId: preset.id,
  run,
  entries,
  warnings,
  ready,
  humanEvaluation: "pending; verification loads are not passes",
  stop: "POST " + origin + "/api/shutdown {}",
});
console.log("R0 evidence:", output);
console.log("Human Run:", JSON.stringify(run));
