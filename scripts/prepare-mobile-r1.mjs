// Prepare R1 evidence on an owned, already-running native desk.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { WebSocket } from "ws";
import { DATA, ROOT } from "../src/config.mjs";
const origin = process.argv[2] || "http://127.0.0.1:6280";
const candidate =
  process.argv[3] ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
const output = path.join(DATA, "reviews", "mobile-r1-" + Date.now());
await fs.mkdir(output, { recursive: true });
const save = (name, data) =>
  fs.writeFile(path.join(output, name), JSON.stringify(data, null, 2));
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
const initial = await api("status");
assert.ok(!initial.reviewRun?.active);
assert.equal(initial.comparator, candidate);
const baseline = initial.references.main;
const slots = [
  {
    source: "main",
    label: "R0 baseline",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
  {
    source: "comparator",
    label: "R1 candidate",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
    autoSwitch: false,
  },
];
const catalog = await api("catalog");
const empty = [...catalog.situations]
  .sort(
    (a, b) => Number(b.origin === "library") - Number(a.origin === "library"),
  )
  .find((s) => s.name === "Planning: empty Hand while other heroes choose");
assert.ok(empty, "Import and verify the missing empty-Hand Situation first");
const entries = [
  {
    situationId: "e81bc3bd5fff",
    viewpoint: "hero_arien",
    viewPresentations: {
      0: { pane: "hand", selectedCard: "noble_blade" },
      1: { pane: "choice", selectedCard: "noble_blade" },
    },
    goal: "Toggle Choice/Board, Hand and another menu; retain the planning draft without a mutation.",
  },
  {
    situationId: "eebbbbab698b",
    viewpoint: "hero_emmitt",
    viewPresentations: { 0: { pane: "hand" }, 1: { pane: "choice" } },
    goal: "First commitment is authoritative; stage an optional second card, then return through Board/Choice.",
  },
  {
    situationId: "2b928b7b0ab4",
    viewpoint: "hero_brogan",
    viewPresentations: { 0: { pane: "board" }, 1: { pane: "choice" } },
    goal: "Stage a defense, close Choice and reopen from another menu; confirm only explicitly.",
  },
  {
    situationId: "50205badf8ea",
    viewpoint: "hero_hanu",
    viewPresentations: { 0: { pane: "board" }, 1: { pane: "choice" } },
    goal: "Eligible teammate has Choice; an unrelated team member or spectator has Board.",
  },
  {
    situationId: empty.id,
    viewpoint: "hero_arien",
    presentation: { pane: "heroes" },
    goal: "Known empty Hand has no invented Selecting/commit opportunity; unknown opposing Hands remain unknown.",
  },
  {
    situationId: "dc818586ba77",
    viewpoint: "hero_arien",
    presentation: { pane: "board" },
    goal: "Paused workflow remains identifiable; no stale gameplay command becomes enabled.",
  },
];
for (const e of entries) {
  const found = catalog.situations.find((s) => s.id === e.situationId);
  assert.ok(found);
  Object.assign(e, {
    name: found.name,
    origin: found.origin,
    decisionStateId: found.decisionStateId,
  });
}
async function verify(name) {
  const status = await api("status"),
    views = await api("views");
  for (const w of status.windows) {
    assert.deepEqual(w.errors, [], name);
    assert.deepEqual(w.assets, [], name);
    assert.deepEqual(w.warnings, [], name);
    assert.equal(w.config.uiMode, "mobile");
  }
  assert.equal(views[0].state.hash, views[1].state.hash);
  return { status, views };
}
async function capture(name) {
  const report = await api("capture", { indexes: [0, 1] });
  assert.equal(report.diverged, false);
  const directory = path.join(DATA, "reports", report.id);
  await save(name + ".json", { ...report, directory });
  return { ...report, directory };
}
async function extract(selector) {
  const r = await api("extract", {
    indexes: [0, 1],
    mode: "element",
    selector,
  });
  const dir = path.join(DATA, r.url.slice(1).replace(/\/index.html$/, ""));
  return {
    ...r,
    data: JSON.parse(
      await fs.readFile(path.join(dir, "comparison.json"), "utf8"),
    ),
  };
}
async function clickBounds(index, game, bounds) {
  const ws = new WebSocket(
    origin.replace("http:", "ws:") +
      `/api/stream?index=${index}&game=${encodeURIComponent(game)}`,
    { origin },
  );
  const ready = new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (data, binary) => {
      if (!binary) {
        const m = JSON.parse(data);
        if (m.viewport) resolve();
        if (m.error) reject(Error(m.error));
      }
    });
  });
  await ready;
  let id = 0;
  const send = (message) =>
    new Promise((resolve, reject) => {
      const current = ++id;
      const timeout = setTimeout(
        () => reject(Error("Input acknowledgment timed out")),
        10000,
      );
      const receive = (data, binary) => {
        if (binary) return;
        const m = JSON.parse(data);
        if (m.ack === current || m.error) {
          clearTimeout(timeout);
          ws.off("message", receive);
          m.error ? reject(Error(m.error)) : resolve();
        }
      };
      ws.on("message", receive);
      ws.send(JSON.stringify({ ...message, id: current }));
    });
  const point = {
    type: "mouse",
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    button: "left",
    clicks: 1,
  };
  try {
    await send({ ...point, event: "mousePressed", buttons: 1 });
    await send({ ...point, event: "mouseReleased", buttons: 0 });
  } finally {
    ws.close();
  }
}
const records = [];
for (const [i, e] of entries.entries()) {
  await api("load", { ...e, slots });
  const planningStart = i === 0 ? await capture("planning-before-after") : null;
  const before = await verify(e.name);
  if (i === 0) {
    assert.equal(before.views[1].presentation.pane, "choice");
    assert.equal(before.views[1].presentation.selectedCard, "noble_blade");
    assert.equal(before.views[1].presentation.inspectionMobile, "noble_blade");
    const first = planningStart;
    await api("pane", { index: 1, pane: "heroes" });
    await api("pane", { index: 1, pane: "choice" });
    const second = await capture("planning-after-return");
    const resumed = await verify("planning resumed");
    assert.equal(resumed.views[1].state.hash, before.views[1].state.hash);
    assert.equal(resumed.views[1].presentation.selectedCard, "noble_blade");
    assert.equal(resumed.views[1].presentation.inspectionMobile, "noble_blade");
    await save("planning.json", { before, resumed, first, second });
  }
  if (i === 2) {
    const selector =
      '[data-decision-type="SELECT_CARD_OR_PASS"] button[aria-pressed]';
    const initial = await extract(selector);
    const view = initial.data.views.find((v) => v.index === 1);
    const first = view.snapshot.matches[0];
    const bounds = view.snapshot.elements.find(
      (x) => x.path === first.path,
    ).bounds;
    await clickBounds(1, before.views[1].gameId, bounds);
    await api("pane", { index: 1, pane: "board" });
    await api("pane", { index: 1, pane: "settings" });
    await api("pane", { index: 1, pane: "choice" });
    const recovered = await verify("defense draft recovery");
    assert.equal(recovered.views[1].state.hash, before.views[1].state.hash);
    const after = await extract(selector);
    assert.ok(
      after.data.views
        .find((v) => v.index === 1)
        .snapshot.matches.some((m) => m.html.includes('aria-pressed="true"')),
    );
    await save("defense-recovery.json", {
      recovered,
      chosen: first.html,
      sourceExport: after.url,
    });
  }
  records.push({
    ...e,
    ...(await verify(e.name)),
    capture: await capture("case-" + (i + 1)),
  });
  await save("verified-situations.json", records);
  console.log("Verified", e.situationId, e.name);
}
const layout = await api("layout/save", {
  name: "Mobile R1 baseline vs candidate",
  slots,
  synchronization: "api",
});
const presentation = await api("presentation/save", {
  name: "Current mobile Choice",
  change: { pane: "choice" },
});
const run = await api("review-runs/start", {
  name: "Mobile box refactor — R1: Surface state and status ownership",
  performedBy: "human",
  layoutId: layout.layout.id,
  entries: entries.map(
    ({ situationId, viewpoint, presentation, viewPresentations }) => ({
      situationId,
      viewpoint,
      presentation,
      viewPresentations,
    }),
  ),
});
await save("handoff.json", {
  origin,
  output,
  baseline,
  candidate,
  layoutId: layout.layout.id,
  presentationId: presentation.id,
  run,
  entries,
  ready: await verify("human first entry"),
  humanEvaluation: "pending",
  stop: "POST " + origin + "/api/shutdown {}",
});
console.log("R1 evidence:", output);
console.log("Human Run:", JSON.stringify(run));
