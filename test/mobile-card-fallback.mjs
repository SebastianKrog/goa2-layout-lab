// Deliberate asset faults use raw originals, not the strict clean-asset report gate.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { execFileSync } from "node:child_process";
for (const [k, v] of Object.entries({
  DESK: 4900,
  BASE: 4901,
  COMPARATOR: 4902,
  LIVE: 4903,
  BACKEND: 9900,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(v);
const { DATA, BACKEND, TOOL } = await import("../src/config.mjs");
execFileSync(
  process.env.GOA2_LAB_PYTHON ||
    path.join(
      BACKEND,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  [
    path.join(TOOL, "scripts/create-mobile-presentation-situations.py"),
    "--backend",
    BACKEND,
  ],
  { stdio: "ignore", windowsHide: true },
);
const { startDesk } = await import("../src/desk.mjs");
const { strip } = await import("../src/report.mjs");
const { showPane } = await import("../src/presentation.mjs");
const output = path.join(DATA, "reviews", "card-art-fallback-" + Date.now());
await fs.mkdir(output, { recursive: true });
const records = [];
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--headless",
    "--no-open",
    "--no-auto-load",
  ]),
});
try {
  const c = desk.comparison;
  const s = await c.api("/import", {
    content: JSON.parse(
      await fs.readFile(
        path.join(
          DATA,
          "situation-recipes/mobile-presentation/snorri-empty-history-runes.json",
        ),
        "utf8",
      ),
    ),
  });
  await c.load(
    s.id,
    [
      { source: "live", uiMode: "mobile" },
      { source: "target", uiMode: "desktop" },
    ].map((w) => ({
      ...w,
      seat: "hero_snorri",
      render: "2d",
      profile: "portrait",
    })),
    {},
    s,
  );
  const [native, target] = c.windows;
  const intentionalFailures = [];
  await native.page.route("**/cards/backgrounds/snorri/**", (route) => {
    intentionalFailures.push(route.request().url());
    return route.fulfill({
      status: 404,
      body: "Intentional missing-artwork audit",
    });
  });
  for (const mode of ["large", "image"]) {
    for (const w of c.windows)
      await w.page.setViewportSize({ width: 390, height: 844 });
    await showPane(native.page, "settings", native.config);
    await native.page
      .getByLabel("Inspection style", { exact: true })
      .selectOption(mode);
    await showPane(native.page, "hand", native.config);
    await native.page
      .getByRole("button", { name: "Inscribe the Runes", exact: true })
      .tap();
    if (mode === "large") {
      await showPane(target.page, "hand", target.config);
      await target.page
        .locator('[data-m2="hand-list"] .m2-adapted-row')
        .filter({ hasText: "Inscribe the Runes" })
        .first()
        .tap();
    }
    const dialog = native.page.getByRole("dialog", {
      name: "Inspect Inscribe the Runes",
      exact: true,
    });
    await dialog.waitFor();
    if (mode === "image")
      await native.page.waitForFunction(() =>
        ["ready", "failed"].includes(
          document
            .querySelector("[data-card-paint-state]")
            ?.getAttribute("data-card-paint-state"),
        ),
      );
    else
      await native.page.waitForFunction(
        () =>
          !document.querySelector(
            '[data-card-size="large"] > img[aria-hidden="true"]',
          ),
      );
    assert.ok(
      (await dialog.textContent()).includes("Rune markers are not removed"),
    );
    for (const [profile, size] of [
      ["portrait", { width: 390, height: 844 }],
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
    ]) {
      for (const w of c.windows) await w.page.setViewportSize(size);
      await dialog.locator('[data-card-size="large"]').evaluate((article) => {
        let p = article.parentElement;
        while (p && getComputedStyle(p).overflowY !== "auto")
          p = p.parentElement;
        if (!p) throw Error("Missing scrollable reader");
        p.scrollTop = p.scrollHeight;
      });
      const states = await Promise.all(
        c.windows.map((w) =>
          c.api("/games/" + w.clone.game_id, undefined, "GET"),
        ),
      );
      assert.equal(states[0].hash, states[1].hash);
      for (const w of c.windows)
        await w.page.evaluate(async () => {
          await Promise.all(
            [...document.images].map((image) => image.decode().catch(() => {})),
          );
        });
      const images = [];
      for (const [index, w] of c.windows.entries()) {
        const bytes = await w.page.screenshot({ animations: "disabled" });
        await fs.writeFile(
          path.join(
            output,
            `${mode}-${profile}-${index === 0 ? "native-fallback" : "target-text"}.png`,
          ),
          bytes,
        );
        images.push(PNG.sync.read(bytes));
      }
      const file = `${mode}-${profile}-combined.png`;
      await fs.writeFile(
        path.join(output, file),
        PNG.sync.write(strip(images)),
      );
      records.push({
        mode,
        profile,
        file,
        nativeAssets: [...native.assets],
        targetMode: "Large text with normal artwork",
      });
      console.log("FALLBACK", mode, profile, file);
    }
    await native.page
      .getByRole("button", { name: "Close inspection", exact: true })
      .tap();
  }
  assert.ok(
    intentionalFailures.length > 0,
    "Must actually exercise an asset failure",
  );
  assert.ok(
    native.assets.every((e) =>
      String(e).includes("/cards/backgrounds/snorri/"),
    ),
  );
  assert.deepEqual(native.errors, []);
  assert.deepEqual(target.errors, []);
  await fs.writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        intentionalFault: "Native Snorri background HTTP 404",
        intentionalFailures,
        status: c.status(),
        records,
      },
      null,
      2,
    ),
  );
  console.log("Fallback evidence", output);
} finally {
  await desk.close();
}
