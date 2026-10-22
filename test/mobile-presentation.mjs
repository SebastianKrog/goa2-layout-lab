// Owns a Windows/browser verification desk; never changes the user's open games.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
for (const [name, port] of Object.entries({
  DESK: 3700,
  BASE: 3701,
  COMPARATOR: 3702,
  LIVE: 3703,
  BACKEND: 8700,
}))
  process.env[`GOA2_LAB_${name}_PORT`] ??= String(port);
const { TOOL, DATA, BACKEND } = await import("../config.mjs");
const { startDesk } = await import("../desk.mjs");
const { showPane, capturePresentation, restorePresentation } = await import(
  "../presentation.mjs"
);
const { waitFor } = await import("../services.mjs");
const factory = path.join(
  TOOL,
  "scripts/create-mobile-presentation-situations.py",
);
const python =
  process.env.GOA2_LAB_PYTHON ||
  path.join(
    BACKEND,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const args = [factory, "--backend", BACKEND];
if (existsSync(python))
  execFileSync(python, args, { stdio: "inherit", windowsHide: true });
else
  execFileSync(
    "uv",
    ["run", "--locked", "--project", BACKEND, "python", ...args],
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
const output = path.join(DATA, "reviews", `m3-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const evidence = {
  workingTree: true,
  platform: process.platform,
  checks: [],
  output,
};
const desk = await startDesk({
  flags: new Set(["--verification", "--headless", "--no-open"]),
});
const comparison = desk.comparison;
const inspect = (win) =>
  comparison.api(`/games/${win.clone.game_id}`, undefined, "GET");
async function pass(name) {
  evidence.checks.push(name);
  await fs.writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("PASS:", name);
}
async function unchanged(win, fn) {
  const before = (await inspect(win)).hash;
  await fn();
  assert.equal((await inspect(win)).hash, before);
}
async function load(name, seat, profile = "portrait") {
  const content = JSON.parse(
    await fs.readFile(
      path.join(DATA, "situation-recipes/mobile-presentation", name + ".json"),
      "utf8",
    ),
  );
  const situation = await comparison.api("/import", { content });
  await comparison.load(
    situation.id,
    [seat, "hero_wasp", "spectator"].map((seat) => ({
      source: "live",
      profile,
      render: "2d",
      uiMode: "mobile",
      seat,
    })),
    {},
    situation,
  );
  return comparison.windows;
}
try {
  if (!process.argv.includes("--runes-only")) {
    for (const count of process.env.GOA2_LAB_M3_ONLY
      ? [Number(process.env.GOA2_LAB_M3_ONLY)]
      : [0, 1, 3, 9, 10]) {
      const windows = await load(
        "gydion-public-spells-" + count,
        "hero_gydion",
      );
      for (const [index, win] of windows.entries()) {
        const data = await win.page.evaluate(
          () => window.__GOA2_LAB_STATE__.view,
        );
        const gydion = Object.values(data.teams)
          .flatMap((t) => t.heroes)
          .find((h) => h.id === "hero_gydion");
        assert.equal(Array.isArray(gydion.spellbook), index === 0);
        assert.equal(gydion.cast_spells.length, count);
        const before = (await inspect(win)).hash;
        await showPane(win.page, "heroes", win.config);
        const hero = win.page.locator('[data-mobile-hero="hero_gydion"]');
        await hero
          .getByRole("button", { name: `Spells cast: ${count}`, exact: true })
          .tap();
        const browser = win.page.getByRole("dialog", {
          name: "Gydion cast spells",
        });
        await browser.waitFor();
        assert.equal(
          await browser.getByRole("button", { name: /^View / }).count(),
          count,
        );
        if (count) {
          const choice = browser.getByRole("button", { name: /^View / }).last();
          await choice.tap();
          // Reader selection is now a Router entry; wait for that presentation
          // to mount before checking a subsequent preference change.
          await win.page
            .getByLabel("Public spell preview", { exact: true })
            .waitFor();
          const label = await choice.getAttribute("aria-label");
          const sort = browser.getByRole("switch", {
            name: "Sort spells by color instead of rank",
          });
          if ((await sort.getAttribute("aria-checked")) !== "true")
            await sort.tap();
          assert.equal(
            await browser
              .getByRole("button", { name: label, exact: true })
              .getAttribute("aria-pressed"),
            "true",
          );
          await browser.getByRole("button", { name: /^Inspect / }).tap();
          await win.page
            .getByRole("button", { name: "Close inspection", exact: true })
            .tap();
          await browser.waitFor();
        }
        let savedBrowser;
        if (count === 3 && index === 0) {
          await win.page.screenshot({
            path: path.join(output, "public-spells-portrait.png"),
          });
          savedBrowser = await capturePresentation(win.page, "2d");
        }
        await browser.getByRole("button", { name: "Close spells" }).tap();
        if (savedBrowser) {
          assert.deepEqual(
            await restorePresentation(win.page, savedBrowser, win.config),
            [],
          );
          assert.deepEqual(
            (await capturePresentation(win.page, "2d")).spellBrowserMobile,
            savedBrowser.spellBrowserMobile,
          );
          await browser.getByRole("button", { name: "Close spells" }).tap();
        }
        assert.equal((await inspect(win)).hash, before);
      }
      await pass(
        `public cast count ${count}: owner, opponent and spectator; sort and inspection without mutation`,
      );
      if (count === 3) {
        const win = windows[0];
        await showPane(win.page, "hand", win.config);
        await unchanged(win, async () => {
          await win.page
            .getByRole("button", { name: "Inspect Cantrip", exact: true })
            .tap();
          const parent = win.page.getByRole("dialog", {
            name: "Inspect Cantrip",
            exact: true,
          });
          const spell = parent
            .getByRole("button", { name: /^Inspect / })
            .first();
          if (!(await spell.count())) {
            await fs.writeFile(
              path.join(output, "missing-embedded.json"),
              JSON.stringify(
                {
                  text: await parent.innerText(),
                  html: await parent.innerHTML(),
                  view: await win.page.evaluate(
                    () => window.__GOA2_LAB_STATE__.view,
                  ),
                },
                null,
                2,
              ),
            );
            await win.page.screenshot({
              path: path.join(output, "missing-embedded.png"),
            });
          }
          await spell.waitFor({ timeout: 10000 });
          const label = await spell.getAttribute("aria-label");
          const before = await parent.boundingBox();
          await parent.evaluate((e) => (e.scrollTop = 35));
          await spell.tap();
          const child = win.page.getByRole("dialog", {
            name: label,
            exact: true,
          });
          await child.waitFor();
          await win.page.screenshot({
            path: path.join(output, "nested-spell-portrait.png"),
          });
          assert.deepEqual(await parent.boundingBox(), before);
          const saved = await capturePresentation(win.page, "2d");
          assert.equal(saved.inspectionMobileParent, "cantrip");
          await win.page.keyboard.press("Escape");
          await parent.waitFor();
          assert.equal(
            await spell.evaluate((e) => document.activeElement === e),
            true,
          );
          await win.page
            .getByRole("button", { name: "Close inspection", exact: true })
            .tap();
          assert.deepEqual(
            await restorePresentation(win.page, saved, win.config),
            [],
          );
          assert.equal(
            (await capturePresentation(win.page, "2d")).inspectionMobile,
            saved.inspectionMobile,
          );
          await win.page.keyboard.press("Escape");
          await win.page
            .getByRole("button", { name: "Close inspection", exact: true })
            .tap();
        });
        await pass(
          "owner-only embedded spell details, stable parent bounds, Escape, focus and saved nested presentation",
        );
      }
    }
    let windows = await load(
      "gydion-public-spells-3",
      "hero_gydion",
      "landscape",
    );
    const win = windows[0];
    await showPane(win.page, "heroes", win.config);
    await win.page
      .locator('[data-mobile-hero="hero_gydion"]')
      .getByRole("button", { name: "Spells cast: 3", exact: true })
      .tap();
    const browser = win.page.getByRole("dialog", {
      name: "Gydion cast spells",
    });
    await browser.waitFor();
    await win.page.screenshot({
      path: path.join(output, "public-spells-landscape.png"),
    });
    const bounds = await browser.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 390);
    await browser.getByRole("button", { name: "Close spells" }).tap();
    await showPane(win.page, "settings", win.config);
    await win.page
      .getByRole("combobox", { name: "Inspection style" })
      .selectOption("image");
    await showPane(win.page, "hand", win.config);
    await win.page
      .getByRole("button", { name: "Inspect Cantrip", exact: true })
      .tap();
    await win.page.getByRole("img", { name: "Cantrip card image" }).waitFor();
    await waitFor(
      () =>
        win.page
          .getByRole("img", { name: "Cantrip card image" })
          .locator("canvas")
          .evaluate(
            (canvas) =>
              !!canvas
                .getContext("2d")
                .getImageData(canvas.width / 2, canvas.height / 2, 1, 1)
                .data[3],
          ),
      "shared card painter pixels",
    );
    await win.page.screenshot({
      path: path.join(output, "image-reader-landscape.png"),
    });
    await pass(
      "short landscape public browser stays in viewport; shared image painter retains readable text",
    );
    windows = await load(
      "snorri-empty-history-runes",
      "hero_snorri",
      "compact",
    );
    await showPane(windows[0].page, "heroes", windows[0].config);
    const history = windows[0].page.getByLabel("Snorri turn history");
    assert.equal(await history.locator('[aria-current="step"]').count(), 1);
    for (const rune of ["axe", "bird", "anvil", "horn"])
      assert.ok((await history.innerText()).toLowerCase().includes(rune));
    await windows[0].page.screenshot({
      path: path.join(output, "snorri-empty-slots-compact.png"),
    });
    await pass(
      "four named runes above empty turn slots; active turn retained at 360px",
    );
    windows = await load("razzle-piece-markers", "hero_razzle");
    await showPane(windows[0].page, "heroes", windows[0].config);
    const razzle = windows[0].page.locator('[data-mobile-hero="hero_razzle"]');
    assert.equal(await razzle.getByLabel("Bounty", { exact: true }).count(), 1);
    assert.equal(await razzle.getByLabel("Poison", { exact: true }).count(), 1);
    await windows[0].page.screenshot({
      path: path.join(output, "razzle-piece-markers.png"),
    });
    await pass("owned-piece Bounty and Poison appear on Razzle");
  }
  const library = await comparison.api("/situations", undefined, "GET");
  const inscription = library.find(
    (s) =>
      s.origin === "library" &&
      s.provenance?.fixture?.case === "snorri-inscription",
  );
  assert.ok(inscription);
  await comparison.load(
    inscription.id,
    ["hero_snorri", "spectator"].map((seat) => ({
      source: "live",
      profile: "portrait",
      render: "2d",
      uiMode: "mobile",
      seat,
    })),
    {},
    inscription,
  );
  const runeWindow = comparison.windows[0],
    page = runeWindow.page;
  async function choose(label) {
    const before = (await inspect(runeWindow)).hash;
    const batch = page.locator("[data-mobile-rune-batch]");
    if (await batch.count()) {
      // Exercise the supported legacy single-choice transport against the new
      // batch-capable server, then inspect its acknowledged progress in M6.
      const rune = label.replace(/^Place /, "").toLowerCase();
      await page
        .getByRole("button", { name: "Choose " + rune, exact: true })
        .tap();
      assert.equal((await inspect(runeWindow)).hash, before);
      await page.getByRole("button", { name: "Reset", exact: true }).tap();
      await page.evaluate((rune) => {
        const socket = [...window.__GOA2_LAB_SYNC__.sockets].find(
          (s) => s.readyState === 1,
        );
        socket.send(
          JSON.stringify({
            type: "SUBMIT_INPUT",
            request_id: window.__GOA2_LAB_STATE__.input_request.request_id,
            selection: rune,
          }),
        );
      }, rune);
      await waitFor(
        async () => (await inspect(runeWindow)).hash !== before,
        "legacy single rune accepted",
      );
      return;
    }
    const panel = page.getByRole("region", { name: "Game decision" });
    await panel.getByRole("button", { name: label, exact: true }).tap();
    assert.equal((await inspect(runeWindow)).hash, before);
    await panel
      .getByRole("button", { name: "Confirm choice", exact: true })
      .tap();
    await waitFor(
      async () => (await inspect(runeWindow)).hash !== before,
      "accepted rune action",
    );
  }
  await choose("Place Axe");
  await waitFor(
    async () =>
      (
        await page
          .locator(
            '[aria-label="Acknowledged rune slots"], [aria-label="Rune arrangement"]',
          )
          .innerText()
      )
        .toLowerCase()
        .includes("axe"),
    "acknowledged first rune",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await comparison.ready(runeWindow);
  assert.ok(
    (
      await page
        .locator(
          '[aria-label="Acknowledged rune slots"], [aria-label="Rune arrangement"]',
        )
        .innerText()
    )
      .toLowerCase()
      .includes("axe"),
  );
  await page.getByRole("button", { name: "Board", exact: true }).tap();
  await page
    .getByRole("button", { name: /^Return to (decision|runes)$/, exact: true })
    .tap();
  const beforeUndo = JSON.stringify(
    await page.evaluate(() => window.__GOA2_LAB_STATE__),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await waitFor(
    async () =>
      JSON.stringify(await page.evaluate(() => window.__GOA2_LAB_STATE__)) !==
      beforeUndo,
    "authoritative rune Undo",
  );
  if ((await inspect(runeWindow)).decision?.type === "CHOOSE_ACTION") {
    await waitFor(
      () =>
        page.evaluate(
          () =>
            window.__GOA2_LAB_STATE__?.input_request?.type === "CHOOSE_ACTION",
        ),
      "action chooser after Undo",
    );
    const skillLabel = await page.evaluate(
      () =>
        window.__GOA2_LAB_STATE__.input_request.options.find(
          (option) => option.id === "SKILL",
        ).text,
    );
    await choose(skillLabel);
  }
  assert.ok(
    !(
      await page
        .locator(
          '[aria-label="Acknowledged rune slots"], [aria-label="Rune arrangement"]',
        )
        .innerText()
    )
      .toLowerCase()
      .includes("axe"),
  );
  for (const rune of ["Axe", "Bird", "Anvil"]) await choose("Place " + rune);
  const receipt = page.getByLabel("Runes placed", { exact: true });
  await receipt.waitFor();
  for (const rune of ["axe", "bird", "anvil", "horn"])
    assert.ok((await receipt.innerText()).toLowerCase().includes(rune));
  await page.screenshot({
    path: path.join(output, "rune-confirmation-and-recovery.png"),
  });
  const beforeClose = (await inspect(runeWindow)).hash;
  await page
    .getByRole("button", { name: "Close rune confirmation", exact: true })
    .tap();
  assert.equal((await inspect(runeWindow)).hash, beforeClose);
  await pass(
    "runes survive actual reload and Board peek; Undo clears future history; automatic fourth is acknowledged without mutation",
  );
  for (const win of comparison.windows) {
    assert.deepEqual(win.errors, []);
    assert.deepEqual(win.assets, []);
  }
  await pass("no final browser render or asset errors");
  console.log("M3 evidence:", output);
} finally {
  await desk.close();
}
