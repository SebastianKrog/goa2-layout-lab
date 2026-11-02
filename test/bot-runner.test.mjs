import { test } from "node:test";
import assert from "node:assert/strict";
import { BotRunner } from "../src/bot-runner.mjs";
import { Synchronizer } from "../src/synchronize.mjs";
function fixture() {
  const calls = [],
    computed = [];
  const win = (id) => ({
    situation: { id: "opening" },
    syncGroup: "current",
    config: { seat: "human", bots: { bot: "random" } },
    clone: { game_id: id, seats: { human: "h", bot: "b" } },
  });
  const a = win("a"),
    b = win("b"),
    device = { ...win("phone"), situationId: "opening" };
  delete device.situation;
  const comparison = {
    windows: [a, b],
    services: {
      botRequest: async (route, body) => {
        computed.push(body);
        return {
          decision: {
            actor: "bot",
            message: { type: "COMMIT_CARD", card_id: "one" },
          },
        };
      },
    },
    api: async (route, body) => {
      calls.push({ route, body });
      return route.endsWith("bot-state")
        ? { hash: "same", checkpoint_json: '{"state":{}}', result_json: "null" }
        : { hash: "same" };
    },
  };
  comparison.sync = new Synchronizer(comparison);
  comparison.sync.external = () => [device];
  const runner = new BotRunner(comparison);
  return { comparison, runner, calls, computed, a, b, device };
}
test("default synchronization groups desk and device Views and computes a bot decision once", async () => {
  const { comparison, runner, calls, computed } = fixture();
  assert.equal(comparison.sync.mode, "api");
  await runner.tick();
  assert.equal(computed.length, 1);
  assert.deepEqual(computed[0].bots, { bot: "random" });
  const apply = calls.find((c) => c.route === "/synchronize").body;
  assert.deepEqual(apply.games, ["a", "b", "phone"]);
  assert.equal(apply.expectedHash, "same");
  assert.equal(apply.actor, "bot");
  assert.ok(!calls.some((c) => c.route === "/clone" || c.route === "/bots"));
});
test("stale bot decisions are discarded without disabling sync or controllers", async () => {
  const { comparison, runner, a } = fixture();
  const api = comparison.api;
  comparison.api = async (route, body) => {
    if (route === "/synchronize")
      throw Object.assign(Error("Bot decision is stale"), { status: 409 });
    return api(route, body);
  };
  await runner.tick();
  assert.equal(comparison.sync.mode, "api");
  assert.equal(a.botError, undefined);
  assert.deepEqual(a.config.bots, { bot: "random" });
});
test("a human/controller change while computing invalidates the result", async () => {
  const { comparison, runner, calls, a, b, device } = fixture();
  comparison.services.botRequest = async () => {
    for (const w of [a, b, device]) w.config.bots = {};
    return { decision: { actor: "bot", message: { type: "COMMIT_CARD" } } };
  };
  await runner.tick();
  assert.ok(!calls.some((c) => c.route === "/synchronize"));
});
test("manual decision states are cached and reporting/busy operations pause automation", async () => {
  const { comparison, runner, computed } = fixture();
  comparison.services.botRequest = async (_, body) => {
    computed.push(body);
    return { decision: null };
  };
  runner.busy = () => true;
  await runner.tick();
  assert.equal(computed.length, 0);
  runner.busy = () => false;
  await runner.tick();
  await runner.tick();
  assert.equal(computed.length, 1);
});
test("independent mode computes separately and conflicting synchronized policies fail before applying", async () => {
  const { comparison, runner, computed, b, calls } = fixture();
  comparison.sync.mode = "none";
  await runner.tick();
  assert.equal(computed.length, 3);
  computed.length = 0;
  calls.length = 0;
  comparison.sync.mode = "api";
  b.config.bots = { bot: "heuristic" };
  await runner.tick();
  assert.match(comparison.sync.error, /Conflicting/);
  assert.equal(computed.length, 0);
  assert.ok(!calls.some((c) => c.route === "/synchronize"));
});

test("different play sessions remain separate even when they use the same Situation", async () => {
  const { comparison, runner, computed, a, b, device } = fixture();
  a.syncGroup = b.syncGroup = "current";
  device.syncGroup = "older-phone-game";
  await runner.tick();
  assert.equal(computed.length, 2);
  assert.deepEqual(comparison.sync.targets(a), [a, b]);
});

test("device synchronization keeps actions scoped to its selected hero", async (t) => {
  const { DeviceServer } = await import("../src/device-server.mjs");
  const devices = new DeviceServer({}, async () => {}, {
    port: 0,
    hosts: () => ["127.0.0.1"],
  });
  await devices.listen();
  t.after(() => devices.close());
  const secret = "a".repeat(64),
    calls = [];
  const session = {
    id: "phone",
    secret,
    config: {
      source: "live",
      profile: "portrait",
      render: "2d",
      uiMode: "mobile",
      seat: "human",
    },
    clone: { game_id: "own", seats: { human: "h", other: "o" } },
    oldPaths: new Set(),
    sockets: new Set(),
    bots: {},
  };
  devices.sessions.set(secret, session);
  devices.synchronizer = { receive: async (...args) => calls.push(args) };
  const origin = `http://127.0.0.1:${devices.port}`;
  const action = async (actor, type) =>
    fetch(origin + "/__device/action", {
      method: "POST",
      headers: {
        origin,
        cookie: `goa2_device=${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ actor, message: { type } }),
    });
  assert.equal((await action("other", "COMMIT_CARD")).status, 422);
  assert.equal((await action("human", "ADVANCE")).status, 422);
  assert.equal(calls.length, 0);
  assert.equal((await action("human", "COMMIT_CARD")).status, 200);
  assert.equal(calls.length, 1);
});

test("bot checkpoints and pending results cross Node as exact opaque JSON", async () => {
  const { comparison, runner, computed } = fixture();
  const exact = '{"state":{"rng_seed":18446744073709551615}}';
  const result = '{"selection":{"amount":1152921504606846979}}';
  const original = comparison.api;
  comparison.api = async (route, body, method) =>
    route.endsWith("bot-state")
      ? JSON.parse(
          JSON.stringify({
            hash: "same",
            checkpoint_json: exact,
            result_json: result,
          }),
        )
      : original(route, body, method);
  await runner.tick();
  assert.equal(computed[0].checkpoint_json, exact);
  assert.equal(computed[0].result_json, result);
  assert.equal(computed[0].checkpoint, undefined);
});
