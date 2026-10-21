// Focused M2 acceptance: real backend checkpoints and the frontend working tree.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
for (const [name, port] of Object.entries({
  DESK: 3600,
  BASE: 3601,
  COMPARATOR: 3602,
  LIVE: 3603,
  BACKEND: 8600,
})) {
  process.env[`GOA2_LAB_${name}_PORT`] ??= String(port);
}
const { TOOL, DATA, BACKEND } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { showPane, capturePresentation, restorePresentation } = await import(
  "../presentation.mjs"
);
const { waitFor } = await import("../services.mjs");
const output = path.join(DATA, "situation-recipes/mobile-gameplay");
const python =
  process.env.GOA2_LAB_PYTHON ||
  path.join(
    BACKEND,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const factory = path.join(TOOL, "scripts/create-mobile-gameplay-situations.py");
const args = [factory, "--backend", BACKEND, "--output", output];
if (process.env.GOA2_LAB_PYTHON || existsSync(python))
  execFileSync(python, args, { stdio: "inherit", windowsHide: true });
else
  execFileSync(
    "uv",
    ["run", "--project", BACKEND, "--locked", "python", ...args],
    {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: path.join(
          DATA,
          "runtime",
          `fixture-venv-${process.platform}-${process.arch}`,
        ),
        UV_LINK_MODE: "copy",
      },
    },
  );
