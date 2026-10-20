import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import {
  validateSlots,
  slotsForSituation,
  PRESETS,
  gameURL,
  ROOT,
} from "../config.mjs";
import { instrument, instrumentScript } from "../instrument.mjs";
import { imageDiff, strip, reportHTML } from "../report.mjs";
import net from "node:net";
import { available, waitFor } from "../services.mjs";
import { Comparison } from "../browser.mjs";

test("two duplicate desktop 3D viewpoints are valid; userscript cannot use 3D", () => {
  const slots = structuredClone(PRESETS["3D regression"]);
  slots[0].source = "comparator";
  slots[1].seat = "spectator";
  assert.equal(validateSlots(slots).length, 2);
  assert.throws(
    () => validateSlots([{ ...slots[0], source: "target" }, slots[1]]),
    /2D/,
  );
  assert.throws(() => validateSlots([slots[0]]), /two or three/);
});
test("game URLs preserve private seats and force renderer without enabling native mobile on Base", () => {
  const clone = {
    game_id: "game",
    seats: { hero_arien: "secret+seat" },
    spectator_token: "watch",
  };
  const s = PRESETS["Mobile migration"][1];
  const url = new URL(gameURL(3100, clone, s));
  assert.equal(url.searchParams.get("token"), "secret+seat");
  assert.equal(url.searchParams.get("ui"), "mobile");
  assert.equal(
    new URL(
      gameURL(3101, clone, PRESETS["Mobile migration"][0]),
    ).searchParams.has("ui"),
    false,
  );
  assert.throws(() => gameURL(3100, clone, { ...s, seat: "absent" }), /absent/);
});
test("instrumentation targets the actual camera implementations and fails on incompatible revisions", () => {
  const two = path.join(ROOT, "src/components/board/useMapZoom.ts");
  const three = path.join(ROOT, "src/components/board3d/CameraRig.tsx");
  assert.match(
    instrument(fs.readFileSync(two, "utf8"), two),
    /api.camera2d = bridge/,
  );
  assert.match(
    instrument(fs.readFileSync(three, "utf8"), three),
    /api.camera3d = bridge/,
  );
  assert.equal(instrument("unchanged", "ordinary.ts"), null);
  assert.throws(() => instrument("changed", three), /Unsupported/);
  assert.throws(
    () => instrumentScript("window.GOA2Mobile2D = {};"),
    /Unsupported/,
  );
});
test("different dimensions disable overlays; strips preserve originals and diffs report actual pixels", () => {
  const a = new PNG({ width: 2, height: 2 });
  a.data.fill(255);
  const b = PNG.sync.read(PNG.sync.write(a));
  b.data[0] = 0;
  b.data[1] = 0;
  b.data[2] = 0;
  assert.equal(imageDiff(a, b).pixels, 1);
  assert.equal(imageDiff(a, new PNG({ width: 3, height: 2 })).available, false);
  const combined = strip([a, b]);
  assert.equal(combined.width, 4);
  assert.equal(combined.height, 2);
});
test("reports escape situation/revision labels and identify diverged games", () => {
  const html = reportHTML({
    capturedAt: "<script>",
    situationId: "x",
    references: { base: "a" },
    comparator: "b",
    captures: [],
    pairs: [],
    diverged: true,
  });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Different game states/);
});

