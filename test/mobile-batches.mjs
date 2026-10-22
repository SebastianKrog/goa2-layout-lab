// Owned browser regression; never replaces another desk session.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
for (const [k, p] of Object.entries({
  DESK: 5910,
  BASE: 5911,
  COMPARATOR: 5912,
  LIVE: 5913,
  BACKEND: 10910,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(p);
process.env.NODE_ENV = "production";
process.env.WSLENV = [process.env.WSLENV, "NODE_ENV"].filter(Boolean).join(":");
const { startDesk } = await import("../desk.mjs");
const { DATA } = await import("../config.mjs");
let desk;
const report = [];
const root = DATA + "/runtime/mobile-batches-" + Date.now();
await fs.mkdir(root, { recursive: true });
async function hitTarget(page, button) {
  return button.evaluate((button) => {
    const r = button.getBoundingClientRect();
    const nav = document
      .querySelector('nav[aria-label="Game views"]')
      ?.getBoundingClientRect();
    return {
      rect: r.toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      nav: nav?.toJSON(),
      hits: [
        [0.5, 0.5],
        [0.15, 0.15],
        [0.85, 0.15],
        [0.15, 0.85],
        [0.85, 0.85],
      ].map(([x, y]) => {
        const h = document.elementFromPoint(
          r.x + r.width * x,
          r.y + r.height * y,
        );
        return h === button || button.contains(h);
      }),
    };
  });
}
try {
  desk = await startDesk({
    flags: new Set([
      "--headless",
      "--verification",
      "--no-open",
      "--no-auto-load",
    ]),
  });
  const c = desk.comparison;
  for (const [key, id, seat] of [
    ["upgrades", "3fd1f952c1a6", "hero_arien"],
    ["runes", "0601f17bbdab", "hero_snorri"],
  ])
    for (const profile of process.argv.includes("--recovery-only")
      ? []
      : (process.argv
          .find((a) => a.startsWith("--profile="))
          ?.slice(10)
          .split(",") ?? ["portrait", "compact", "landscape"])) {
      console.log("M6 LOAD", key, profile);
      const s = await c.api("/situations/" + id, undefined, "GET");
      await c.load(
        id,
        [
          { source: "live", uiMode: "mobile" },
          { source: "target", uiMode: "desktop" },
        ].map((w) => ({ ...w, profile, render: "2d", seat })),
        {},
        s,
      );
      const w = c.windows[0],
        page = w.page;
      const inspect = () =>
        c.api("/games/" + w.clone.game_id, undefined, "GET");
      const before = (await inspect()).hash;
      await page.evaluate(() => {
        window.__M6_SENT__ = [];
        for (const socket of window.__GOA2_LAB_SYNC__.sockets) {
          const send = socket.send.bind(socket);
          socket.send = (data) => {
            const m = JSON.parse(data);
            if (m.type === "SUBMIT_INPUT") window.__M6_SENT__.push(m);
            return send(data);
          };
        }
      });
      const camera = await page.evaluate(() =>
        window.__GOA2_LAB_BRIDGE__.camera2d.get(),
      );
      let ids;
      if (key === "upgrades") {
        await page
          .getByRole("button", { name: /^Choose / })
          .first()
          .waitFor();
        await page
          .getByRole("button", { name: /^Choose / })
          .first()
          .tap();
        await page
          .getByRole("button", { name: /^Choose / })
          .first()
          .waitFor();
        await page.getByRole("button", { name: "Board", exact: true }).tap();
        await page
          .getByRole("button", { name: "Return to upgrades", exact: true })
          .tap();
        assert.equal(await page.locator("[data-staged-upgrade]").count(), 1);
        await page.getByRole("switch", { name: "Preview", exact: true }).tap();
        await page
          .getByRole("button", { name: /^Plan / })
          .last()
          .tap();
        assert.equal(
          await page
            .getByRole("button", { name: "Commit 3 upgrades", exact: true })
            .isEnabled(),
          false,
        );
        await page.screenshot({
          path: `${root}/${key}-${profile}-preview.png`,
          animations: "disabled",
        });
        await page.getByRole("switch", { name: "Preview", exact: true }).tap();
        await page.getByRole("button", { name: "Reset", exact: true }).tap();
        for (let i = 0; i < 3; i++) {
          await page
            .getByRole("button", { name: /^Choose / })
            .first()
            .tap();
          if (i < 2)
            await page
              .getByRole("button", { name: /^Choose / })
              .first()
              .waitFor();
        }
        ids = await page
          .locator("[data-staged-upgrade]")
          .evaluateAll((nodes) => nodes.map((n) => n.dataset.stagedUpgrade));
        assert.equal(ids.length, 3);
      } else {
        for (const rune of ["bird", "axe"])
          await page
            .getByRole("button", { name: "Choose " + rune, exact: true })
            .tap();
        await page.getByRole("button", { name: "Board", exact: true }).tap();
        await page
          .getByRole("button", { name: "Return to runes", exact: true })
          .tap();
        assert.equal(
          await page
            .locator('[aria-label="Rune arrangement"] [data-state="planned"]')
            .count(),
          2,
        );
        await page
          .getByRole("button", { name: "Choose horn", exact: true })
          .tap();
        ids = ["bird", "axe", "horn"];
        assert.equal(
          await page
            .locator('[aria-label="Rune arrangement"] [data-state="automatic"]')
            .count(),
          1,
        );
      }
      const commit = page.getByRole("button", {
        name: key === "upgrades" ? "Commit 3 upgrades" : "Commit runes",
        exact: true,
      });
      await commit.waitFor();
      await commit.tap({ trial: true });
      assert.equal(await commit.isEnabled(), true);
      assert.equal(
        (await inspect()).hash,
        before,
        "staging/preview changed authoritative state",
      );
      assert.deepEqual(
        await page.evaluate(() => window.__GOA2_LAB_BRIDGE__.camera2d.get()),
        camera,
        "Board peek changed camera",
      );
      const targets = [];
      for (const end of [false, true]) {
        await page
          .locator(
            '[data-mobile-upgrade-picker] > div[class*="scroll"], [data-mobile-rune-batch] > div[class*="scroll"]',
          )
          .evaluate((node, end) => {
            node.scrollTop = end ? node.scrollHeight : 0;
          }, end);
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        const t = await hitTarget(page, commit);
        targets.push(t);
        assert.ok(t.hits.every(Boolean), "Commit blocked " + JSON.stringify(t));
        assert.ok(
          t.rect.height >= 44 &&
            t.rect.bottom <= t.viewport.height &&
            t.rect.top >= 0,
          "Commit bounds " + JSON.stringify(t),
        );
        if (t.nav)
          assert.ok(
            t.rect.bottom <= t.nav.top || t.rect.right <= t.nav.left,
            "Commit overlaps navigation",
          );
      }
      await page.screenshot({
        path: `${root}/${key}-${profile}-staged.png`,
        animations: "disabled",
      });
      await c.windows[1].page.screenshot({
        path: `${root}/${key}-${profile}-target.png`,
        animations: "disabled",
      });
      await commit.tap();
      await page.waitForFunction(() => window.__M6_SENT__.length === 1);
      await page.waitForFunction(
        (key) =>
          key === "upgrades"
            ? !document.querySelector("[data-mobile-upgrade-picker]")
            : !document.querySelector("[data-mobile-rune-batch]"),
        key,
      );
      const sent = await page.evaluate(() => window.__M6_SENT__);
      assert.equal(sent.length, 1);
      assert.ok(sent[0].request_id);
      assert.deepEqual(
        key === "upgrades" ? sent[0].selection.card_ids : sent[0].selection,
        ids,
      );
      assert.notEqual((await inspect()).hash, before, "Commit not accepted");
      assert.deepEqual(w.errors, []);
      assert.deepEqual(w.warnings, []);
      report.push({
        key,
        profile,
        situation: id,
        selection: ids,
        targets,
        errors: w.errors,
        warnings: w.warnings,
      });
      await fs.writeFile(
        `${root}/report.json`,
        JSON.stringify(
          {
            runtime: c.status().runtime,
            source: "live working tree",
            references: c.services.references,
            report,
          },
          null,
          2,
        ),
      );
      console.log("M6 PASS", key, profile);
    }
  // Real mid-inscription reload, Undo and reconnect. Legacy single submissions
  // create acknowledged progress; local batch staging must never masquerade as it.
  await c.load("0601f17bbdab", [
    {
      source: "live",
      uiMode: "mobile",
      profile: "portrait",
      render: "2d",
      seat: "hero_snorri",
    },
    {
      source: "target",
      uiMode: "desktop",
      profile: "portrait",
      render: "2d",
      seat: "hero_snorri",
    },
  ]);
  const w = c.windows[0],
    page = w.page;
  const inspect = () => c.api("/games/" + w.clone.game_id, undefined, "GET");
  await page.evaluate(() => {
    const socket = [...window.__GOA2_LAB_SYNC__.sockets].find(
      (s) => s.readyState === 1,
    );
    socket.send(
      JSON.stringify({
        type: "SUBMIT_INPUT",
        request_id: window.__GOA2_LAB_STATE__.input_request.request_id,
        selection: "axe",
      }),
    );
  });
  await page.waitForFunction(
    () => window.__GOA2_LAB_STATE__.input_request?.next_slot === 2,
  );
  await page.getByRole("button", { name: "Choose bird", exact: true }).tap();
  await page.reload({ waitUntil: "domcontentloaded" });
  await c.ready(w);
  await page.locator('[data-state="acknowledged"]').waitFor();
  assert.match(
    await page.locator('[data-state="acknowledged"]').innerText(),
    /Axe/,
  );
  assert.equal(
    await page.locator('[data-state="planned"]').count(),
    0,
    "reload clears unsent draft",
  );
  await page.getByRole("button", { name: "Board", exact: true }).tap();
  await page
    .getByRole("button", { name: "Return to runes", exact: true })
    .tap();
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await page.waitForFunction(
    () =>
      window.__GOA2_LAB_STATE__.input_request?.type === "CHOOSE_ACTION" ||
      window.__GOA2_LAB_STATE__.input_request?.next_slot === 1,
  );
  if (
    await page.evaluate(
      () => window.__GOA2_LAB_STATE__.input_request?.type === "CHOOSE_ACTION",
    )
  ) {
    const label = await page.evaluate(
      () =>
        window.__GOA2_LAB_STATE__.input_request.options.find(
          (o) => o.id === "SKILL",
        ).text,
    );
    await page
      .getByRole("region", { name: "Game decision" })
      .getByRole("button", { name: label, exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Confirm choice", exact: true })
      .tap();
  }
  await page.waitForFunction(
    () => window.__GOA2_LAB_STATE__.input_request?.next_slot === 1,
  );
  assert.equal(
    await page
      .locator('[data-state="acknowledged"], [data-state="planned"]')
      .count(),
    0,
  );
  for (const rune of ["bird", "axe", "horn"])
    await page
      .getByRole("button", { name: "Choose " + rune, exact: true })
      .tap();
  const beforeReconnect = (await inspect()).hash;
  await page.evaluate(() => {
    window.__M6_OLD_SOCKETS__ = [...window.__GOA2_LAB_SYNC__.sockets];
    for (const socket of window.__M6_OLD_SOCKETS__)
      if (socket.readyState === 1) socket.close();
  });
  await page.waitForFunction(() =>
    [...window.__GOA2_LAB_SYNC__.sockets].some(
      (s) => !window.__M6_OLD_SOCKETS__.includes(s) && s.readyState === 1,
    ),
  );
  await page
    .getByRole("button", { name: "Commit runes", exact: true })
    .tap({ trial: true });
  assert.equal(await page.locator('[data-state="planned"]').count(), 3);
  assert.equal(
    (await inspect()).hash,
    beforeReconnect,
    "reconnect must not replay a staged batch",
  );
  await page.getByRole("button", { name: "Commit runes", exact: true }).tap();
  await page.getByLabel("Runes placed", { exact: true }).waitFor();
  assert.notEqual((await inspect()).hash, beforeReconnect);
  await page.screenshot({
    path: root + "/runes-recovery.png",
    animations: "disabled",
  });
  assert.deepEqual(w.errors, []);
  report.push({
    key: "rune-recovery",
    reload: true,
    undo: true,
    reconnect: true,
    noAutomaticReplay: true,
  });
  await fs.writeFile(
    root + "/report.json",
    JSON.stringify(
      {
        runtime: c.status().runtime,
        source: "live working tree",
        references: c.services.references,
        report,
      },
      null,
      2,
    ),
  );
  console.log("M6 PASS rune reload, Undo, reconnect and explicit retry");
  console.log("Evidence:", root);
} finally {
  await desk?.close();
}
