import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { Services } from "../src/services.mjs";
import { Comparison } from "../src/browser.mjs";
import { PRESETS } from "../src/config.mjs";
import { localAPIProxy } from "../src/local-api-proxy.mjs";

test("concurrent Base/Target starts share one service and failed starts can retry", async () => {
  const services = new Services("test");
  let calls = 0,
    finish;
  services.startFrontend = async () => {
    calls++;
    await new Promise((resolve) => (finish = resolve));
    return 3101;
  };
  const base = services.frontend("base"),
    target = services.frontend("target");
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await Promise.all([base, target]), [3101, 3101]);
  services.startFrontend = async () => {
    throw Error("failed");
  };
  await assert.rejects(() => services.frontend("base"), /failed/);
  services.startFrontend = async () => 42;
  assert.equal(await services.frontend("target"), 42);
});

test("identical commit sources share preparation across different service slots", async () => {
  const services = new Services("test");
  let calls = 0;
  services.prepareSource = async () => {
    calls++;
    return "prepared";
  };
  assert.deepEqual(
    await Promise.all([services.source("sha"), services.source("sha")]),
    ["prepared", "prepared"],
  );
  assert.equal(calls, 1);
});

const situation = {
  id: "moment",
  checkpoint: { state: { teams: { RED: { heroes: [{ id: "hero_arien" }] } } } },
};
test("views open concurrently, retain slot order, and clean late successes after a failure", async () => {
  const comparison = new Comparison({ stop: async () => {} }, async () => [
    situation,
  ]);
  comparison.status = () => comparison.windows;
  const pending = [];
  comparison.open = (config) =>
    new Promise((resolve, reject) => pending.push({ config, resolve, reject }));
  const loading = comparison.load(
    "moment",
    PRESETS["Mobile migration"],
    {},
    situation,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 3);
  for (const i of [2, 0, 1]) pending[i].resolve({ config: pending[i].config });
  assert.deepEqual(
    (await loading).map((w) => w.config.source),
    ["base", "comparator", "target"],
  );
  comparison.windows = [];
  pending.length = 0;
  const closed = [];
  comparison.closeWindow = async (win) => closed.push(win.config.source);
  const failing = comparison.load(
    "moment",
    PRESETS["Mobile migration"],
    {},
    situation,
  );
  await new Promise((resolve) => setImmediate(resolve));
  pending[0].reject(Error("no state"));
  pending[2].resolve({ config: pending[2].config });
  pending[1].resolve({ config: pending[1].config });
  await assert.rejects(() => failing, /View 1: no state/);
  assert.deepEqual(closed.sort(), ["comparator", "target"]);
  assert.equal(comparison.windows.length, 0);
});

test("local proxy preserves API paths, query strings, redirects and WebSocket support", () => {
  const config = localAPIProxy(8800);
  assert.equal(config.ws, true);
  assert.equal(
    config.rewrite("/api/games/abc/ws?token=secret"),
    "/games/abc/ws?token=secret",
  );
  assert.equal(config.rewrite("/api"), "/");
  const proxy = new EventEmitter();
  config.configure(proxy);
  const response = {
    headers: {
      location: "http://127.0.0.1:8800/games/?page=2",
      "set-cookie": "private",
    },
  };
  proxy.emit("proxyRes", response);
  assert.equal(response.headers.location, "/api/games/?page=2");
  assert.equal(response.headers["set-cookie"], undefined);
});

test("single view and per-view controllers retain independent clone configuration", async () => {
  const moment = structuredClone(situation);
  moment.checkpoint.state.teams.RED.heroes.push({ id: "hero_hanu" });
  const calls = [];
  const comparison = new Comparison({ stop: async () => {} }, async (route) => {
    calls.push(route);
    return { bot_kinds: ["random", "heuristic"] };
  });
  comparison.status = () => comparison.windows;
  comparison.open = async (config) => ({ config });
  comparison.closeWindow = async () => {};
  const solo = { ...PRESETS["Play solo"][0], bots: { hero_hanu: "random" } };
  assert.equal((await comparison.load("moment", [solo], {}, moment)).length, 1);
  const two = await comparison.load(
    "moment",
    [solo, { ...solo, bots: { hero_hanu: "heuristic" } }],
    {},
    moment,
  );
  assert.equal(two[0].config.bots.hero_hanu, "random");
  assert.equal(two[1].config.bots.hero_hanu, "heuristic");
  await assert.rejects(comparison.sync.setMode("api"), /Turn off bots/);
  // Invalid setup must not replace the working views.
  const previous = comparison.windows;
  await assert.rejects(
    comparison.load(
      "moment",
      [{ ...solo, bots: { hero_arien: "invalid" } }],
      {},
      moment,
    ),
    /bot policies/,
  );
  await assert.rejects(
    comparison.load(
      "moment",
      [{ ...solo, bots: { absent: "random" } }],
      {},
      moment,
    ),
    /absent/,
  );
  await assert.rejects(
    comparison.load(
      "moment",
      [{ ...solo, seat: "missing-human", bots: { hero_arien: "invalid" } }],
      {},
      moment,
    ),
    /bot policies/,
  );
  comparison.api = async () => ({ bot_kinds: [] });
  await assert.rejects(
    comparison.load("moment", [solo], {}, moment),
    /no requested bots/,
  );
  assert.equal(comparison.windows, previous);
});

test("auto switch only changes viewpoint after actions, including bot-owned decisions", async () => {
  let players = ["arien", "hanu"];
  const comparison = new Comparison({}, async () => ({ players }));
  const win = {
    config: { seat: "arien", autoSwitch: true, bots: { bot: "random" } },
    clone: { game_id: "keep", seats: { arien: "a", hanu: "h", bot: "b" } },
    page: { isClosed: () => false },
    warnings: [],
  };
  comparison.windows = [win];
  const changes = [];
  const switcher = async (index, seat) => {
    changes.push([index, seat]);
    win.config.seat = seat;
  };
  await comparison.followDecisions(switcher);
  assert.deepEqual(changes, [], "Keep a player who still owes a decision");
  players = ["hanu"];
  await comparison.followDecisions(switcher);
  assert.deepEqual(changes, [[0, "hanu"]]);
  assert.equal(win.clone.game_id, "keep");
  players = ["arien", "hanu"];
  await comparison.followDecisions(switcher);
  assert.equal(
    changes.length,
    1,
    "Do not bounce among simultaneous responders",
  );
  players = ["bot"];
  await comparison.followDecisions(switcher);
  assert.equal(
    changes.at(-1)[1],
    "bot",
    "Viewing a bot does not take over its controller",
  );
  assert.deepEqual(win.config.bots, { bot: "random" });
  const count = changes.length;
  players = ["arien"];
  win.config.autoSwitch = false;
  await comparison.followDecisions(switcher);
  assert.equal(changes.length, count, "Off means keep the selected seat");
  win.config.autoSwitch = true;
  await comparison.followDecisions(async () => {
    throw Error("connection lost");
  });
  assert.equal(win.config.autoSwitch, false);
  assert.match(win.warnings[0], /connection lost/);
});
