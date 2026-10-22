import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Reviews } from "../reviews.mjs";
const config = {
  source: "live",
  profile: "portrait",
  render: "2d",
  layout: "mobile",
  seat: "hero_arien",
};
const situation = (id, seat, pane) => ({
  id,
  name: id,
  checkpoint: { state: { teams: { RED: { heroes: [{ id: seat }] } } } },
  provenance: { slots: [{ ...config, seat }] },
  presentations: { 0: { render: "2d", pane } },
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "goa2-reviews-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const moments = {
    first: situation("first", "hero_arien", "heroes"),
    second: situation("second", "hero_snorri", "hand"),
    third: situation("third", "hero_arien", "deck"),
  };
  const events = [];
  let fail = false,
    blocked = false;
  const c = {
    windows: [
      { id: "old-a", config },
      { id: "old-b", config: { ...config, source: "comparator" } },
    ],
    sync: { setMode: async (mode) => events.push(["sync", mode]) },
    api: async (route, body) => {
      let s;
      if (body?.from) {
        const old = JSON.parse(
          await fs.readFile(
            path.join(
              root,
              body.from.reviewId,
              "situations",
              String(body.from.index).padStart(3, "0") + ".json",
            ),
            "utf8",
          ),
        );
        assert.equal(old.id, body.id);
        s = old;
      } else s = moments[body?.id || route.split("/").pop()];
      if (!s) throw Error("missing");
      const result = structuredClone(s);
      if (route === "/review/snapshot") {
        const folder = path.join(root, body.reviewId, "situations");
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(
          path.join(folder, String(body.index).padStart(3, "0") + ".json"),
          JSON.stringify(result),
        );
        result.review_snapshot = { reviewId: body.reviewId, index: body.index };
      }
      return result;
    },
    open: async (config, p, clone, i, s) => {
      events.push(["open", s.id, i]);
      if (fail && i === 1) throw Error("build unavailable");
      return { id: `${s.id}-${i}`, config, presentation: p };
    },
    closeWindow: async (w) => events.push(["close", w.id]),
  };
  const devices = {
    prepareReview: async (s, plan, id) => {
      events.push(["device-prepare", s.id]);
      return [
        {
          clone: { game_id: "new-device" },
          oldClone: { game_id: "old-device" },
          config: plan(config).config,
        },
      ];
    },
    commitReview: (p) => events.push(["device-commit", p[0].config.seat]),
    retireReview: async () => events.push(["device-retire"]),
  };
  const r = new Reviews(c, devices, {
    root,
    guard: () => {
      if (blocked) throw Error("draft pending");
    },
  });
  return {
    r,
    c,
    root,
    moments,
    events,
    fail: () => (fail = true),
    block: (value) => (blocked = value),
  };
}
test("review restores every view, keeps sources, groups evidence by captured step, and rejects stale navigation", async (t) => {
  const { r, c, root, moments, events, block } = await fixture(t);
  const before = JSON.stringify(moments);
  await assert.rejects(() => r.start({ ids: [] }), /Select/);
  await assert.rejects(() => r.start({ ids: ["first", "first"] }), /different/);
  await assert.rejects(() => r.start({ ids: ["missing"] }), /missing/);
  assert.equal(c.windows[0].id, "old-a");
  const status = await r.start({
    ids: ["first", "second"],
    name: "Review <script>alert(1)</script>",
  });
  assert.equal(status.total, 2);
  assert.equal(status.previous, false);
  assert.equal(status.next, true);
  assert.deepEqual(
    c.windows.map((w) => w.config.source),
    ["live", "comparator"],
  );
  assert.ok(
    c.windows.every(
      (w) => w.config.seat === "hero_arien" && w.presentation.pane === "heroes",
    ),
  );
  assert.ok(
    events.findIndex((e) => e[0] === "device-prepare") <
      events.findIndex((e) => e[0] === "close"),
  );
  const context = r.reportContext();
  block(true);
  await assert.rejects(
    () => r.step({ id: status.id, index: 0, direction: 1 }),
    /draft pending/,
  );
  block(false);
  await r.step({ id: status.id, index: 0, direction: 1 });
  assert.ok(
    c.windows.every(
      (w) => w.config.seat === "hero_snorri" && w.presentation.pane === "hand",
    ),
  );
  assert.equal(r.status().next, false);
  await assert.rejects(
    () => r.step({ id: status.id, index: 0, direction: 1 }),
    /already moved/,
  );
  await assert.rejects(
    () => r.step({ id: status.id, index: 1, direction: 1 }),
    /No more/,
  );
  const report = {
    url: `/reports/${context.prefix}/element-test/index.html`,
    kind: "element",
    label: "Comment <img src=x onerror=alert(1)>",
  };
  await r.record(context, report);
  await r.record(context, report);
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, status.id, "review.json"), "utf8"),
  );
  assert.equal(manifest.reports.length, 1);
  assert.equal(manifest.reports[0].index, 0);
  assert.equal(manifest.reports[0].situationId, "first");
  assert.match(
    await fs.readFile(path.join(root, status.id, "index.html"), "utf8"),
    /&lt;script&gt;/,
  );
  await assert.rejects(
    () => r.record(context, { url: "/reports/outside/index.html" }),
    /outside/,
  );
  await r.step({ id: status.id, index: 1, direction: -1 });
  assert.equal(r.status().index, 0);
  await r.end();
  assert.equal(r.status().active, false);
  assert.equal(r.reportContext(), null);
  assert.equal(JSON.stringify(moments), before);
});
test("failed replacement leaves old views and queue position intact and closes only staged views", async (t) => {
  const f = await fixture(t);
  const status = await f.r.start({ ids: ["first", "second"] });
  const old = [...f.c.windows];
  f.events.length = 0;
  f.fail();
  await assert.rejects(
    () => f.r.step({ id: status.id, index: 0, direction: 1 }),
    /build unavailable/,
  );
  assert.equal(f.r.status().index, 0);
  assert.deepEqual(f.c.windows, old);
  assert.equal(f.r.loading, false);
  assert.deepEqual(
    f.events.filter((e) => e[0] === "close"),
    [["close", "second-0"]],
  );
});

