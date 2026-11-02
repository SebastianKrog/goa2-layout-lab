import assert from "node:assert/strict";
import { test } from "node:test";
import { Comparison } from "../src/browser.mjs";
import { Synchronizer } from "../src/synchronize.mjs";

const config = {
  source: "live",
  profile: "desktop",
  render: "2d",
  uiMode: "desktop",
  seat: "hero_arien",
  bots: { hero_hanu: "random" },
};
const situation = {
  id: "same",
  checkpoint: {
    state: {
      teams: { RED: { heroes: [{ id: "hero_arien" }, { id: "hero_hanu" }] } },
    },
  },
};
function fixture() {
  const closed = [],
    opened = [],
    stopped = [];
  const c = new Comparison(
    { stop: async (source) => stopped.push(source) },
    async (route) =>
      route.endsWith("/checkpoint")
        ? { situation: structuredClone(situation) }
        : { hash: "same" },
  );
  const win = (id, group) => ({
    config: structuredClone(config),
    situation,
    syncGroup: group,
    clone: { game_id: id, seats: { hero_arien: "a", hero_hanu: "h" } },
    initialPresentation: {},
    views: { "2d": {} },
    page: {
      isClosed: () => true,
      evaluate: async () => ({ render: "2d", pane: "board" }),
    },
  });
  c.windows = [win("a", "current"), win("b", "current")];
  c.status = () => ({ windows: c.windows });
  c.botCapabilities = async () => ({ botKinds: ["random", "heuristic"] });
  c.closeWindow = async (w) => closed.push(w.clone.game_id);
  c.open = async (cfg, p, clone, index, saved) => {
    opened.push(cfg);
    return { ...win("new" + index), config: cfg, situation: saved };
  };
  return { c, win, opened, closed, stopped };
}
test("Reset retains group membership and never joins independent same-Situation sessions", async () => {
  const { c } = fixture();
  await c.reset(0);
  assert.deepEqual(c.sync.targets(c.windows[0]), c.windows);
  c.windows[1].syncGroup = "independent";
  await c.reset();
  assert.equal(c.windows[0].syncGroup, "current");
  assert.equal(c.windows[1].syncGroup, "independent");
  assert.equal(c.sync.targets(c.windows[0]).length, 1);
  for (const w of c.windows) delete w.syncGroup;
  assert.notEqual(c.sync.groupKey(c.windows[0]), c.sync.groupKey(c.windows[1]));
});
test("loading a comparison retains frontend services used by phone and userscript shares", async () => {
  const { c, win, stopped } = fixture();
  const phone = win("phone", "phone"),
    target = win("script", "script");
  target.config.source = "target";
  c.sync.external = () => [phone, target];
  await c.load("same", [{ ...config, source: "comparator" }], {}, situation);
  assert.deepEqual(stopped, ["main"]);
  c.sync.external = () => [];
  stopped.length = 0;
  await c.load("same", [{ ...config, source: "comparator" }], {}, situation);
  assert.deepEqual(stopped.sort(), ["base", "live", "main"]);
});
test("API + clicks cannot reach unrelated groups or replay UI onto physical-device transports", async () => {
  const visited = [];
  const page = (id) => ({
    evaluate: async () => {
      visited.push(id);
      return { pane: "board" };
    },
    waitForTimeout: async () => {},
  });
  const source = { config, syncGroup: "one", page: page("source") },
    matched = { config, syncGroup: "one", page: page("matched") },
    unrelated = { config, syncGroup: "two", page: page("unrelated") };
  const sync = new Synchronizer({ windows: [source, matched, unrelated] });
  sync.external = () => [{ config, syncGroup: "one" }];
  sync.mode = "api-clicks";
  await sync.mirrorClick(source, { text: "Hand" });
  assert.ok(visited.includes("matched"));
  assert.ok(!visited.includes("unrelated"));
});
test("Add View rejects conflicting group policies before opening a browser or changing games", async () => {
  const { c, opened, closed } = fixture();
  await assert.rejects(
    c.addView({ config: { ...config, bots: { hero_hanu: "heuristic" } } }),
    /Conflicting/,
  );
  assert.equal(opened.length, 0);
  assert.equal(closed.length, 0);
  assert.equal(c.sync.error, null);
  assert.ok(c.windows.every((w) => w.config.bots.hero_hanu === "random"));
  await c.addView({ config: { ...config, bots: {} } });
  assert.equal(c.windows.length, 3);
  assert.ok(c.windows.every((w) => w.config.bots.hero_hanu === "random"));
  assert.equal(c.windows[2].syncGroup, "current");
});
test("failed combined source/controller edits leave every existing group controller unchanged", async () => {
  const { c } = fixture();
  c.open = async () => {
    throw Error("frontend unavailable");
  };
  await assert.rejects(
    c.configure(0, { source: "main", bots: { hero_hanu: "heuristic" } }),
    /unavailable/,
  );
  assert.equal(c.windows[0].config.source, "live");
  assert.ok(c.windows.every((w) => w.config.bots.hero_hanu === "random"));
  // A successful controller-only edit still commits the entire group.
  c.windows[0].page.isClosed = () => false;
  await c.configure(0, { bots: { hero_hanu: "heuristic" } });
  assert.ok(c.windows.every((w) => w.config.bots.hero_hanu === "heuristic"));
});

test("synchronization preparation changes no active policy until the staged commit", async () => {
  const { c, win } = fixture();
  const old = c.windows;
  const staged = [win("new-a", "new-group"), win("new-b", "new-group")];
  staged[0].config.bots = { hero_hanu: "heuristic" };
  staged[1].config.bots = {};
  const commit = await c.sync.prepareMode("api-clicks", staged);
  assert.equal(c.sync.mode, "api");
  assert.ok(old.every((w) => w.config.bots.hero_hanu === "random"));
  assert.deepEqual(staged[1].config.bots, {});
  commit();
  assert.equal(c.sync.mode, "api-clicks");
  assert.ok(staged.every((w) => w.config.bots.hero_hanu === "heuristic"));
  assert.ok(old.every((w) => w.config.bots.hero_hanu === "random"));
});
test("device joins forward exact checkpoint strings and keep the parent's group", async () => {
  const { DeviceServer } = await import("../src/device-server.mjs");
  const exact = '{"state":{"rng_seed":18446744073709551615}}';
  const calls = [];
  const parent = {
    config: { ...config, bots: {} },
    situation,
    syncGroup: "parent",
    clone: { game_id: "parent" },
  };
  const devices = new DeviceServer(
    { frontend: async () => 3102 },
    async (route, body) => {
      if (route.startsWith("/situations/")) return situation;
      if (route.endsWith("/bot-state"))
        return { hash: "exact", checkpoint_json: exact, result_json: "null" };
      if (route === "/clone") {
        calls.push(body);
        return {
          game_id: "device",
          seats: { hero_arien: "a", hero_hanu: "h" },
        };
      }
      throw Error(route);
    },
    { port: 3300, hosts: () => ["127.0.0.1"] },
  );
  devices.listen = async () => {};
  devices.synchronizer = { mode: "api", participants: () => [parent] };
  await devices.open({
    situationId: situation.id,
    slot: { ...config, bots: {} },
  });
  assert.equal(calls[0].checkpoint_json, exact);
  assert.equal(calls[0].situation, undefined);
  assert.equal([...devices.sessions.values()][0].syncGroup, "parent");
});
