// Prepare a six-Situation R2 human Review on an owned, already-running desk.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DATA, ROOT } from "../src/config.mjs";
const origin = process.argv[2] || "http://127.0.0.1:6300";
const candidate =
  process.argv[3] ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
async function api(name, body) {
  const r = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const v = await r.json();
  if (!r.ok) throw Error(name + ": " + JSON.stringify(v));
  return v;
}
const initial = await api("status");
assert.ok(
  !initial.reviewRun?.active,
  "Preserve the active human Review; use a separate owned desk.",
);
await api("refresh", { ref: candidate });
const catalog = await api("catalog");
const find = (name) => {
  const s = catalog.situations
    .filter((s) => s.name === name && s.origin === "library")
    .sort((a, b) => b.saved_at - a.saved_at)[0];
  assert.ok(s, "Import, verify and promote the missing Situation: " + name);
  return s.id;
};
const slots = [
  {
    source: "main",
    label: "R1 baseline",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
  {
    source: "comparator",
    label: "R2 candidate",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
];
const entries = [
  {
    situationId: "e81bc3bd5fff",
    viewpoint: "hero_arien",
    presentation: { pane: "hand", selectedCard: "noble_blade" },
    goal: "Inspect Small/Tiny with the common preference. Click/Enter/Space only focus and stage; explicit Commit is separate.",
  },
  {
    situationId: "d296bd2e5d3d",
    viewpoint: "hero_arien",
    presentation: { pane: "choice" },
    goal: "Inspect printed tier I–III choices, Extended Micro cap borders and named Tree selection states; never acquire through a card click.",
  },
  {
    situationId: "7cc3ce17c3e7",
    viewpoint: "hero_brogan",
    presentation: { pane: "heroes" },
    goal: "Inspect active history Micro and discarded Nano; source glow survives changing focus. Watch reduced motion separately.",
  },
  {
    situationId: "cd4b7845c42a",
    viewpoint: "hero_gydion",
    presentation: {
      pane: "heroes",
      spellBrowserMobile: { heroId: "hero_gydion", selectedId: "wish" },
    },
    goal: "Wish Tiny and Large have rank-IV spell accents without hero initiative, secondary rails or item grants.",
  },
  {
    situationId: find("Gydion: Cantrip references prepared and cast spells"),
    viewpoint: "hero_gydion",
    presentation: { pane: "hand", inspectedCard: "cantrip" },
    goal: "Magic Missile is known but outside the spellbook; its row remains inspectable and unavailable. Other references remain prepared. Compare normal Deck treatment without casting.",
  },
  {
    situationId: find("Ursafar: unlocked Ultimate and active resolved history"),
    viewpoint: "hero_ursafar",
    presentation: { pane: "heroes" },
    goal: "Legally upgraded level-8 hero: Ultimate availability and resolved-history active glow are independent. Passive Ultimate stays in its own slot; do not fabricate a history card.",
  },
];
const output = path.join(DATA, "reviews", "mobile-r2-final-" + Date.now());
await fs.mkdir(output, { recursive: true });
const records = [];
for (const entry of entries) {
  await api("load", { ...entry, goal: undefined, slots });
  const status = await api("status"),
    views = await api("views");
  for (const w of status.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
    assert.deepEqual(w.warnings, []);
  }
  assert.equal(views[0].state.hash, views[1].state.hash);
  const capture = await api("capture", { indexes: [0, 1] });
  assert.equal(capture.diverged, false);
  records.push({ ...entry, status, views, capture });
  await fs.writeFile(
    path.join(output, "verified.json"),
    JSON.stringify(records, null, 2),
  );
  console.log("Verified", entry.situationId);
}
const layout = await api("layout/save", {
  name: "Mobile R2 baseline vs candidate",
  slots,
  synchronization: "api",
});
const run = await api("review-runs/start", {
  name: "Mobile box refactor — R2: Canonical cards, availability and motion state",
  performedBy: "human",
  layoutId: layout.layout.id,
  entries: entries.map(({ goal, ...e }) => e),
});
const ready = await api("status"),
  views = await api("views");
for (const w of ready.windows) {
  assert.deepEqual(w.errors, []);
  assert.deepEqual(w.assets, []);
  assert.deepEqual(w.warnings, []);
}
assert.equal(views[0].state.hash, views[1].state.hash);
const handoff = {
  origin,
  output,
  candidate,
  baseline: ready.references.main,
  layoutId: layout.layout.id,
  run,
  entries,
  ready,
  views,
  humanEvaluation: "pending",
  stop: "POST " + origin + "/api/shutdown {}",
};
await fs.writeFile(
  path.join(output, "handoff.json"),
  JSON.stringify(handoff, null, 2),
);
await fs.writeFile(
  path.join(DATA, "reviews/mobile-r2-final-latest.json"),
  JSON.stringify({ output, candidate, run: run.id }, null, 2),
);
console.log(
  JSON.stringify({
    output,
    candidate,
    run: run.id,
    review: ready.reviewRun?.reviewId,
    total: ready.reviewRun?.total,
  }),
);
