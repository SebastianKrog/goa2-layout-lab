// Owns and closes its desk; set distinct GOA2_LAB_*_PORT values.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startDesk } from "../desk.mjs";
import { DATA, PORTS } from "../config.mjs";
const app = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const c = app.comparison,
  origin = `http://127.0.0.1:${PORTS.desk}`,
  out = path.join(DATA, "reviews", "review-history");
await fs.mkdir(out, { recursive: true });
async function api(name, body) {
  const r = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  assert.ok(r.ok, JSON.stringify(v));
  return v;
}
async function until(fn, message = "History condition") {
  for (let n = 0; n < 600; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(message);
}
try {
  const moments = await c.api("/situations", undefined, "GET"),
    entries = [];
  for (const [id, seat, pane] of [
    ["a00000000001", "hero_arien", "heroes"],
    ["09fa8b1ac243", "hero_snorri", "hand"],
    ["a00000000001", "hero_arien", "heroes"],
  ]) {
    const s = structuredClone(moments.find((s) => s.id === id));
    s.provenance = {
      slots: [
        {
          source: "live",
          profile: "portrait",
          render: "2d",
          layout: "mobile",
          seat,
        },
      ],
    };
    s.presentations = { 0: { render: "2d", pane } };
    entries.push(
      await api("import", {
        content: s,
        name: `QA history case ${entries.length + 1} ${Date.now()}`,
      }),
    );
  }
  const slots = [0, 1].map(() => ({
    source: "live",
    profile: "portrait",
    render: "2d",
    layout: "mobile",
    seat: "hero_arien",
  }));
  const original = await api("review/start", {
    ids: entries.slice(0, 2).map((s) => s.id),
    name: "QA saved history " + Date.now(),
    slots,
  });
  await api("capture", { indexes: [0, 1] });
  await api("review/end", {});
  const originalFile = path.join(
    DATA,
    "reports",
    "reviews",
    original.id,
    "review.json",
  );
  const originalBytes = await fs.readFile(originalFile, "utf8");
  const desk = await c.browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  desk.on("pageerror", (e) => errors.push(e.message));
  await desk.goto(origin);
  await desk.locator("[data-page=reviews]").click();
  const card = desk.locator(`[data-review-id="${original.id}"]`);
  await card.waitFor();
  assert.match(
    await card.locator(".review-history-stats").textContent(),
    /2 situations.*1 visited.*1 report/,
  );
  await desk.screenshot({ path: path.join(out, "history.png") });
  await card.getByRole("button", { name: "Run again", exact: true }).click();
  await until(async () => {
    const s = await api("status");
    return !s.busy && s.review?.active && s.review.id !== original.id;
  });
  const rerun = app.reviews.current;
  assert.equal(rerun.parentReviewId, original.id);
  assert.equal(rerun.reports.length, 0);
  assert.deepEqual(
    rerun.entries.map((e) => e.situation.id),
    entries.slice(0, 2).map((e) => e.id),
  );
  assert.equal(await fs.readFile(originalFile, "utf8"), originalBytes);
  await api("review/end", {});
  await desk.locator("[data-page=reviews]").click();
  await until(() =>
    card.getByRole("button", { name: "Edit and run", exact: true }).isEnabled(),
  );
  const count = (await api("reviews")).reviews.length;
  await card.getByRole("button", { name: "Edit and run", exact: true }).click();
  await desk.locator("#reviewEditDialog[open]").waitFor();
  await desk.locator('#reviewEditKept input[data-review-entry="0"]').uncheck();
  await desk.locator("#reviewEditSearch").fill(entries[2].name);
  await desk
    .locator(
      `#reviewEditAvailable input[data-add-situation="${entries[2].id}"]`,
    )
    .check();
  await desk.locator("[data-close=reviewEditDialog]").click();
  assert.equal((await api("reviews")).reviews.length, count);
  await card.getByRole("button", { name: "Edit and run", exact: true }).click();
  await desk.locator("#reviewEditDialog[open]").waitFor();
  assert.equal(await desk.locator("#reviewEditKept input:checked").count(), 2);
  await desk.locator("#reviewEditKeepAll").uncheck();
  assert.equal(await desk.locator("#reviewEditSubmit").isDisabled(), true);
  await desk.locator('#reviewEditKept input[data-review-entry="1"]').check();
  await desk.locator("#reviewEditSearch").fill(entries[2].name);
  await desk
    .locator(
      `#reviewEditAvailable input[data-add-situation="${entries[2].id}"]`,
    )
    .check();
  await desk.locator("#reviewEditName").fill("QA edited history");
  assert.match(
    await desk.locator("#reviewEditCount").textContent(),
    /1 kept.*1 added.*2 situations/,
  );
  await desk.screenshot({ path: path.join(out, "edit.png") });
  await desk.locator("#reviewEditSubmit").click();
  await until(async () => {
    const s = await api("status");
    return !s.busy && s.review?.active && s.review.name === "QA edited history";
  });
  const edited = app.reviews.current;
  assert.equal(edited.parentReviewId, original.id);
  assert.deepEqual(
    edited.entries.map((e) => e.situation.id),
    [entries[1].id, entries[2].id],
  );
  assert.ok(c.windows.every((w) => w.config.seat === "hero_snorri"));
  for (const w of c.windows)
    assert.equal(
      await w.page.locator("[data-pane=hand][aria-pressed=true]").count(),
      1,
    );
  await api("review/step", { id: edited.id, index: 0, direction: 1 });
  assert.ok(c.windows.every((w) => w.config.seat === "hero_arien"));
  await api("review/end", {});
  assert.equal(await fs.readFile(originalFile, "utf8"), originalBytes);
  const history = (await api("reviews")).reviews;
  assert.ok(history.some((r) => r.id === edited.id && r.visited === 2));
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        original: original.id,
        rerun: rerun.id,
        edited: edited.id,
        entries: edited.entries.map((e) => e.situation.id),
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Review history acceptance passed:", out);
} finally {
  await app.close();
}
