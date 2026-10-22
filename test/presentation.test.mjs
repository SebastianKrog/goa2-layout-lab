import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  restorePresentation,
  capturePresentation,
  setCamera,
} from "../presentation.mjs";

test("saved mobile selection ignores hidden panes, waits for Hand, and restores safe inspection", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://fixture.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<button data-pane="hand" aria-pressed="false">Hand</button><div hidden><div data-lab-card="noble_blade" onclick="window.hiddenClicks++">Hidden duplicate</div></div><main></main><script>
   window.__GOA2_LAB_STATE__={view:{phase:"PLANNING",teams:{RED:{heroes:[{hand:[{id:"noble_blade"}]}]}}}};
   window.cardClicks=0;window.hiddenClicks=0;
   document.querySelector('button').onclick=()=>setTimeout(()=>{
    document.querySelector('button').setAttribute('aria-pressed','true');
    const card=document.createElement('div');card.dataset.labCard='noble_blade';card.textContent='Noble Blade';
    card.onclick=()=>{window.cardClicks++;card.dataset.labSelected='true'};
    document.querySelector('main').append(card);
    const inspect=document.createElement('button');inspect.dataset.labInspectCard='noble_blade';inspect.textContent='Inspect';
    inspect.onclick=()=>{const dialog=document.createElement('div');dialog.dataset.labMobileInspection='noble_blade';dialog.textContent='Card rules';document.body.append(dialog)};
    document.querySelector('main').append(inspect);
   },80);
  <\/script>`,
      }),
    );
    await page.goto("http://fixture.test/");
    const warnings = await restorePresentation(
      page,
      {
        pane: "hand",
        selectedCard: "noble_blade",
        inspectionMobile: "noble_blade",
      },
      { uiMode: "mobile", source: "comparator", render: "2d" },
    );
    assert.deepEqual(warnings, []);
    assert.equal(
      (await capturePresentation(page, "2d")).selectedCard,
      "noble_blade",
    );
    assert.equal(await page.evaluate(() => window.cardClicks), 1);
    assert.equal(await page.evaluate(() => window.hiddenClicks), 0);
    assert.equal(
      (await capturePresentation(page, "2d")).inspectionMobile,
      "noble_blade",
    );
  } finally {
    await browser.close();
  }
});

test("focused mobile hero capture and restore uses the visible safe focus control", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://fixture.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `
      <div hidden><button data-lab-focus-hero="hero_arien" onclick="window.hiddenClicks++">Hidden focus</button></div>
      <button data-lab-focus-hero="hero_arien">Focus Arien</button><main></main>
      <script>window.hiddenClicks=0;window.focusClicks=0;
      document.querySelector('body > button').onclick=()=>{window.focusClicks++;
        document.querySelector('main').innerHTML='<div data-mobile-board-summary data-focused><section data-mobile-hero="hero_arien">Arien</section></div>'};
      <\/script>`,
      }),
    );
    await page.goto("http://fixture.test/");
    const config = { uiMode: "mobile", source: "live", render: "2d" };
    assert.deepEqual(
      await restorePresentation(
        page,
        { pane: "board", focusedHeroMobile: "hero_arien" },
        config,
      ),
      [],
    );
    const saved = await capturePresentation(page, "2d");
    assert.equal(saved.focusedHeroMobile, "hero_arien");
    await page.locator("main").evaluate((e) => e.replaceChildren());
    assert.deepEqual(await restorePresentation(page, saved, config), []);
    assert.equal(
      (await capturePresentation(page, "2d")).focusedHeroMobile,
      "hero_arien",
    );
    assert.equal(await page.evaluate(() => window.hiddenClicks), 0);
    assert.equal(await page.evaluate(() => window.focusClicks), 2);
  } finally {
    await browser.close();
  }
});

test("decision spell inspection restores through its parent without selecting a game choice", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://fixture.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `
      <button data-lab-inspect-card="cantrip" onclick="window.unsafe++">Unrelated parent shortcut</button>
      <div hidden><button data-lab-inspect-card="magic_missile" onclick="window.unsafe++">Hidden</button></div>
      <section data-decision-parent="cantrip"><button data-lab-inspect-card="magic_missile">Inspect spell</button></section>
      <script>window.unsafe=0;document.querySelector('section button').onclick=()=>{
        const parent=document.querySelector('section');parent.dataset.decisionInspection='magic_missile';
        const dialog=document.createElement('div');dialog.dataset.labMobileInspection='magic_missile';dialog.textContent='Spell';parent.append(dialog);
      };<\/script>`,
      }),
    );
    await page.goto("http://fixture.test/");
    const saved = {
      pane: "board",
      inspectionMobile: "magic_missile",
      inspectionMobileParent: "cantrip",
      inspectionMobileContext: "decision",
    };
    assert.deepEqual(
      await restorePresentation(page, saved, {
        uiMode: "mobile",
        source: "live",
        render: "2d",
      }),
      [],
    );
    const captured = await capturePresentation(page, "2d");
    assert.equal(captured.inspectionMobile, "magic_missile");
    assert.equal(captured.inspectionMobileParent, "cantrip");
    assert.equal(captured.inspectionMobileContext, "decision");
    assert.equal(await page.evaluate(() => window.unsafe), 0);
  } finally {
    await browser.close();
  }
});

test("2D camera restore accepts old saves without rotation and preserves requested angles", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<div>Camera fixture</div>");
    await page.evaluate(() => {
      let camera = { mode: "2d", k: 1, x: 0, y: 0, angle: 0 };
      window.__GOA2_LAB_BRIDGE__ = {
        camera2d: {
          get: () => camera,
          set: (value) => {
            camera = { ...value, angle: value.angle ?? 0 };
          },
        },
      };
    });
    await setCamera(page, { mode: "2d", k: 2, x: 0.1, y: -0.1 }, "2d");
    await setCamera(
      page,
      { mode: "2d", k: 2, x: 0.1, y: -0.1, angle: 137 },
      "2d",
    );
    assert.equal(
      await page.evaluate(
        () => window.__GOA2_LAB_BRIDGE__.camera2d.get().angle,
      ),
      137,
    );
    await page.evaluate(() => {
      window.__GOA2_LAB_BRIDGE__.camera2d.set = (value) => {
        window.__GOA2_LAB_BRIDGE__.camera2d.get = () => ({
          ...value,
          angle: 0,
        });
      };
    });
    await assert.rejects(
      setCamera(page, { mode: "2d", k: 2, x: 0, y: 0, angle: 90 }, "2d"),
      /did not settle/,
    );
  } finally {
    await browser.close();
  }
});
