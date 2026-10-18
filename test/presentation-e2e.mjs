import { PORTS } from "../config.mjs";
// Additional adapter checks on an explicitly marked verification desk.
import assert from "node:assert/strict";
import { PRESETS } from "../config.mjs";

async function request(route, body) {
  const response = await fetch(`http://localhost:${PORTS.desk}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}
assert.ok(
  (await request("/api/status")).verification,
  "Use a dedicated --verification desk.",
);
const starter = await request("/api/starter", {
  name: "Acceptance desktop panels",
});
await request("/api/load", {
  situationId: starter.id,
  slots: PRESETS["Layout regression"],
});
await request("/api/pane", { index: 0, pane: "deck" });
await request("/api/pane", { index: 1, pane: "log" });
const saved = await request("/api/save", {
  index: 0,
  name: "Acceptance desktop deck and log",
});
assert.equal(saved.presentations[0].pane, "deck");
assert.equal(saved.presentations[1].pane, "log");
await request("/api/load", { situationId: saved.id, restoreViews: true });
let views = await request("/api/views");
assert.deepEqual(
  views.map((v) => v.presentation.pane),
  ["deck", "log"],
);
assert.ok(
  (await request("/api/status")).windows.every((w) => !w.warnings.length),
);
console.log(
  "PASS: Base deck and Comparator log restore through native controls.",
);

// Restore only cards available in the normal player view. Unknown cards must
// produce a visible warning rather than being reconstructed from checkpoints.
const heroes = Object.values(starter.checkpoint.state.teams).flatMap(
  (t) => t.heroes,
);
const own = heroes.find((h) => h.id === "hero_arien").hand[0].id;
const hidden = "layout-lab-unavailable-card";
const fixture = structuredClone(starter);
const slots = structuredClone(PRESETS["3D regression"]);
slots[1].source = "comparator";
fixture.provenance.slots = slots;
fixture.presentations = Object.fromEntries(
  [0, 1].map((i) => [
    i,
    {
      render: "3d",
      pane: "board",
      inspection3d: {
        cardId: i ? hidden : own,
        heroId: null,
        altHeld: true,
      },
    },
  ]),
);
const imported = await request("/api/import", {
  content: fixture,
  name: "Acceptance scoped card inspection",
});
await request("/api/load", { situationId: imported.id, restoreViews: true });
views = await request("/api/views");
assert.equal(views[0].presentation.inspection3d.cardId, own);
assert.equal(views[0].presentation.inspection3d.altHeld, true);
assert.equal(views[1].presentation.inspection3d.cardId, null);
const status = await request("/api/status");
assert.ok(!status.windows[0].warnings.length);
assert.ok(
  status.windows[1].warnings.some((w) =>
    w.includes("Card absent from player-scoped view"),
  ),
);
console.log(
  "PASS: own-card inspection/Alt restore; unavailable cards produce explicit warnings.",
);
