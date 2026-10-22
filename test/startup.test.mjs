import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { launchSettings, PRESETS, PROFILES, TOOL } from "../config.mjs";
import { loadStartupSituation } from "../startup.mjs";

test("startup stays empty unless a saved situation ID is explicitly supplied", async () => {
  assert.equal(launchSettings([], {}).situationId, null);
  assert.equal(launchSettings(["--preset=desktop-3d"], {}).situationId, null);
  assert.equal(
    launchSettings(["--situation=second"], {}).situationId,
    "second",
  );
  assert.throws(
    () => launchSettings(["--situation="], {}),
    /saved-situation-id/,
  );
  const situations = [{ id: "first" }, { id: "second" }];
  const calls = [];
  const args = {
    situations,
    comparison: { load: async (...args) => calls.push(args) },
    presets: PRESETS,
    preset: "Mobile migration",
  };
  await loadStartupSituation({ ...args, situationId: null });
  assert.equal(calls.length, 0, "The first library entry must not auto-load");
  await loadStartupSituation({
    ...args,
    situationId: "second",
    disabled: true,
  });
  assert.equal(calls.length, 0);
  await loadStartupSituation({ ...args, situationId: "second" });
  assert.deepEqual(calls, [
    ["second", PRESETS["Mobile migration"], {}, situations[1]],
  ]);
  await assert.rejects(
    () => loadStartupSituation({ ...args, situationId: "missing" }),
    /not found/,
  );
  assert.equal(
    calls.length,
    1,
    "An unknown ID must not fall back to the first situation",
  );
});

test("Stop desk is visible and usable on Compare while a load is busy", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const posts = [];
    let busy = true;
    await page.route("http://fixture.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) {
        if (route.request().method() === "POST") posts.push(url.pathname);
        const data =
          url.pathname === "/api/catalog"
            ? {
                situations: [
                  {
                    id: "saved",
                    name: "Saved setup",
                    origin: "local",
                    group: "",
                    summary: { phase: "PLANNING", round: 1 },
                    provenance: { slots: PRESETS["Mobile migration"] },
                    presentations: {},
                  },
                  {
                    id: "gameOnly",
                    name: "Game only",
                    origin: "local",
                    group: "",
                    summary: { phase: "PLANNING", round: 1 },
                    provenance: {},
                    presentations: {},
                  },
                ],
                presets: PRESETS,
                profiles: PROFILES,
                commits: [],
                settings: { preset: "Mobile migration" },
              }
            : url.pathname === "/api/status"
              ? { windows: [], busy, services: [], situationId: null }
              : {};
        return route.fulfill({ json: data });
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (
        ![
          "index.html",
          "desk.mjs",
          "device-panel.mjs",
          "element-report-panel.mjs",
          "desk.css",
          "live.mjs",
          "native.mjs",
        ].includes(file)
      )
        return route.abort();
      return route.fulfill({
        body: await fs.readFile(path.join(TOOL, "public", file)),
        contentType: file.endsWith(".mjs")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    });
    await page.goto("http://fixture.test/");
    await page.waitForFunction(() => document.body.classList.contains("busy"));
    const stop = page.getByRole("button", { name: "Stop desk", exact: true });
    assert.equal(await stop.count(), 1);
    assert.equal(await stop.isVisible(), true);
    assert.equal(await stop.isEnabled(), true);
    for (const width of [1280, 600, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const rect = await stop.boundingBox();
      assert.ok(
        rect && rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0,
        "Stop stays within the viewport",
      );
    }
    assert.equal(await page.locator("#load").isDisabled(), true);
    assert.deepEqual(posts, []);
    busy = false;
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    await page.locator(".advanced-setup summary").click();
    const savedSetup = page.getByRole("checkbox", {
      name: "Restore legacy bundled setup",
      exact: true,
    });
    await page
      .getByLabel("Saved situation", { exact: true })
      .selectOption("gameOnly");
    assert.equal(await savedSetup.isDisabled(), true);
    assert.equal(await savedSetup.isChecked(), false);
    await page
      .getByLabel("Saved situation", { exact: true })
      .selectOption("saved");
    assert.equal(
      await savedSetup.isEnabled(),
      true,
      "Saved slots alone are a usable setup",
    );
    assert.equal(await savedSetup.isChecked(), false);
    await savedSetup.uncheck();
    assert.equal(await savedSetup.isChecked(), false);
    busy = true;
    await page.waitForFunction(() => document.body.classList.contains("busy"));
    assert.equal(await stop.isEnabled(), true);
    await stop.click();
    await page.waitForFunction(
      () => document.querySelector("#connection").textContent === "Stopped",
    );
    assert.deepEqual(posts, ["/api/shutdown"]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
