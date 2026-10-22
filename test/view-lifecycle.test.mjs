import { test } from "node:test";
import assert from "node:assert/strict";
import { Comparison } from "../browser.mjs";
import { PRESETS } from "../config.mjs";
const config = PRESETS.Current[0];
function situation(id) {
  return {
    id,
    checkpoint: {
      state: { teams: { BLUE: { heroes: [{ id: "hero_arien" }] } } },
    },
  };
}
function fixture() {
  const calls = [];
  const c = new Comparison({}, async (route, body) => {
    calls.push({ route, body });
    return situation(route.split("/").at(-1));
  });
  c.status = () => ({ windows: c.windows });
  c.open = async (config, presentation, clone, index, situation) => ({
    config,
    initialPresentation: presentation,
    situation,
    clone: { game_id: "new-" + index },
  });
  c.closeWindow = async (w) => calls.push({ closed: w.clone.game_id });
  return { c, calls };
}
test("each view resets to its own starting situation, including a temporary current-state checkpoint", async () => {
  const { c } = fixture();
  const first = {
    config,
    situation: situation("first"),
    initialPresentation: { pane: "hand" },
    clone: { game_id: "a" },
  };
  const second = {
    config,
    situation: { ...situation("second"), name: "Progress snapshot" },
    initialPresentation: { pane: "deck" },
    clone: { game_id: "b" },
  };
  c.windows = [first, second];
  await c.reset(1);
  assert.equal(c.windows[0], first);
  assert.equal(c.windows[1].situation, second.situation);
  assert.deepEqual(c.windows[1].initialPresentation, { pane: "deck" });
});
test("replacing a view opens its independent situation first and keeps the old game after failure", async () => {
  const { c, calls } = fixture();
  const old = {
    config,
    situation: situation("first"),
    clone: { game_id: "a" },
  };
  c.windows = [old];
  c.open = async () => {
    throw Error("Source unavailable");
  };
  await assert.rejects(
    c.addView({ config, situationId: "second", index: 0 }),
    /Source unavailable/,
  );
  assert.equal(c.windows[0], old);
  assert.ok(!calls.some((call) => call.closed));
});
test("saving a Situation composes Presentation while a Decision State save remains game-only", async () => {
  const { c, calls } = fixture();
  c.windows = [
    {
      config,
      situation: situation("first"),
      clone: { game_id: "a" },
      page: {
        evaluate: async () => ({
          pane: "hand",
          selectedCard: "card",
          storage: { "goa2:board-brightness": "0.8" },
        }),
      },
    },
  ];
  await c.save(0, "Decision");
  assert.deepEqual(calls, [
    {
      route: "/capture",
      body: {
        game_id: "a",
        name: "Decision",
        provenance: { kind: "capture", source_situation: "first" },
        kind: "situation",
        presentation: {
          schema: 2,
          viewpoint: config.seat,
          sessionState: { pane: "hand", selectedCard: "card" },
          userState: { "goa2:board-brightness": "0.8" },
        },
      },
    },
  ]);
  calls.length = 0;
  c.windows[0].page.evaluate = () => {
    throw Error("Game-only save must not inspect UI");
  };
  await c.save(0, "Checkpoint", "decision-state");
  assert.equal(calls[0].body.kind, "decision-state");
  assert.equal(calls[0].body.presentation, undefined);
});