const folder = path.join(DATA, "reviews", `m2-${Date.now()}`);
await fs.mkdir(folder, { recursive: true });
const evidence = {
  startedAt: new Date().toISOString(),
  workingTree: true,
  checks: [],
};
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--no-auto-load",
    "--headless",
    "--no-open",
  ]),
});
const comparison = desk.comparison;
let current;
async function inspect(win = current) {
  return comparison.api(`/games/${win.clone.game_id}`, undefined, "GET");
}
async function load(situation, seat = "hero_arien", presentation) {
  console.log("Checking: " + situation.name);
  await comparison.load(
    situation.id,
    [
      {
        source: "base",
        profile: "portrait",
        render: "2d",
        layout: "desktop",
        seat,
      },
      {
        source: "live",
        profile: "portrait",
        render: "2d",
        layout: "mobile",
        seat,
      },
    ],
    presentation ? { 1: presentation } : {},
  );
  current = comparison.windows[1];
  assert.equal(current.config.seat, situation.provenance?.seat || seat);
  assert.equal(
    (await inspect(comparison.windows[0])).hash,
    (await inspect()).hash,
  );
  assert.deepEqual(current.warnings, []);
}
async function unchanged(fn) {
  const hash = (await inspect()).hash;
  await fn();
  assert.equal((await inspect()).hash, hash);
}
async function accepted(fn) {
  const hash = (await inspect()).hash;
  const wire = await current.page.evaluate(() =>
    JSON.stringify(window.__GOA2_LAB_STATE__),
  );
  await fn();
  await waitFor(
    async () => (await inspect()).hash !== hash,
    "accepted real game action",
  );
  await waitFor(
    async () =>
      (await current.page.evaluate(() =>
        JSON.stringify(window.__GOA2_LAB_STATE__),
      )) !== wire,
    "authoritative client update",
  );
}
async function record(name) {
  await current.page.screenshot({ path: path.join(folder, name + ".png") });
  assert.deepEqual(current.errors, []);
  assert.deepEqual(current.warnings, []);
  evidence.checks.push({
    name,
    game: await inspect(),
    viewport: current.page.viewportSize(),
  });
  await fs.writeFile(
    path.join(folder, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("PASS: " + name);
}
async function choice(text) {
  const panel = current.page.getByRole("region", { name: "Game decision" });
  await panel.getByRole("button", { name: text, exact: true }).tap();
  await accepted(() =>
    panel
      .getByRole("button", { name: /^Confirm (choice|discard)$/, exact: true })
      .tap(),
  );
}
try {
  const library = await comparison.api("/situations", undefined, "GET");
  for (const key of [
    "select-card",
    "choose-action",
    "defense-card",
    "discard-card",
  ]) {
    const situation = library.find(
      (s) => s.origin === "library" && s.provenance?.fixture?.case === key,
    );
    assert.ok(situation, key);
    const seat =
      key === "defense-card" || key === "discard-card"
        ? "hero_brogan"
        : "hero_arien";
    await load(
      situation,
      seat,
      key === "select-card"
        ? { render: "2d", pane: "hand", selectedCard: "noble_blade" }
        : undefined,
    );
    if (key === "select-card") {
      assert.equal(
        (await capturePresentation(current.page, "2d")).selectedCard,
        "noble_blade",
      );
      await unchanged(async () => {
        await current.page
          .getByRole("button", { name: "Inspect Noble Blade", exact: true })
          .tap();
        await current.page
          .getByRole("dialog", { name: "Inspect Noble Blade" })
          .waitFor();
        const saved = await capturePresentation(current.page, "2d");
        assert.equal(saved.inspectionMobile, "noble_blade");
        await current.page
          .getByRole("button", { name: "Close inspection" })
          .tap();
        assert.deepEqual(
          await restorePresentation(current.page, saved, current.config),
          [],
        );
        await current.page
          .getByRole("button", { name: "Close inspection" })
          .tap();
      });
      await record("hand-inspection-and-restore");
      await accepted(() =>
        current.page.getByRole("button", { name: /^Commit/ }).tap(),
      );
    } else {
      const panel = current.page.getByRole("region", { name: "Game decision" });
      const option = panel.locator("button[aria-pressed]").first();
      await unchanged(() => option.tap());
      await record(key + "-staged");
      await accepted(() =>
        panel.getByRole("button", { name: /^Confirm (choice|discard)$/ }).tap(),
      );
    }
    await record(key + "-accepted");
  }
  const fixtures = {};
  for (const key of [
    "gydion-spell-choice",
    "snorri-inscription",
    "emmitt-second-card",
  ]) {
    const content = JSON.parse(
      await fs.readFile(path.join(output, key + ".json"), "utf8"),
    );
    fixtures[key] = await comparison.api("/import", { content });
  }
  // Deliberately reuse the Arien preset; the loader must resolve this roster.
  await load(fixtures["gydion-spell-choice"]);
  await unchanged(async () => {
    await current.page
      .getByRole("button", { name: "Inspect Magic Missile", exact: true })
      .last()
      .tap();
    await current.page
      .getByRole("dialog", { name: "Inspect Magic Missile" })
      .waitFor();
    await record("gydion-spell-inspection");
    await current.page.getByRole("button", { name: "Close inspection" }).tap();
  });
  await choice("Magic Missile");
  await current.page.waitForFunction(
    () => window.__GOA2_LAB_STATE__?.input_request?.type === "CHOOSE_ACTION",
  );
  assert.equal((await inspect()).decision.type, "CHOOSE_ACTION");
  await record("gydion-spell-action");
  // No attack is needed to verify the follow-up action confirmation.
  const hold = current.page
    .getByRole("region", { name: "Game decision" })
    .getByRole("button", { name: /Hold/i });
  await hold.tap();
  await accepted(() =>
    current.page
      .getByRole("button", { name: /^Confirm (choice|discard)$/, exact: true })
      .tap(),
  );
  await record("gydion-spell-action-accepted");

  // Deliberately reuse the Arien preset; the loader must resolve this roster.
  await load(fixtures["snorri-inscription"]);
  await unchanged(async () => {
    await showPane(current.page, "heroes", current.config);
    await current.page
      .getByRole("button", { name: "Inspect Inscribe the Runes", exact: true })
      .tap();
    await current.page.getByRole("button", { name: "Close inspection" }).tap();
    await showPane(current.page, "board", current.config);
  });
  if (await current.page.locator("[data-mobile-rune-batch]").count()) {
    for (const rune of ["axe", "bird", "anvil"])
      await unchanged(() =>
        current.page
          .getByRole("button", { name: "Choose " + rune, exact: true })
          .tap(),
      );
    await record("snorri-staged-arrangement");
    await accepted(() =>
      current.page
        .getByRole("button", { name: "Commit runes", exact: true })
        .tap(),
    );
  } else {
    for (const rune of ["Axe", "Bird", "Anvil"]) {
      const panel = current.page.getByRole("region", { name: "Game decision" });
      const option = panel.getByRole("button", { name: new RegExp(rune, "i") });
      await unchanged(() => option.tap());
      await record("snorri-" + rune.toLowerCase() + "-confirmation");
      await accepted(() =>
        panel
          .getByRole("button", {
            name: /^Confirm (choice|discard)$/,
            exact: true,
          })
          .tap(),
      );
    }
  }
  await waitFor(
    () =>
      current.page.evaluate(
        () =>
          Object.values(window.__GOA2_LAB_STATE__.view.teams)
            .flatMap((t) => t.heroes)
            .find((h) => h.id === "hero_snorri").rune_slots?.["4"] === "horn",
      ),
    "automatic fourth rune",
  );
  await showPane(current.page, "heroes", current.config);
  await record("snorri-complete-runes");

  // Deliberately reuse the Arien preset; the loader must resolve this roster.
  await load(fixtures["emmitt-second-card"]);
  await showPane(current.page, "hand", current.config);
  assert.equal(
    await current.page
      .getByRole("button", { name: "Done — play one card", exact: true })
      .count(),
    1,
  );
  await accepted(() =>
    current.page
      .getByRole("button", { name: "Take back card", exact: true })
      .tap(),
  );
  await showPane(current.page, "hand", current.config);
  for (let i = 0; i < 2; i++) {
    const card = current.page.locator("[data-lab-card]:visible").first();
    await unchanged(() => card.tap());
    await accepted(() =>
      current.page.getByRole("button", { name: /^Commit/ }).tap(),
    );
  }
  await waitFor(
    () =>
      current.page.evaluate(
        () =>
          !Object.values(window.__GOA2_LAB_STATE__.view.teams)
            .flatMap((t) => t.heroes)
            .find((h) => h.id === "hero_emmitt").can_commit_second_card,
      ),
    "second Emmitt commit",
  );
  await record("emmitt-two-cards-committed");
  await comparison.reset(1);
  current = comparison.windows[1];
  await showPane(current.page, "hand", current.config);
  await accepted(() =>
    current.page
      .getByRole("button", { name: "Done — play one card", exact: true })
      .tap(),
  );
  await record("emmitt-done-after-first-card");
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(folder, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("M2 browser evidence: " + folder);
} finally {
  await desk.close();
}