test("past reviews survive restart, rerun original snapshots, and edited runs leave earlier evidence untouched", async (t) => {
  const f = await fixture(t);
  const original = await f.r.start({
    ids: ["first", "second"],
    name: "Original review",
  });
  await f.r.step({ id: original.id, index: 0, direction: 1 });
  await f.r.record(f.r.context(), {
    url: `/reports/reviews/${original.id}/reports/example/index.html`,
    kind: "element",
    label: "Original report",
  });
  await f.r.end();
  const file = path.join(f.root, original.id, "review.json"),
    bytes = await fs.readFile(file, "utf8");
  const restarted = new Reviews(f.c, f.r.devices, { root: f.root });
  const list = await restarted.list();
  assert.equal(list.reviews.length, 1);
  assert.equal(list.reviews[0].visited, 2);
  assert.equal(list.reviews[0].reports, 1);
  assert.equal(list.reviews[0].reportedSituations, 1);
  assert.equal(list.reviews[0].status, "ended");
  delete f.moments.first;
  delete f.moments.second;
  const rerun = await restarted.rerun({ id: original.id });
  assert.notEqual(rerun.id, original.id);
  assert.equal(rerun.total, 2);
  assert.equal(restarted.current.parentReviewId, original.id);
  assert.equal(restarted.current.reports.length, 0);
  assert.equal(restarted.current.entries[0].situation.name, "first");
  await assert.rejects(
    () => restarted.rerun({ id: original.id }),
    /End the current/,
  );
  await restarted.end();
  const edited = await restarted.rerun({
    id: original.id,
    name: "Edited run",
    entries: [{ fromIndex: 1 }, { situationId: "third" }],
  });
  assert.equal(edited.total, 2);
  assert.equal(edited.name, "Edited run");
  assert.deepEqual(
    restarted.current.entries.map((e) => e.situation.id),
    ["second", "third"],
  );
  assert.equal(await fs.readFile(file, "utf8"), bytes);
  await restarted.end();
  for (const entries of [
    [],
    [{ fromIndex: -1 }],
    [{ fromIndex: 9 }],
    [{ fromIndex: 0 }, { fromIndex: 0 }],
    [{ fromIndex: 0, situationId: "third" }],
  ])
    await assert.rejects(() => restarted.rerun({ id: original.id, entries }));
  await assert.rejects(() => restarted.detail("../escape"), /Invalid review/);
  assert.equal((await restarted.list()).reviews.length, 3);
  const details = await restarted.detail(original.id);
  assert.deepEqual(
    details.entries.map((e) => e.name),
    ["first", "second"],
  );
  assert.equal(details.entries[0].checkpoint, undefined);
});
test("interrupted and malformed reviews are listed honestly without restoring active sessions", async (t) => {
  const f = await fixture(t);
  const r = await f.r.start({ ids: ["first"] });
  const bad = path.join(f.root, "c".repeat(24));
  await fs.mkdir(bad);
  await fs.writeFile(path.join(bad, "review.json"), "{bad");
  const restarted = new Reviews(f.c, f.r.devices, { root: f.root });
  const list = await restarted.list();
  assert.equal(list.reviews.length, 1);
  assert.equal(list.reviews[0].status, "interrupted");
  assert.equal(list.warnings.length, 1);
  assert.equal(restarted.current, null);
});
