import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Reports } from "../src/reports.mjs";
import { EvidenceState, evidenceTarget } from "../src/evidence-state.mjs";
import { Reviews } from "../src/reviews.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lab-reports-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = new EvidenceState(path.join(root, "_state.json"));
  return { root, state, reports: new Reports(root, state) };
}
async function save(root, id, value, file = "report.json") {
  const dir = path.join(root, ...id.split("/"));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), JSON.stringify(value));
  await fs.writeFile(path.join(dir, "index.html"), "Report");
  return dir;
}
function run(id, reviewId) {
  return {
    schema: 2,
    kind: "review-run",
    id,
    reviewId,
    reviewRevision: 1,
    name: "Card review",
    createdAt: "2026-10-22T10:00:00Z",
    active: false,
    index: 0,
    visited: [0],
    entries: [
      { entryId: "entry", situation: { id: "moment", name: "Choose a card" } },
    ],
    reports: [],
    layout: { views: [{}] },
  };
}
test("report index groups capture-time sessions and Reviews, normalizes device dates and skips drafts", async (t) => {
  const { root, state, reports } = await fixture(t),
    session = await state.startSession("Card layout");
  await save(root, "device/phone", {
    comment: "Phone issue",
    captured_at: 1792679959.026,
    provenance: { session, slots: [{ source: "live" }] },
  });
  const review = run("a".repeat(24), "b".repeat(24));
  review.reports = [
    {
      url: `/reports/reviews/${review.id}/reports/element-test/index.html`,
      index: 0,
      kind: "element",
      situationId: "moment",
    },
  ];
  await save(root, `reviews/${review.id}/reports/element-test`, {
    comment: "Review issue",
    capturedAt: "2026-10-22T11:00:00Z",
    views: [
      { index: 0, config: { source: "live" }, revision: { commit: "abc" } },
    ],
  });
  await save(root, ".pending-element-hidden", { comment: "Unsent" });
  const partial = await save(root, "element-partial", {
    comment: "Incomplete",
  });
  await fs.unlink(path.join(partial, "index.html"));
  const css = await save(root, "source-big", {}, "comparison.json");
  await fs.writeFile(path.join(css, "comparison.json"), "x".repeat(300000));
  await fs.writeFile(
    path.join(css, "_report-index.json"),
    JSON.stringify({ session, capturedAt: "2026-10-22T12:00:00Z" }),
  );
  await state.startSession("Other work");
  const result = await reports.list([review]);
  assert.equal(result.reports.length, 3);
  assert.deepEqual(result.warnings, []);
  const phone = result.reports.find((report) => report.kind === "device");
  assert.equal(phone.createdAt, new Date(1792679959.026 * 1000).toISOString());
  assert.equal(phone.context.id, session.id);
  assert.equal(phone.views.length, 1);
  const element = result.reports.find((report) => report.kind === "element");
  assert.equal(element.context.id, review.id);
  assert.equal(element.situationName, "Choose a card");
  assert.equal(element.views[0].revision, "abc");
  assert.equal(
    result.reports.find((report) => report.kind === "html-css").context.id,
    session.id,
  );
});
test("report archives persist, restore, and delete only complete selected evidence", async (t) => {
  const { root, state, reports } = await fixture(t);
  await save(root, "device/a", { comment: "A" });
  await save(root, "element-b", { comment: "B" });
  await reports.manage({ action: "archive", id: "device/a" }, []);
  assert.equal(
    (
      await new Reports(root, new EvidenceState(state.file)).list()
    ).reports.find((report) => report.id === "device/a").archived,
    true,
  );
  await reports.manage({ action: "restore", id: "device/a" }, []);
  assert.ok((await reports.list()).reports.every((report) => !report.archived));
  await reports.manage({ action: "archive-all" }, []);
  await reports.manage({ action: "restore", id: "element-b" }, []);
  await reports.manage({ action: "delete-archive" }, []);
  assert.deepEqual(
    (await reports.list()).reports.map((report) => report.id),
    ["element-b"],
  );
  await assert.rejects(
    reports.manage({ action: "delete", id: "../outside" }, []),
  );
  await assert.rejects(evidenceTarget(root, "../outside"));
  const other = await fs.mkdtemp(path.join(os.tmpdir(), "lab-report-outside-"));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  await fs.symlink(
    other,
    path.join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(evidenceTarget(root, "linked"));
});
test("deleting a Review report updates counts; deleting archived Reviews removes Runs and definitions", async (t) => {
  const { root, state, reports } = await fixture(t),
    reviewRoot = path.join(root, "reviews"),
    reviews = new Reviews({}, {}, { root: reviewRoot });
  const first = run("a".repeat(24), "b".repeat(24)),
    second = run("c".repeat(24), "d".repeat(24));
  const reportId = `reviews/${first.id}/reports/device/report1`,
    url = `/reports/${reportId}/index.html`;
  first.reports = [{ url, index: 0, kind: "device" }];
  for (const value of [first, second]) {
    await fs.mkdir(path.join(reviewRoot, value.id), { recursive: true });
    await fs.writeFile(
      path.join(reviewRoot, value.id, "review.json"),
      JSON.stringify(value),
    );
    await fs.mkdir(path.join(reviewRoot, "_definitions", value.reviewId), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(reviewRoot, "_definitions", value.reviewId, "1.json"),
      "{}",
    );
  }
  await save(root, reportId, { comment: "Device" });
  await reports.manage(
    { action: "delete", id: reportId },
    [first, second],
    reviews,
  );
  assert.equal((await reviews.saved(first.id)).reports.length, 0);
  await reviews.manage({ action: "archive", id: first.reviewId }, state);
  await reviews.manage({ action: "delete-archive" }, state);
  assert.deepEqual(
    (await reviews.list()).reviews.map((group) => group.id),
    [second.reviewId],
  );
  await assert.rejects(
    fs.stat(path.join(reviewRoot, "_definitions", first.reviewId)),
  );
  second.active = true;
  reviews.current = second;
  await assert.rejects(
    reviews.manage({ action: "delete", id: second.reviewId }, state),
    /End the active/,
  );
  await reviews.manage({ action: "archive-all" }, state);
  assert.deepEqual((await state.read()).archivedReviews, []);
});
