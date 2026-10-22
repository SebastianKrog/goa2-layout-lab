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

test("native panels stay inside a horizontally scrolling workspace and expansion escapes that clip", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 600, height: 500 },
    });
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
          : `<style>body{margin:0}.slots{display:flex;overflow-x:auto;width:260px;margin:20px}.slot{flex:0 0 240px}.native-stage{width:100%;height:180px}.slot.expanded{position:fixed;inset:0;width:600px}.expanded .native-stage{height:500px}</style><div class="slots"><div class="slot" id="a"></div><div class="slot" id="b"></div></div>`,
      }),
    );
    await page.goto("http://native.test/");
    await page.evaluate(async () => {
      window.layoutLabDesktop = {
        layout: (items) => (window.placements = items),
      };
      const { NativeView } = await import("/native.mjs");
      for (const [id, index] of [
        ["a", 1],
        ["b", 2],
      ])
        document
          .getElementById(id)
          .append(
            new NativeView(
              index,
              { nativeId: index },
              { width: 240, height: 180 },
            ).host,
          );
    });
    await page.waitForFunction(() => window.placements?.length === 2);
    assert.ok(
      (await page.evaluate(() => placements)).every(
        (p) => p.width === 0 || p.x + p.width <= 280,
      ),
    );
    await page.evaluate(() => {
      const scroller = document.querySelector(".slots");
      scroller.style.width = "240px";
      scroller.scrollLeft = 240;
    });
    await page.waitForFunction(() => placements[0].visible === false);
    assert.equal((await page.evaluate(() => placements[1])).width, 240);
    await page.evaluate(() => {
      document.getElementById("b").classList.add("expanded");
      dispatchEvent(new Event("resize"));
    });
    await page.waitForFunction(
      () => placements[1].expanded && placements[1].width === 600,
    );
  } finally {
    await browser.close();
  }
});