test("occupied ports are reported without disturbing their existing owner", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(available(server.address().port), /occupied/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("verified terminal process failures abort readiness waits immediately", async () => {
  const start = Date.now();
  await assert.rejects(
    waitFor(
      () => {
        throw Object.assign(new Error("source exited"), { fatal: true });
      },
      "source",
      5000,
    ),
    /source exited/,
  );
  assert.ok(Date.now() - start < 1000);
});

test("retrying a failed viewpoint reopen preserves the clone and cached presentation", async () => {
  const calls = [];
  const comparison = new Comparison({}, async (...args) => calls.push(args));
  const config = PRESETS["Layout regression"][1];
  const camera = { mode: "2d", k: 2, x: 0.1, y: 0 };
  const clone = { game_id: "keep-this-game", seats: { hero_arien: "private" } };
  comparison.windows = [
    {
      config,
      clone,
      page: { isClosed: () => true },
      context: { close: async () => {} },
      views: { "2d": { render: "2d", camera } },
    },
  ];
  comparison.open = async (next, presentation, existing) => {
    assert.equal(existing, clone);
    assert.deepEqual(presentation.camera, camera);
    return {
      config: next,
      clone,
      page: { url: () => "http://localhost/" },
      warnings: [],
      errors: [],
      assets: [],
    };
  };
  comparison.services = {
    references: REFERENCES_FOR_TEST,
    comparator: "x",
    status: () => [],
  };
  await comparison.configure(0, { profile: "compact" });
  assert.equal(comparison.windows[0].clone.game_id, "keep-this-game");
  assert.equal(calls.length, 0);
});
const REFERENCES_FOR_TEST = { base: "a", script: "b" };

test("planning card adapters support LF and Windows CRLF checkouts", () => {
  const file = path.join(ROOT, "src/components/ui/CardRow.tsx");
  const code = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  for (const source of [code, code.replaceAll("\n", "\r\n")]) {
    const instrumented = instrument(source, file);
    assert.ok(instrumented.includes("data-lab-card={card.id}"));
    assert.ok(
      instrumented.includes("data-lab-selected={isSelected || undefined}"),
    );
    assert.ok(instrumented.includes("onClick={onClick}"));
  }
});

test("loading a different roster replaces absent seats and preserves valid independent viewpoints", () => {
  for (const owner of ["hero_gydion", "hero_snorri", "hero_emmitt"]) {
    const situation = {
      provenance: { seat: owner },
      checkpoint: {
        state: {
          teams: {
            RED: { heroes: [{ id: owner, team: "RED" }] },
            BLUE: { heroes: [{ id: "hero_wasp", team: "BLUE" }] },
          },
        },
      },
    };
    const configs = structuredClone(PRESETS["Mobile migration"]);
    configs[1].seat = "spectator";
    configs[2].seat = "hero_wasp";
    const before = structuredClone(configs);
    assert.deepEqual(
      slotsForSituation(configs, situation).map((s) => s.seat),
      [owner, "spectator", "hero_wasp"],
    );
    assert.deepEqual(configs, before);
    delete situation.provenance.seat;
    situation.summary = { responder: owner };
    assert.equal(slotsForSituation(configs, situation)[0].seat, owner);
    situation.summary = { responder: "team:BLUE" };
    assert.equal(slotsForSituation(configs, situation)[0].seat, "hero_wasp");
  }
});

test("comparison load resolves unavailable preset seats before opening any clones", async () => {
  const owner = "hero_snorri";
  const situation = {
    id: "runes",
    provenance: { seat: owner },
    checkpoint: {
      state: { teams: { RED: { heroes: [{ id: owner, team: "RED" }] } } },
    },
  };
  let cleared = false;
  const comparison = new Comparison({ stop: async () => {} }, async (route) => {
    assert.ok(route.startsWith("/situations/"));
    assert.equal(cleared, false);
    return route.endsWith("/runes") ? situation : null;
  });
  comparison.clear = async () => {
    cleared = true;
    comparison.windows = [];
  };
  comparison.open = async (config) => {
    assert.equal(config.seat, owner);
    return { config };
  };
  comparison.status = () => comparison.windows.map((w) => w.config);
  const result = await comparison.load("runes", PRESETS["Mobile migration"]);
  assert.equal(result.length, 3);
  assert.equal(cleared, true);
  cleared = false;
  await assert.rejects(
    () => comparison.load("absent", PRESETS["Mobile migration"]),
    /saved situation/,
  );
  assert.equal(
    cleared,
    false,
    "An invalid situation must not close the existing comparison",
  );
});
