// Owns a headless verification desk; never attaches to the user's live games.
import assert from "node:assert/strict";
import path from "node:path";

// Separate defaults keep the normal launcher usable while this test runs.
for (const [key, port] of Object.entries({
  DESK: 3500,
  BASE: 3501,
  COMPARATOR: 3502,
  LIVE: 3503,
  BACKEND: 8500,
}))
  process.env[`GOA2_LAB_${key}_PORT`] ??= String(port);

const { startDesk } = await import("../desk.mjs");
const { DATA, PROFILES } = await import("../config.mjs");
const { waitFor } = await import("../services.mjs");
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--no-auto-load",
    "--headless",
    "--no-open",
  ]),
});
const comparison = desk.comparison;
try {
  const situations = await comparison.api("/situations", undefined, "GET");
  const situation = situations.find(
    (s) =>
      s.origin === "library" &&
      s.provenance?.fixture?.case === "upgrade-tier-2",
  );
  assert.ok(situation, "Shared tier-II upgrade situation is required");
  for (const profile of ["portrait", "compact", "landscape"]) {
    // Same working tree, checkpoint and seat in both shells. The second view
    // protects the existing desktop picker while the first exercises mobile.
    await comparison.load(
      situation.id,
      ["mobile", "desktop"].map((layout) => ({
        source: "live",
        profile,
        render: "2d",
        layout,
        seat: "hero_arien",
      })),
    );
    for (const win of comparison.windows) {
      const { page, config, clone } = win;
      const label = `${config.layout} / ${profile}`;
      const inspect = () =>
        comparison.api(`/games/${clone.game_id}`, undefined, "GET");
      const before = (await inspect()).hash;
      const submissions = [];
      // Observe actual transport traffic; no synthetic click or forced input.
      // The lab records the already-open game sockets for synchronization.
      await page.evaluate(() => {
        window.__CONFIRM_SUBMISSIONS__ = [];
        for (const socket of window.__GOA2_LAB_SYNC__.sockets) {
          const original = socket.send.bind(socket);
          socket.send = (data) => {
            const message = JSON.parse(data);
            if (message.type === "SUBMIT_INPUT")
              window.__CONFIRM_SUBMISSIONS__.push(message);
            return original(data);
          };
        }
      });
      const batch =
        (await page.locator("[data-mobile-upgrade-picker]").count()) > 0;
      const confirm = page.getByRole("button", {
        name: batch ? /^Commit 1 upgrades?$/ : "Confirm",
        exact: !batch,
      });
      assert.equal(
        await confirm.isEnabled(),
        false,
        `${label}: stage a card first`,
      );
      await page
        .getByRole("button", {
          name: batch ? /^Choose Expert Duelist$/ : /Expert Duelist/,
        })
        .tap();
      await confirm.tap({ trial: true });
      assert.equal(
        await confirm.isEnabled(),
        true,
        `${label}: selection enables Confirm`,
      );
      assert.equal(
        (await inspect()).hash,
        before,
        `${label}: staging does not submit`,
      );
      const picker = page.locator(
        batch
          ? '[data-mobile-upgrade-picker] > div[class*="scroll"]'
          : '[class*="pickerUpgrade_"]',
      );
      for (const end of [false, true]) {
        await picker.evaluate((element, end) => {
          element.scrollTop = end ? element.scrollHeight : 0;
        }, end);
        // Allow sticky positioning and content-visibility to settle.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const target = await confirm.evaluate((button) => {
          const r = button.getBoundingClientRect();
          const points = [
            [0.5, 0.5],
            [0.15, 0.15],
            [0.85, 0.15],
            [0.15, 0.85],
            [0.85, 0.85],
          ];
          return {
            rect: {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            },
            hits: points.map(([x, y]) => {
              const hit = document.elementFromPoint(
                r.left + r.width * x,
                r.top + r.height * y,
              );
              return {
                ok: hit === button || button.contains(hit),
                hit: hit?.textContent,
              };
            }),
            navigation: document
              .querySelector('nav[aria-label="Game views"]')
              ?.getBoundingClientRect()
              .toJSON(),
          };
        });
        try {
          const { width, height } = PROFILES[profile].viewport;
          assert.ok(
            target.rect.left >= 0 &&
              target.rect.top >= 0 &&
              target.rect.right <= width &&
              target.rect.bottom <= height,
            `${label}: Confirm stays in viewport: ${JSON.stringify(target)}`,
          );
          assert.ok(
            target.hits.every((hit) => hit.ok),
            `${label}: Confirm receives taps at scroll ${end ? "end" : "start"}: ${JSON.stringify(target)}`,
          );
          if (target.navigation) {
            assert.ok(
              target.rect.bottom <= target.navigation.top ||
                target.rect.right <= target.navigation.left,
              `${label}: Confirm clears navigation`,
            );
          }
        } catch (error) {
          await page.screenshot({
            path: path.join(
              DATA,
              "runtime",
              `confirm-${config.layout}-${profile}.png`,
            ),
          });
          throw error;
        }
      }
      const rect = await confirm.boundingBox();
      await page.touchscreen.tap(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      await waitFor(
        async () => (await inspect()).hash !== before,
        `${label}: upgrade accepted`,
      );
      submissions.push(
        ...(await page.evaluate(() => window.__CONFIRM_SUBMISSIONS__)),
      );
      assert.equal(
        submissions.length,
        1,
        `${label}: exactly one submission per tap`,
      );
      assert.deepEqual(submissions[0].selection, {
        hero_id: "hero_arien",
        ...(batch
          ? { card_ids: ["expert_duelist"] }
          : { card_id: "expert_duelist" }),
      });
      assert.equal(
        await page.locator("#mobile-pane-heading").count(),
        0,
        `${label}: tap did not open Settings`,
      );
      console.log(
        `PASS: ${label} Confirm hit area, scrolling and real upgrade tap`,
      );
    }
  }
} finally {
  await desk.close();
}
