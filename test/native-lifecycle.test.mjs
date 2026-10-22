import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
test("replacing a native panel preserves the newly registered surface during old cleanup", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://native.test/**", async (route) =>
      route.fulfill({
        contentType: route.request().url().endsWith("mjs")
          ? "text/javascript"
          : "text/html",
        body: route.request().url().endsWith("mjs")
          ? await fs.readFile(
              new URL("../public/native.mjs", import.meta.url),
              "utf8",
            )
          : '<div id="stage"></div>',
      }),
    );
    await page.goto("http://native.test/");
    await page.evaluate(async () => {
      window.layoutLabDesktop = {
        layout: (items) => (window.placements = items),
      };
      const { NativeView } = await import("/native.mjs");
      const first = new NativeView(
        0,
        { nativeId: 42 },
        { width: 390, height: 844 },
      );
      document.querySelector("#stage").append(first.host);
      const replacement = new NativeView(
        0,
        { nativeId: 42 },
        { width: 390, height: 844 },
      );
      replacement.host.style.cssText = "width:390px;height:844px";
      document.querySelector("#stage").replaceChildren(replacement.host);
      first.destroy();
    });
    await page.waitForFunction(() => window.placements?.length === 1);
    assert.deepEqual(
      await page.evaluate(() => placements.map((p) => [p.id, p.visible])),
      [[42, true]],
    );
  } finally {
    await browser.close();
  }
});
