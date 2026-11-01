// Prepare the eight-situation native R4 review on an already-running owned desk.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.argv[2] || "http://127.0.0.1:6380";
async function api(route, body) {
  const r = await fetch(origin + "/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const value = await r.json();
  if (!r.ok) throw Error(route + ": " + JSON.stringify(value));
  return value;
}
const status = await api("status");
assert.ok(!status.reviewRun?.active, "Preserve active human review");
assert.equal(
  status.references.main,
  "f28bf9c1b8b0437ceede1fe3ca6bd3663b9faa31",
);
assert.equal(status.comparator, "cd5ab06f12fe255d91751f1877d3967b55374a05");
assert.equal(status.headless, false);
const fixtures = JSON.parse(
  await fs.readFile(".layout-lab/reviews/mobile-r4-situations.json", "utf8"),
);
const entries = [
  {
    situationId: "e81bc3bd5fff",
    viewpoint: "hero_arien",
    presentation: { pane: "choice", selectedCard: "noble_blade" },
    origin: "library",
    goal: "Planning: close/return via global Choice, retain the selected card and explicitly Commit once; keyboard inspection never commits.",
  },
  {
    situationId: "eebbbbab698b",
    viewpoint: "hero_emmitt",
    presentation: { pane: "choice" },
    origin: "library",
    goal: "First card committed: meaningful second-card status, independent inspection, explicit Done with one card and Take back.",
  },
  {
    situationId: fixtures["empty-hand"],
    viewpoint: "hero_arien",
    presentation: { pane: "hand" },
    origin: "new local draft",
    goal: "Empty owner Hand, supplied history/discards and waiting message. Board remains Board while other heroes choose; no missing-card commit.",
  },
  {
    situationId: "e6cf117c8910",
    viewpoint: "hero_arien",
    presentation: { pane: "choice" },
    origin: "library",
    goal: "Action choice stays in Action/Info and Noble Blade in Card Focus; staging, inspection and explicit confirmation remain separate.",
  },
  {
    situationId: "2b928b7b0ab4",
    viewpoint: "hero_brogan",
    presentation: { pane: "choice" },
    origin: "library",
    goal: "Stage Bulwark/pass, inspect another card, Board/Choice return; one shared reader, canonical Small/Tiny border, native outcomes and explicit confirmation.",
  },
  {
    situationId: "30735050fbde",
    viewpoint: "hero_brogan",
    presentation: { pane: "choice" },
    origin: "library",
    goal: "Discard responder: stage a supplied card, inspect independently, retain the draft and confirm only the selected offered card.",
  },
  {
    situationId: "50205badf8ea",
    viewpoint: "hero_arien",
    presentation: { pane: "choice" },
    origin: "library",
    goal: "Eligible teammate: actor options and the single confirmation stay in Action/Info; maintain team responder authority.",
  },
  {
    situationId: fixtures["pending-swap"],
    viewpoint: "hero_hanu",
    presentation: { pane: "choice" },
    origin: "new local draft",
    goal: "Unanswered incoming swap: Accept/Decline in Action/Info, instruction in Message; Position mode and highlights survive Board/Choice. Do not answer merely to inspect.",
  },
];
const slots = [
  {
    source: "main",
    label: "R3 reviewed",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
  {
    source: "comparator",
    label: "R4 core workflows",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
];
await api("synchronize", { mode: "api" });
await api("cheats", { show: false });
await api("review-runs/start", {
  name: "Mobile box refactor — R4: Core workflows and meaningful commitment status",
  performedBy: "human",
  entries: entries.map(({ origin, goal, ...entry }) => entry),
  slots,
});
const ready = await api("status"),
  views = await api("views");
assert.equal(ready.reviewRun.total, 8);
assert.equal(ready.reviewRun.index, 0);
assert.equal(views[0].state.hash, views[1].state.hash);
for (const w of ready.windows) {
  assert.deepEqual(w.errors, []);
  assert.deepEqual(w.assets, []);
  assert.deepEqual(w.warnings, []);
  assert.equal(w.config.autoSwitch, false);
  assert.deepEqual(w.config.bots, {});
}
await fs.writeFile(
  ".layout-lab/reviews/mobile-r4-handoff.json",
  JSON.stringify(
    {
      origin,
      baseline: ready.references.main,
      candidate: ready.comparator,
      reviewRun: ready.reviewRun,
      entries,
      hashes: views.map((v) => v.state.hash),
      display: ready.display,
      humanEvaluation: "ready; not evaluated",
      stop: "POST " + origin + "/api/shutdown {}",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    origin,
    run: ready.reviewRun.id,
    total: 8,
    display: ready.display,
  }),
);

