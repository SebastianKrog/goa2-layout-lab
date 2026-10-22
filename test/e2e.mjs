import { toPresentation } from "../src/presentation-model.mjs";
// Explicit acceptance run; refuses to attach to a normal interactive desk.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA, ROOT, PRESETS, REFERENCES, PORTS } from "../src/config.mjs";
import { delay, waitFor } from "../src/services.mjs";

const base = `http://localhost:${PORTS.desk}`;
async function get(route) {
  const response = await fetch(base + route, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function action(name, body = {}, expected = 200) {
  const response = await fetch(`${base}/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
}
async function step(name, fn) {
  console.log(`Checking: ${name}`);
  await fn();
  console.log(`PASS: ${name}`);
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.015, `${a} != ${b}`);
const status = await get("/api/status");
assert.ok(
  status.headless && status.verification,
  "Start a dedicated desk with --headless --no-open --no-auto-load --verification first.",
);
const evidence = {
  startedAt: new Date().toISOString(),
  runtime: status.runtime,
  reports: [],
};
let planning, saved;

await step(
  "three phone versions, script activation and screenshot report",
  async () => {
    planning = await action("starter", { name: "Acceptance planning" });
    const result = await action("load", {
      situationId: planning.id,
      slots: PRESETS["Mobile migration"],
    });
    assert.equal(result.windows.length, 3);
    assert.deepEqual(result.references, REFERENCES);
    assert.match(result.script.checksum, /^[a-f0-9]{64}$/);
    const views = await get("/api/views");
    assert.deepEqual(
      views.map((v) => v.scriptActive),
      [false, false, true],
    );
    assert.equal(new Set(views.map((v) => v.state.hash)).size, 1);
    const report = await action("capture");
    evidence.reports.push(report.url);
    const metadata = await get(report.url.replace("index.html", "report.json"));
    assert.equal(metadata.captures.length, 3);
    assert.equal(metadata.diverged, false);
    assert.ok(
      metadata.captures.every((c) => c.width === 390 && c.height === 844),
    );
    assert.equal(metadata.pairs.length, 3);
  },
);
await step(
  "saved panels, rotation, non-default 2D camera and reset isolation",
  async () => {
    await action("pane", { index: 1, pane: "hand" });
    await action("pane", { index: 2, pane: "deck" });
    saved = await action("save", {
      index: 1,
      name: "Acceptance phone hand / target deck",
    });
    assert.equal(saved.presentation.schema, 2);
    assert.equal(saved.presentations, undefined);
    const captured = (await get("/api/views")).map((v) => v.presentation);
    assert.equal(captured[1].pane, "hand");
    assert.equal(captured[2].pane, "deck");
    assert.ok(!JSON.stringify(saved).includes("spectator_token"));
    const before = await get("/api/status");
    const reset = await action("reset", { index: 1 });
    assert.equal(reset.windows[0].gameId, before.windows[0].gameId);
    assert.notEqual(reset.windows[1].gameId, before.windows[1].gameId);
    assert.equal(reset.windows[2].gameId, before.windows[2].gameId);
    const fixture = structuredClone(saved);
    captured[1].camera = { mode: "2d", k: 2.5, x: 0.12, y: -0.08 };
    captured[2].rotation = {
      angle: 180,
      centerX: "0px",
      centerY: "0px",
    };
    const imported = await action("import", {
      content: fixture,
      name: "Acceptance phone camera fixture",
    });
    await action("load", {
      situationId: imported.id,
      slots: PRESETS["Mobile migration"].map((slot, i) => ({
        ...slot,
        overrides: toPresentation(captured[i], slot.seat),
      })),
    });
    const views = await get("/api/views");
    assert.equal(views[1].presentation.pane, "hand");
    assert.equal(views[2].presentation.pane, "deck");
    near(views[1].presentation.camera.k, 2.5);
    near(views[1].presentation.camera.x, 0.12);
    near(views[2].presentation.rotation.angle, 180);
    assert.ok(
      (await get("/api/status")).windows.every((w) => !w.warnings.length),
      JSON.stringify(await get("/api/status")),
    );
  },
);
await step(
  "orientation, desktop script exclusion and invalid Target 3D",
  async () => {
    const before = await get("/api/status");
    await action("configure", { index: 2, update: { profile: "landscape" } });
    let views = await get("/api/views");
    assert.equal(views[2].scriptActive, true);
    assert.equal(
      (await get("/api/status")).windows[2].gameId,
      before.windows[2].gameId,
    );
    await action("configure", { index: 2, update: { profile: "desktop" } });
    views = await get("/api/views");
    assert.equal(views[2].scriptActive, false);
    await action("configure", { index: 2, update: { render: "3d" } }, 422);
  },
);
await step(
  "two desktop 3D viewpoints, camera restore/copy and mode memory",
  async () => {
    const slots = structuredClone(PRESETS["3D regression"]);
    slots[1].seat = "hero_hanu";
    const result = await action("load", {
      situationId: planning.id,
      slots,
    });
    assert.equal(result.windows.length, 2);
    let views = await get("/api/views");
    assert.ok(views.every((v) => v.presentation.camera.mode === "3d"));
    assert.equal(new Set(views.map((v) => v.state.hash)).size, 1);
    const fixture = await action("save", {
      index: 0,
      name: "Acceptance desktop 3D",
    });
    const captured = (await get("/api/views")).map((v) => v.presentation);
    captured[1].camera = {
      mode: "3d",
      position: [2, 11, 9],
      up: [0, 1, 0],
      target: [1, 0.5, 1],
      fov: 47,
      zoom: 1.1,
    };
    captured[1].inspection3d = {
      cardId: null,
      heroId: "hero_hanu",
      altHeld: false,
    };
    slots.forEach(
      (slot, i) => (slot.overrides = toPresentation(captured[i], slot.seat)),
    );
    const imported = await action("import", {
      content: fixture,
      name: "Acceptance 3D camera fixture",
    });
    await action("load", {
      situationId: imported.id,
      slots,
    });
    views = await get("/api/views");
    views[1].presentation.camera.position.forEach((n, i) =>
      near(n, [2, 11, 9][i]),
    );
    const copied = await action("camera", { from: 1, indexes: [0, 1] });
    assert.ok(copied.windows.every((w) => !w.warnings.length));
    views = await get("/api/views");
    views[0].presentation.camera.position.forEach((n, i) =>
      near(n, views[1].presentation.camera.position[i]),
    );
    const gameId = views[1].gameId;
    await action("configure", {
      index: 1,
      update: { render: "2d", uiMode: "desktop" },
    });
    await action("configure", { index: 1, update: { render: "3d" } });
    views = await get("/api/views");
    assert.equal(views[1].gameId, gameId);
    views[1].presentation.camera.position.forEach((n, i) =>
      near(n, [2, 11, 9][i]),
    );
    const report = await action("capture");
    evidence.reports.push(report.url);
    const metadata = await get(report.url.replace("index.html", "report.json"));
    assert.equal(metadata.captures.length, 2);
    assert.ok(metadata.captures.every((c) => c.width === 1440));
    assert.ok(metadata.pairs[0].differentViewpoints);
  },
);
await step("duplicate sources and frozen running match clocks", async () => {
  const timed = await action("starter", {
    timed: true,
    ready_all: true,
    name: "Acceptance running frozen clock",
  });
  const slots = structuredClone(PRESETS["Layout regression"]);
  slots[0].source = "comparator";
  slots[1].seat = "spectator";
  await action("load", { situationId: timed.id, slots });
  const before = await get("/api/views");
  assert.ok(before.every((v) => v.clock?.status === "RUNNING"));
  assert.notEqual(before[0].gameId, before[1].gameId);
  await delay(1500);
  const after = await get("/api/views");
  assert.deepEqual(
    after.map((v) => v.state.hash),
    before.map((v) => v.state.hash),
  );
  assert.deepEqual(
    after.map((v) => v.wallTime),
    before.map((v) => v.wallTime),
  );
  assert.deepEqual(
    after.map((v) => v.clock.players),
    before.map((v) => v.clock.players),
  );
  const report = await action("capture");
  evidence.reports.push(report.url);
});
await step(
  "older/newest comparator refresh with fixed references",
  async () => {
    await action("refresh", { ref: REFERENCES.base });
    let state = await get("/api/status");
    assert.equal(state.comparator, REFERENCES.base);
    assert.deepEqual(state.references, REFERENCES);
    await action("refresh", { ref: "mobile-migration" });
    state = await get("/api/status");
    assert.equal(state.comparator, status.comparator);
  },
);
await step("live CSS hot reload without changing the reference", async () => {
  const slots = structuredClone(PRESETS["Layout regression"]);
  slots[1].source = "live";
  await action("load", {
    situationId: planning.id,
    slots,
  });
  const before = await get("/api/views");
  const filename = path.join(ROOT, "src/components/pages/GameView.module.css");
  const probe =
    "\n/* layout-lab acceptance probe */\n:root { --goa2-layout-lab-acceptance: 1; }\n";
  await fs.appendFile(filename, probe);
  try {
    await waitFor(
      async () =>
        (await get("/api/views"))[1].hmrUpdates > before[1].hmrUpdates,
      "live CSS update",
      30_000,
    );
    const after = await get("/api/views");
    assert.equal(after[0].hmrUpdates, before[0].hmrUpdates);
    const report = await action("capture");
    evidence.reports.push(report.url);
    const metadata = await get(report.url.replace("index.html", "report.json"));
    assert.equal(metadata.captures[1].dirty, true);
  } finally {
    const current = await fs.readFile(filename, "utf8");
    if (current.endsWith(probe))
      await fs.writeFile(filename, current.slice(0, -probe.length));
    else
      throw new Error(
        "The probe was edited concurrently; remove only its named CSS rule manually.",
      );
  }
});
await step(
  "preset persistence, export/import, schema and origin checks",
  async () => {
    await action("preset", {
      name: "Acceptance saved preset",
      slots: PRESETS["3D regression"],
    });
    const exported = await get(`/export/${saved.id}`);
    assert.equal(exported.schema, 1);
    const imported = await action("import", {
      content: exported,
      name: "Acceptance exported round trip",
    });
    assert.deepEqual(imported.checkpoint.state, exported.checkpoint.state);
    await action("import", { content: { schema: 99, checkpoint: {} } }, 422);
    await action(
      "references",
      { base: REFERENCES.base, script: REFERENCES.script, confirm: "no" },
      422,
    );
    const response = await fetch(base + "/api/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://unrelated.example",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
  },
);
evidence.finishedAt = new Date().toISOString();
evidence.assertions = [
  "three-way phone",
  "independent reset",
  "saved panels",
  "2D camera/rotation",
  "desktop script exclusion",
  "two desktop 3D views",
  "3D camera restore/copy",
  "mode memory",
  "duplicate sources",
  "frozen running clocks",
  "explicit comparator revisions",
  "live HMR isolation",
  "portable situations",
  "schema validation",
  "same-origin controls",
];
await fs.writeFile(
  path.join(DATA, "acceptance.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(
  "All acceptance checks passed. Evidence: .layout-lab/acceptance.json",
);
