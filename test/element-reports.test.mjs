import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { ElementReports } from "../element-reports.mjs";
import { installElementPicker } from "../public/element-picker.mjs";

const until = async (fn) => {
  for (let n = 0; n < 200; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timed out waiting for report state");
};
test("picker reports all views, captures CSS/HTML/checkpoints without overlays, and never activates the game control", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "goa2-elements-"));
  const browser = await chromium.launch({ headless: true });
  const imports = [];
  let queue = Promise.resolve(),
    manager;
  const comparison = {
    windows: [],
    situationId: "source-moment",
    status: () => ({
      references: { base: "a".repeat(40) },
      comparator: "b".repeat(40),
      script: null,
    }),
    api: async (route, body) => {
      if (route.endsWith("/checkpoint")) {
        await new Promise((r) => setTimeout(r, 750));
        return {
          hash: "unchanged",
          situation: {
            schema: 1,
            id: "moment",
            name: "Moment",
            checkpoint: { state: { phase: "PLANNING" } },
            summary: { phase: "PLANNING" },
          },
        };
      }
      if (route === "/import") {
        imports.push(body);
        return { id: "saved", name: body.name };
      }
      return { hash: "unchanged" };
    },
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      if (url.pathname.startsWith("/api/element-report")) {
        let body = "";
        for await (const chunk of req) body += chunk;
        const value = body ? JSON.parse(body) : {};
        let result;
        if (url.pathname.endsWith("/status")) result = manager.status();
        else if (url.pathname.endsWith("/mode"))
          result = await manager.setEnabled(value.enabled);
        else if (url.pathname.endsWith("/comment"))
          result = manager.setComment(value.id, value.comment);
        else if (url.pathname.endsWith("/send")) {
          await queue;
          result = await manager.send(value.id, value.comment);
        } else if (url.pathname.endsWith("/discard"))
          result = await manager.discard(value.id);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(result));
        return;
      }
      if (url.pathname === "/panel") {
        let html = await fs.readFile(
          new URL("../public/index.html", import.meta.url),
          "utf8",
        );
        html = html.replace(
          '<script type="module" src="/desk.mjs"></script>',
          `<script type="module">import {initElementReportPanel} from '/element-report-panel.mjs';const read=async p=>(await fetch(p)).json();const call=async(n,b)=>{const r=await fetch('/api/'+n,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());initElementReportPanel({read,call,notify:()=>{}});</script>`,
        );
        res.setHeader("content-type", "text/html");
        res.end(html);
        return;
      }
      if (["/element-report-panel.mjs", "/desk.css"].includes(url.pathname)) {
        res.setHeader(
          "content-type",
          url.pathname.endsWith("mjs") ? "text/javascript" : "text/css",
        );
        res.end(
          await fs.readFile(
            new URL("../public" + url.pathname, import.meta.url),
          ),
        );
        return;
      }
      res.setHeader("content-type", "text/html");
      const content =
        url.pathname === "/three"
          ? '<div class="card">Same</div><div class="card">Same</div>'
          : '<div id="target" class="card"><button onclick="window.gameActions++">Same</button></div>';
      res.end(
        `<!doctype html><style>.card{width:240px;height:90px;background:white;border:2px solid red;padding:10px;color:rgb(12,34,56)}.card::before{content:'test'}</style><body>${content}<script>window.gameActions=0</script></body>`,
      );
    } catch (e) {
      res.statusCode = 422;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  manager = new ElementReports(comparison, {
    root,
    schedule: (fn) => {
      queue = queue.then(fn);
      return queue;
    },
  });
  try {
    for (let i = 0; i < 3; i++) {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      const win = {
        page,
        clone: { game_id: "g" + i, seats: { hero: "private-credential" } },
        config: {
          source: i === 0 ? "base" : "comparator",
          render: "2d",
          uiMode: "desktop",
          profile: "desktop",
          seat: "hero",
        },
        warnings: [],
        errors: [],
      };
      comparison.windows.push(win);
      await manager.attach(win);
      await page.goto(origin + ["/one", "/two", "/three"][i]);
    }
    // The third view is deliberately ambiguous; all context must still be saved.
    const source = comparison.windows[0].page;
    await source.evaluate(() => {
      document.querySelector("#target").removeAttribute("id");
      document.querySelector(".card").textContent = "Same";
      document.querySelector(".card").onclick = () => window.gameActions++;
    });
    const panel = await browser.newPage();
    await panel.goto(origin + "/panel");
    await panel.locator("#reportElement").click();
    await until(() =>
      source.evaluate(() => window.__GOA2_ELEMENT_PICKER__.active),
    );
    for (const { page } of comparison.windows)
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).cursor),
        "crosshair",
      );
    await source.mouse.move(50, 50);
    const bounds = await source.evaluate(() => {
      const a = document.querySelector(".card").getBoundingClientRect(),
        b = document
          .querySelector("[data-lab-element-overlay]")
          .getBoundingClientRect();
      return [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height];
    });
    assert.deepEqual(bounds.slice(0, 4), bounds.slice(4));
    await source.mouse.click(50, 50);
    await panel.locator("#elementReportDialog").waitFor({ state: "visible" });
    const id = manager.draft.id;
    await panel
      .locator("#elementReportComment")
      .fill("Fix <script>window.pwned=1</script>");
    await panel
      .getByRole("button", { name: "Close element report", exact: true })
      .click();
    await panel.reload();
    await panel.locator("#elementReportDialog").waitFor({ state: "visible" });
    assert.equal(
      await panel.locator("#elementReportComment").inputValue(),
      "Fix <script>window.pwned=1</script>",
    );
    await until(() => manager.draft?.stage === "ready");
    await panel.locator("#elementReportComment").press("End");
    await panel.locator("#elementReportComment").press("Shift+Enter");
    await panel.locator("#elementReportComment").type("details");
    await panel.locator("#elementReportComment").press("Enter");
    await until(() => manager.lastReport?.id === id);
    const report = JSON.parse(
      await fs.readFile(path.join(root, id, "report.json")),
    );
    assert.equal(report.views.length, 3);
    assert.match(report.views[2].error, /ambiguous/);
    assert.equal(report.views[2].files.image, undefined);
    assert.ok(report.views[2].files.situation);
    assert.equal(imports.length, 1);
    assert.match(report.comment, /\ndetails$/);
    assert.equal(report.views[0].revision.commit, "a".repeat(40));
    assert.equal(report.views[1].revision.commit, "b".repeat(40));
    for (const view of report.views.slice(0, 2)) {
      assert.equal(
        await comparison.windows[view.index].page.evaluate(
          () => window.gameActions,
        ),
        0,
      );
      assert.equal(
        await comparison.windows[view.index].page
          .locator("[data-lab-element-overlay]")
          .count(),
        0,
      );
      const html = await fs.readFile(
        path.join(root, id, view.files.html),
        "utf8",
      );
      assert.match(html, /class="card"/);
      assert.doesNotMatch(html, /data-lab-element-overlay/);
      const css = await fs.readFile(
        path.join(root, id, view.files.matchedCSS),
        "utf8",
      );
      assert.match(css, /rgb\(12,34,56\)|rgb\(12, 34, 56\)/);
      assert.doesNotMatch(css, /cursor: crosshair/);
      const png = PNG.sync.read(
        await fs.readFile(path.join(root, id, view.files.image)),
      );
      assert.ok(png.width > 200);
      assert.ok(png.height > 50);
    }
    const viewer = await fs.readFile(path.join(root, id, "index.html"), "utf8");
    assert.match(viewer, /&lt;script&gt;/);
    assert.doesNotMatch(JSON.stringify(report), /private-credential/);
    await manager.send(id, "retry");
    assert.equal(imports.length, 1);
    await manager.setEnabled(true);
    await source.keyboard.press("Escape");
    await until(() => !manager.active);
    // A single-view draft can be discarded without creating a catalog entry.
    comparison.windows = [comparison.windows[0]];
    await manager.setEnabled(true);
    await source.mouse.click(50, 50);
    await until(() => manager.draft?.stage === "ready");
    const discarded = manager.draft;
    assert.equal(discarded.views.length, 1);
    await manager.discard(discarded.id);
    assert.equal(manager.draft, null);
    assert.equal(imports.length, 1);
    await assert.rejects(fs.stat(discarded.dir), /ENOENT/);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await fs.rm(root, { recursive: true, force: true });
  }
});
