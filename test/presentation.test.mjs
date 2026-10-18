import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { restorePresentation, capturePresentation } from "../presentation.mjs";

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
      { layout: "mobile", source: "comparator", render: "2d" },
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
