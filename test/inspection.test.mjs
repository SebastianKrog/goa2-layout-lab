import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectionOptions,
  presentationFor,
  reviewEntry,
} from "../src/inspection.mjs";
import { resolveView } from "../src/presentation-model.mjs";
import { PRESETS } from "../src/config.mjs";
const p = (pane) => ({ schema: 2, sessionState: { pane }, userState: {} });
test("independent inspection instructions resolve shared, interface and per-View state without leaking defaults", () => {
  const options = inspectionOptions({
    viewpoint: "hero_arien",
    presentation: p("hand"),
    presentationsByInterface: { desktop: p("board") },
    viewPresentations: {
      1: { schema: 2, sessionState: { selectedCard: "card" } },
    },
  });
  assert.equal(
    presentationFor(options, { uiMode: "desktop" }, 0).sessionState.pane,
    "board",
  );
  const mobile = presentationFor(options, { uiMode: "mobile" }, 1);
  assert.equal(mobile.sessionState.pane, "hand");
  assert.equal(mobile.sessionState.selectedCard, "card");
  assert.equal(
    presentationFor(options, { uiMode: "mobile" }, 2).sessionState.selectedCard,
    undefined,
  );
  assert.equal(presentationFor({}, {}).viewpoint, undefined);
  const config = {
    seat: "hero_arien",
    render: "2d",
    overrides: { viewpoint: "spectator" },
  };
  assert.equal(resolveView(config, {}, mobile).config.seat, "hero_arien");
  assert.equal(
    resolveView(config, { presentation: p("hand") }).presentation.pane,
    "board",
  );
  assert.throws(
    () => inspectionOptions({ viewPresentations: { 3: p("hand") } }),
    /target/,
  );
  assert.throws(
    () => inspectionOptions({ presentationsByInterface: { phone: p("hand") } }),
    /target/,
  );
});
test("Review entries own copied Presentation instructions and Situation identity independently", () => {
  const input = { situationId: "same", presentation: p("hand") };
  const one = reviewEntry(input),
    two = reviewEntry({ ...input, presentation: p("board") });
  assert.notEqual(one.id, two.id);
  assert.equal(one.kind, "review-entry");
  assert.equal(one.situationId, two.situationId);
  input.presentation.sessionState.pane = "deck";
  assert.equal(one.presentation.sessionState.pane, "hand");
  assert.throws(() => reviewEntry({ situationId: "../bad" }), /Situation/);
});
test("curated primary Layouts cover desktop source comparison, mobile and mixed interfaces", () => {
  assert.deepEqual(
    PRESETS["Desktop · Main vs working tree"].map((v) => v.source),
    ["main", "live"],
  );
  assert.equal(PRESETS["Mobile · Working tree"].length, 1);
  assert.equal(PRESETS["Mobile · Working tree"][0].uiMode, "mobile");
  assert.deepEqual(
    PRESETS["Desktop vs mobile · Working tree"].map((v) => v.uiMode),
    ["desktop", "mobile"],
  );
});
