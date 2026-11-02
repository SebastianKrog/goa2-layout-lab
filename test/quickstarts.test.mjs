import { test } from "node:test";
import assert from "node:assert/strict";
import { quickstartConfig, respondingSeat } from "../src/quickstarts.mjs";
import { PRESETS, validateSlots } from "../src/config.mjs";
import { DeviceServer } from "../src/device-server.mjs";
const situation = {
  checkpoint: {
    state: {
      teams: {
        RED: { heroes: [{ id: "arien" }, { id: "hanu" }] },
        BLUE: { heroes: [{ id: "brogan" }, { id: "tigerclaw" }] },
      },
    },
  },
};
test("quickstarts use two manual teammates and two ISMCTS opponents in one working-tree View", () => {
  for (const id of ["desktop", "portrait", "device"]) {
    const config = quickstartConfig(id, situation, { botKinds: ["ismcts"] });
    validateSlots([config]);
    assert.equal(config.source, "live");
    assert.equal(config.autoSwitch, true);
    assert.equal(config.autoSwitchManualOnly, true);
    assert.deepEqual(config.bots, {
      brogan: "ismcts",
      tigerclaw: "ismcts",
    });
    assert.equal(config.profile, id === "desktop" ? "desktop" : "portrait");
    assert.equal(config.uiMode, id === "desktop" ? "desktop" : "mobile");
  }
  assert.throws(
    () => quickstartConfig("bad", situation, { botKinds: ["ismcts"] }),
    /Choose/,
  );
  assert.throws(
    () => quickstartConfig("desktop", situation, { botKinds: [] }),
    /bot decision checkout/,
  );
});
test("comparison shortcuts pair main and working tree with matching device profiles", () => {
  for (const [name, profile] of [
    ["Desktop", "desktop"],
    ["Mobile portrait", "portrait"],
    ["Mobile landscape", "landscape"],
  ]) {
    const slots = PRESETS[name + " · Main vs working tree"];
    validateSlots(slots);
    assert.deepEqual(
      slots.map((s) => s.source),
      ["main", "live"],
    );
    assert.ok(slots.every((s) => s.profile === profile));
  }
});
test("human-only autoswitch waits through bot decisions and remains stable for concurrent inputs", () => {
  const config = quickstartConfig("desktop", situation, {
    botKinds: ["ismcts"],
  });
  const seats = { arien: "a", hanu: "h", brogan: "b", tigerclaw: "t" };
  assert.equal(respondingSeat(["brogan"], config, seats), null);
  assert.equal(respondingSeat(["arien", "hanu"], config, seats), null);
  assert.equal(respondingSeat(["hanu", "brogan"], config, seats), "hanu");
  assert.equal(respondingSeat(["missing"], config, seats), null);
  config.autoSwitchManualOnly = false;
  assert.equal(respondingSeat(["brogan"], config, seats), "brogan");
});
test("device autoswitch changes credentials on the same game and defers while reporting", async () => {
  let players = ["brogan"];
  const devices = new DeviceServer({}, async () => ({ players }));
  const session = {
    secret: "secret",
    config: quickstartConfig("device", situation, { botKinds: ["ismcts"] }),
    bots: { brogan: "ismcts", tigerclaw: "ismcts" },
    clone: { game_id: "keep", seats: { arien: "a", hanu: "h", brogan: "b" } },
    revision: 0,
    presentation: { selectedCard: "private" },
  };
  devices.sessions.set(session.secret, session);
  await devices.followDecisions();
  assert.equal(session.revision, 0);
  players = ["hanu"];
  session.reportPending = true;
  await devices.followDecisions();
  assert.equal(session.revision, 0);
  session.reportPending = false;
  await devices.followDecisions();
  assert.equal(session.config.seat, "hanu");
  assert.equal(session.clone.game_id, "keep");
  assert.equal(session.revision, 1);
  assert.deepEqual(session.presentation, {});
  assert.match(devices.reviewStatus(session).url, /token=h/);
  await devices.followDecisions();
  assert.equal(session.revision, 1);
});
