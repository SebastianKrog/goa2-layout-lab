import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TOOL, PRESETS, PROFILES } from "../config.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  inspectionOptions,
  matchedPool,
  expandMatched,
  inspectPage,
  computedCSS,
  computedChanges,
  extractSources,
  inspectionHTML,
} from "../source-inspection.mjs";

test("inspection requires two distinct existing views and an element selector", () => {
  for (const indexes of [[], [0], [0, 0], [0, 3], [0, 1, 2], [-1, 1], [0, 0.5]])
    assert.throws(() => inspectionOptions({ indexes }, 3), /two different/);
  assert.throws(
    () => inspectionOptions({ indexes: [0, 1], mode: "element" }, 2),
    /selector/,
  );
  assert.throws(
    () => inspectionOptions({ indexes: [0, 1], mode: "unknown" }, 2),
    /mode/,
  );
});

test("real Chromium exports paired viewport CSS, inheritance, pseudo elements, stylesheet sources and inert HTML", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/external.css") {
      res.setHeader("content-type", "text/css");
      res.end(
        '@import url("/import.css"); .card { color: rgb(10, 20, 30); padding: 8px } @media (max-width: 500px) { .card { padding: 18px } }',
      );
    } else if (req.url === "/import.css") {
      res.setHeader("content-type", "text/css");
      res.end(".card { border: 2px solid red }");
    } else
      res.end(
        `<!doctype html><html><head><link rel="stylesheet" href="/external.css"><style>body { --accent: rgb(0, 100, 0); color: var(--accent) } .card::before { content: "spell"; color: purple } @layer lower { .card { padding: 99px } }</style></head><body><div class="card" style="color:rgb(1, 2, 3)"><span>Card</span></div><div class="card">Other</div><script>window.fixtureRuns=(window.fixtureRuns||0)+1</script></body></html>`,
      );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "lab-source-test-"));
  try {
    const pages = await Promise.all(
      [390, 1200].map(async (width) => {
        const page = await browser.newPage({
          viewport: { width, height: 800 },
        });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.addStyleTag({
          content: ".card { margin-top: 7px } /* userscript fixture */",
        });
        return page;
      }),
    );
    const options = { mode: "element", selector: ".card" };
    const [phone, desktop] = await Promise.all(
      pages.map((p) => inspectPage(p, options)),
    );
    assert.equal(phone.matches.length, 2);
    assert.equal(phone.elements.length, 3);
    const card = phone.elements[0];
    card.matched = expandMatched(card.matched, phone.matchedDefinitions);
    assert.equal(card.computed["padding-top"], "18px");
    assert.equal(card.computed.color, "rgb(1, 2, 3)");
    assert.equal(phone.elements[1].computed.color, "rgb(1, 2, 3)");
    assert.equal(card.pseudo["::before"].content, '"spell"');
    assert.ok(card.matched.inherited.length);
    assert.ok(
      card.matched.inlineStyle.cssProperties.some((p) => p.name === "color"),
    );
    assert.ok(
      card.matched.matchedCSSRules.some(
        (r) => r.rule.selectorList.text === ".card",
      ),
    );
    assert.ok(
      phone.stylesheets.some((s) => s.text.includes("userscript fixture")),
    );
    assert.ok(phone.stylesheets.some((s) => s.url.endsWith("/import.css")));
    assert.equal(desktop.elements[0].computed["padding-top"], "8px");
    assert.ok(
      computedChanges(phone, desktop).changes.some(
        (c) => c.values?.element?.["padding-top"],
      ),
    );
    assert.match(computedCSS(phone), /::before/);
    await assert.rejects(
      inspectPage(pages[0], { mode: "element", selector: ".absent" }),
      /did not match/,
    );
    await assert.rejects(
      inspectPage(pages[0], { mode: "element", selector: "[" }),
      /Invalid CSS selector/,
    );
    const comparison = {
      windows: pages.map((page, i) => ({
        page,
        clone: { game_id: String(i) },
        config: { source: i ? "target" : "comparator", seat: "hero_arien" },
        warnings: [],
        errors: [],
      })),
      window(i) {
        return this.windows[i];
      },
      situationId: "fixture",
      status() {
        return {
          references: { base: "base" },
          comparator: "sha",
          script: { revision: "script" },
        };
      },
      api: async () => ({ hash: "same" }),
    };
    const result = await extractSources(
      comparison,
      { indexes: [0, 1], mode: "full" },
      out,
    );
    const dir = path.join(out, result.id);
    const report = JSON.parse(
      await fs.readFile(path.join(dir, "comparison.json"), "utf8"),
    );
    assert.ok(report.files.includes("view-1.html.txt"));
    assert.match(
      await fs.readFile(path.join(dir, "view-1.html.txt"), "utf8"),
      /<!DOCTYPE html>/i,
    );
    assert.equal(report.diverged, false);
    assert.equal(report.schema, 3);
    assert.equal(report.views[0].computedCSS, undefined);
    assert.equal(report.views[0].computedCSSFile, "view-1.computed.css");
    assert.match(
      await fs.readFile(
        path.join(dir, report.views[0].computedCSSFile),
        "utf8",
      ),
      /padding-top: 18px/,
    );
    assert.equal(report.views[0].snapshot.viewport.width, 390);
    const viewer = await browser.newPage();
    await viewer.goto(pathToFileURL(path.join(dir, "index.html")).href);
    assert.match(await viewer.locator("#left").textContent(), /fixtureRuns/);
    assert.equal(await viewer.evaluate(() => window.fixtureRuns), undefined);
    await viewer.selectOption("#mode", "computed");
    assert.match(
      await viewer.locator("#left").textContent(),
      /padding-top: 18px/,
    );
    assert.equal(await pages[0].evaluate(() => window.fixtureRuns), 1);
    const malicious = inspectionHTML({
      ...report,
      selector: "</script><script>window.injected=true</script>",
    });
    await viewer.goto("about:blank");
    await viewer.setContent(malicious);
    assert.equal(await viewer.evaluate(() => window.injected), undefined);
    assert.match(
      await viewer.locator("#notes").textContent(),
      /window.injected/,
    );
    const active = await extractSources(
      comparison,
      { indexes: [0, 1], mode: "active" },
      out,
    );
    const activeMeta = JSON.parse(
      await fs.readFile(path.join(out, active.id, "comparison.json"), "utf8"),
    );
    assert.equal(activeMeta.views[0].snapshot.html, null);
    assert.ok(!activeMeta.files.some((f) => f.endsWith(".html.txt")));
    comparison.api = async () => ({ hash: Math.random().toString() });
    await assert.rejects(
      extractSources(
        comparison,
        { indexes: [0, 1], mode: "element", selector: ".card" },
        out,
      ),
      /Game changed/,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("desk exposes extraction modes and submits the selected pair without loading a situation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [],
      posts = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const windows = PRESETS["Mobile migration"].map((config, index) => ({
      index,
      config,
      gameId: "g" + index,
      seats: ["hero_arien"],
      warnings: [],
      errors: [],
      assets: [],
    }));
    await page.route("http://fixture.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) {
        if (route.request().method() === "POST")
          posts.push({
            path: url.pathname,
            body: route.request().postDataJSON(),
          });
        const data =
          url.pathname === "/api/catalog"
            ? {
                situations: [],
                presets: PRESETS,
                profiles: PROFILES,
                commits: [],
                settings: { preset: "Mobile migration" },
              }
            : url.pathname === "/api/status"
              ? { windows, services: [], busy: false, situationId: null }
              : url.pathname === "/api/extract"
                ? {
                    id: "source-fixture",
                    url: "/reports/source-fixture/index.html",
                  }
                : {};
        return route.fulfill({ json: data });
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (
        ![
          "index.html",
          "desk.mjs",
          "device-panel.mjs",
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
    await page.getByText("Compare HTML & CSS", { exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector("#extract").disabled,
    );
    await page.locator("#extract").click();
    await page.waitForFunction(() =>
      document.querySelector("#error").textContent.includes("exactly two"),
    );
    assert.equal(posts.length, 0);
    await page
      .getByRole("checkbox", { name: "Include in capture" })
      .nth(2)
      .uncheck();
    await page.locator("#extractMode").selectOption("element");
    await page.locator("#extractSelector").fill(".card");
    await page.locator("#extract").click();
    await page.getByRole("link", { name: "Open source comparison" }).waitFor();
    assert.deepEqual(posts, [
      {
        path: "/api/extract",
        body: { indexes: [0, 1], mode: "element", selector: ".card" },
      },
    ]);
    assert.deepEqual(errors, []);
    await page.locator("#cropTools summary").click();
    await page.locator("#cropEnabled").check();
    await page.locator("#cropSelector").fill(".card");
    await page.locator("#cropMatch").selectOption("nth");
    await page.locator("#cropOccurrence").fill("2");
    await page.locator("#capture").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#report h3")?.textContent === "Capture saved",
    );
    assert.deepEqual(posts[1], {
      path: "/api/capture",
      body: {
        indexes: [0, 1],
        crop: { selector: ".card", match: "nth", occurrence: 2 },
      },
    });
    await page.locator("#cropEnabled").uncheck();
    await page.locator("#capture").click();
    await page.waitForFunction(() => !document.body.classList.contains("busy"));
    assert.deepEqual(posts[2], {
      path: "/api/capture",
      body: { indexes: [0, 1] },
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("CLI downloads a portable extraction and rejects an existing destination", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "lab-extract-cli-"));
  const report = {
    id: "source-1234-abcd",
    url: "/reports/source-1234-abcd/index.html",
  };
  const requests = [];
  const files = {
    "comparison.json": JSON.stringify({
      files: [
        "index.html",
        "comparison.json",
        "changes.json",
        "view-1.html.txt",
      ],
    }),
    "index.html": "<!doctype html>portable viewer",
    "changes.json": "{}",
    "view-1.html.txt": "<button>Confirm</button>",
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/extract") {
      let body = "";
      for await (const part of req) body += part;
      requests.push(JSON.parse(body));
      res.end(JSON.stringify(report));
    } else {
      const file = req.url.split("/").pop();
      if (!(file in files)) {
        res.statusCode = 404;
        res.end();
      } else res.end(files[file]);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const dest = path.join(out, "review");
    const args = [
      path.join(TOOL, "scripts/extract-sources.mjs"),
      "--origin=http://127.0.0.1:" + server.address().port,
      "--indexes=1,2",
      "--mode=element",
      "--selector=.card",
      "--out=" + dest,
    ];
    await promisify(execFile)(process.execPath, args);
    assert.deepEqual(requests, [
      { indexes: [1, 2], mode: "element", selector: ".card" },
    ]);
    assert.equal(
      await fs.readFile(path.join(dest, "view-1.html.txt"), "utf8"),
      files["view-1.html.txt"],
    );
    await assert.rejects(
      promisify(execFile)(process.execPath, args),
      /already exists/,
    );
    assert.equal(requests.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("matched-style pooling preserves shared inherited rule data without repeated export trees", () => {
  const pool = matchedPool();
  const rule = {
    selectorList: { text: ".card" },
    style: {
      cssProperties: Array.from({ length: 30 }, (_, i) => ({
        name: "property-" + i,
        value: "long-value-" + i,
      })),
    },
  };
  const raw = {
    matchedCSSRules: [{ rule }],
    inherited: [{ matchedCSSRules: [{ rule }] }],
  };
  const refs = Array.from({ length: 200 }, () => pool.compact(raw));
  assert.deepEqual(expandMatched(refs[0], pool.definitions), raw);
  assert.equal(refs[0].$ref, refs[199].$ref);
  assert.ok(
    JSON.stringify({ refs, definitions: pool.definitions }).length <
      JSON.stringify(Array.from({ length: 200 }, () => raw)).length / 10,
  );
});
