// Prepare the six-situation native R5 review on an already-running owned desk.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.argv[2] || "http://127.0.0.1:6400";
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
  "cd5ab06f12fe255d91751f1877d3967b55374a05",
);
assert.equal(status.comparator, "b060b9f5f12a0ccaa8eddac13d5964b4a8aeb39d");
assert.equal(status.headless, false);
const fixtures = JSON.parse(
  await fs.readFile(".layout-lab/reviews/mobile-r5-situations.json", "utf8"),
);
const entries = [
  { situationId:'7596eb876af3', viewpoint:'hero_arien', presentation:{pane:'choice'}, origin:'library', goal:'One tier-II upgrade: shared Card Focus and grant footer; explicit single complete batch. No acquisition through inspection.' },
  { situationId:'d296bd2e5d3d', viewpoint:'hero_arien', presentation:{pane:'choice'}, origin:'library', goal:'Six pending upgrades: compact supplied aggregate progress, engine-validated prefix, hypothetical Preview, Reset and draft preservation across Board/Choice.' },
  { situationId:fixtures['gydion-upgrades'], viewpoint:'hero_gydion', presentation:{pane:'choice'}, origin:'new local draft', goal:'Gydion native tier tree and full catalog: stage the complete ordered proposal, projected item totals, separate viewed/staged sheen, explicit Commit. ' },
  { situationId:'ad66cbbbda7e', viewpoint:'hero_gydion', presentation:{pane:'deck',inspectedCard:'cantrip'}, origin:'reused R2 library', goal:'Deck Tree/List/Grid, plans, prepared/cast spell rows and ordinary reference focus; normal Deck availability, inspected sheen and 0.12s reduced-motion-aware sort.' },
  { situationId:'0601f17bbdab', viewpoint:'hero_snorri', presentation:{pane:'choice'}, origin:'library', goal:'First inscription: source in Card Focus, separate planned/automatic/acknowledged slots in Action/Info, complete proposal, Undo and Board/Choice preservation.' },
  { situationId:fixtures['snorri-confirmation'], viewpoint:'hero_snorri', presentation:{pane:'board'}, origin:'new local draft', goal:'Four engine-acknowledged runes and inspectable source receipt in Action/Info. Engine completes immediately; receipt dismissal is not another game action. Reload restores actual slots.' },
];
const slots = [
  {
    source: "main",
    label: "R4 reviewed",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
  {
    source: "comparator",
    label: "R5 Deck/upgrades/runes",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
];
await api("synchronize", { mode: "api" });
await api("cheats", { show: false });
if (process.argv.includes("--rerun")) {
  const previous = JSON.parse(await fs.readFile(".layout-lab/reviews/mobile-r5-handoff.json", "utf8"));
  await api("review-runs/rerun", {id:previous.reviewRun.id, inputs:"frozen", slots, performedBy:"human"});
} else {
  await api("review-runs/start", {
    name:"Mobile box refactor — R5: Deck, Gydion upgrades and rune workflows",
    performedBy:"human", entries:entries.map(({origin,goal,...entry})=>entry), slots,
  });
}
const ready = await api("status"),
  views = await api("views");
assert.equal(ready.reviewRun.total, 6);
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
  ".layout-lab/reviews/mobile-r5-handoff.json",
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
    total: 6,
    display: ready.display,
  }),
);

