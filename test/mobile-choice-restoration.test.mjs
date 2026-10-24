import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { showPane, capturePresentation } from "../src/presentation.mjs";

test("R1 Choice uses the stable first-button identity while Board closes the active surface", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://r1.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      }),
    );
    await page.goto("http://r1.test/");
    await page.setContent(`<main aria-label="Mobile game" data-mobile-pane="board"></main><nav>
      <button data-pane="board-choice" aria-pressed="false">Choice</button>
      <button data-pane="hand" aria-pressed="false">Hand</button></nav>
      <script>for(const b of document.querySelectorAll('button'))b.onclick=()=>{const root=document.querySelector('main');const next=b.dataset.pane==='board-choice'?'choice':b.dataset.pane;root.dataset.mobilePane=root.dataset.mobilePane===next?'board':next;for(const other of document.querySelectorAll('button'))other.setAttribute('aria-pressed',String((other.dataset.pane==='board-choice'?'choice':other.dataset.pane)===root.dataset.mobilePane));};</script>`);
    const config = { source: "live", uiMode: "mobile", render: "2d" };
    await showPane(page, "choice", config);
    assert.equal((await capturePresentation(page, "2d")).pane, "choice");
    await showPane(page, "board", config);
    assert.equal((await capturePresentation(page, "2d")).pane, "board");
    await showPane(page, "hand", config);
    await showPane(page, "board", config);
    assert.equal((await capturePresentation(page, "2d")).pane, "board");
  } finally {
    await browser.close();
  }
});
