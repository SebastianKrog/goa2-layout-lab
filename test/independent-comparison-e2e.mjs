// Owns an isolated desk. Run with distinct GOA2_LAB_*_PORT values.
import assert from "node:assert/strict";
import path from "node:path";
import { startDesk } from "../src/desk.mjs";
import { PORTS, DATA } from "../src/config.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--no-open", "--headless"]),
});
const origin = `http://127.0.0.1:${PORTS.desk}`;
async function api(route, body) {
  const r = await fetch(
    origin + "/api/" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const v = await r.json();
  assert.ok(r.ok, JSON.stringify(v));
  return v;
}
try {
  const catalog = await api("catalog");
  const situation = catalog.situations.find((s) => s.id === "e81bc3bd5fff");
  assert.ok(situation);
  assert.equal(situation.schema, 3);
  assert.equal(situation.presentation, undefined);
  const layout = catalog.layouts.find(
    (l) => l.name === "Desktop vs mobile · Working tree",
  );
  console.log("Loading mixed desktop/mobile Layout with Hand intent");
  await api("load", {
    situationId: situation.id,
    layoutId: layout.id,
    viewpoint: "hero_arien",
    presentation: {
      schema: 2,
      sessionState: { pane: "hand" },
      userState: {},
    },
  });
  assert.equal(app.comparison.windows.length, 2);
  for (const w of app.comparison.windows) {
    assert.equal(w.intendedPresentation.sessionState.pane, "hand");
    assert.equal(w.errors.length, 0);
    assert.equal(w.config.seat, "hero_arien");
  }
  assert.equal(
    await app.comparison.windows[1].page
      .locator('[data-pane="hand"][aria-pressed="true"]')
      .count(),
    1,
  );
  console.log(
    "Reloading the same Situation with default Presentation while retaining Views",
  );
  await api("load", { situationId: situation.id });
  assert.deepEqual(
    app.comparison.windows.map((w) => w.config.uiMode),
    ["desktop", "mobile"],
  );
  assert.equal(
    app.comparison.windows[1].intendedPresentation.sessionState.pane,
    "board",
  );
  console.log(
    "PASS: real frontend mixed Layout, independent Hand instructions and clean default reload",
  );
  console.log("Loading Main vs working tree with the same Situation");
  const main = catalog.layouts.find(
    (l) => l.name === "Desktop · Main vs working tree",
  );
  await api("load", { situationId: situation.id, layoutId: main.id });
  assert.deepEqual(
    app.comparison.windows.map((w) => w.config.source),
    ["main", "live"],
  );
  assert.equal(app.comparison.windows[0].errors.length, 0);
  assert.ok((await app.services.provenance()).frontend.main.commit);
  console.log(
    "PASS: Main source resolves and runs independently alongside live working tree",
  );
  const desk = await app.comparison.browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await desk.goto(origin);
  await desk.waitForFunction(
    () =>
      [...document.querySelectorAll(".live-stage canvas")].filter(
        (c) => Number(c.dataset.frames) > 0,
      ).length === 2,
  );
  await desk.screenshot({
    path: path.join(DATA, "independent-live-desktop.png"),
  });
} finally {
  await app.close();
}
