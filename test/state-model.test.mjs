import { LiveAssets } from "../src/live-assets.mjs";
import { execFileSync } from "node:child_process";
import { checkoutEvidence } from "../src/services.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  toPresentation,
  resolvePresentation,
  resolveView,
  adapterPresentation,
  USER_STATE_KEYS,
  SESSION_STORAGE_PREFIXES,
} from "../src/presentation-model.mjs";
import { Layouts, makeLayout, layoutSlots } from "../src/layouts.mjs";

const state = (viewpoint, sessionState = {}, userState = {}) => ({
  schema: 2,
  viewpoint,
  sessionState,
  userState,
});
const config = {
  source: "live",
  profile: "portrait",
  render: "2d",
  uiMode: "mobile",
  seat: "hero_arien",
};

test("Presentation inheritance, explicit resets, Viewpoint and independent preference/session fields", () => {
  const defaults = state(
    "hero_arien",
    { pane: "heroes", selectedCard: "default" },
    { "goa2:board-brightness": "0.8" },
  );
  const situation = {
    presentation: state(
      "hero_snorri",
      { pane: "hand", selectedCard: "one" },
      { "goa2:board-brightness": "0.4" },
    ),
  };
  const followed = resolveView(
    { ...config, presentationDefaults: defaults },
    situation,
  );
  assert.equal(followed.config.seat, "hero_snorri");
  assert.equal(followed.presentation.pane, "hand");
  assert.equal(
    resolveView({ ...config, overrides: { viewpoint: "spectator" } }, situation)
      .config.seat,
    "spectator",
  );
  assert.equal(
    resolveView({ ...config, overrides: { viewpoint: null } }, situation).config
      .seat,
    "spectator",
  );
  const explicit = resolveView(
    {
      ...config,
      presentationDefaults: defaults,
      overrides: state(
        "spectator",
        { selectedCard: null },
        { "goa2:board-brightness": null },
      ),
    },
    situation,
  );
  assert.equal(explicit.config.seat, "spectator");
  assert.equal(explicit.presentation.selectedCard, null);
  assert.equal(explicit.presentation.pane, "hand");
  assert.equal(explicit.presentation.storage["goa2:board-brightness"], null);
  const raw = adapterPresentation(
    resolvePresentation(defaults, situation.presentation, { pane: "deck" }),
    "2d",
  );
  assert.equal(raw.pane, "deck");
  assert.equal(raw.selectedCard, "one");
  assert.equal(
    resolveView(config, situation, { pane: "heroes" }).config.seat,
    "hero_snorri",
  );
  assert.equal(
    toPresentation({ storage: { "goa2-token": "secret", "goa2.locale": "en" } })
      .userState["goa2-token"],
    undefined,
  );
  assert.throws(
    () => toPresentation(state("spectator", {}, { "goa2-token": "secret" })),
    /Unsupported/,
  );
});

test("Layouts persist view arrangement, sources and sync independently of checkpoints and UI mode naming", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "goa2-layouts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new Layouts(root, path.join(root, "shared")).init({
    Current: [config],
  });
  const saved = await store.save(
    "Current",
    [{ ...config, overrides: { viewpoint: "spectator" } }],
    "api",
  );
  assert.equal(saved.views[0].uiMode, "mobile");
  assert.equal(saved.views[0].layout, undefined);
  assert.equal(saved.views[0].seat, undefined);
  assert.equal(saved.synchronization, "api");
  assert.equal(saved.checkpoint, undefined);
  const again = await new Layouts(root, path.join(root, "shared")).init({
    Current: [config],
  });
  assert.equal(again.find("Current").id, saved.id);
  assert.equal(layoutSlots(saved)[0].seat, "spectator");
  assert.throws(
    () => makeLayout("bad", [config], "unknown"),
    /synchronization/,
  );
});

test("phone overrides persist across reload in the lab tab while personal localStorage remains unchanged", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("http://preferences.test/**", (route) =>
      route.fulfill({
        body: "<html><head></head><body></body></html>",
        contentType: "text/html",
      }),
    );
    await page.goto("http://preferences.test/");
    await page.evaluate(() => {
      localStorage.setItem("goa2:board-brightness", "0.9");
      localStorage.setItem("personal", "keep");
      window.__originalStorage = localStorage;
    });
    const bootstrap = await fs.readFile(
      new URL("../public/device-bootstrap.js", import.meta.url),
      "utf8",
    );
    const settings = {
      storageScope: "test",
      userStateKeys: [...USER_STATE_KEYS],
      sessionStoragePrefixes: SESSION_STORAGE_PREFIXES,
      presentation: { storage: { "goa2:board-brightness": "0.2" } },
    };
    await page.evaluate(
      (settings) => (window.__GOA2_DEVICE__ = settings),
      settings,
    );
    await page.addScriptTag({ content: bootstrap });
    assert.equal(
      await page.evaluate(() => localStorage.getItem("goa2:board-brightness")),
      "0.2",
    );
    await page.evaluate(() =>
      localStorage.setItem("goa2:board-brightness", "0.3"),
    );
    assert.equal(
      await page.evaluate(() =>
        window.__originalStorage.getItem("goa2:board-brightness"),
      ),
      "0.9",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("personal")),
      "keep",
    );
    assert.ok(
      (await page.evaluate(() => Object.keys(localStorage))).includes(
        "goa2:board-brightness",
      ),
    );
    await page.reload();
    await page.evaluate(
      (settings) =>
        (window.__GOA2_DEVICE__ = { ...settings, presentation: {} }),
      settings,
    );
    await page.addScriptTag({ content: bootstrap });
    assert.equal(
      await page.evaluate(() => localStorage.getItem("goa2:board-brightness")),
      "0.3",
    );
    await page.reload();
    await page.evaluate(
      (settings) =>
        (window.__GOA2_DEVICE__ = {
          ...settings,
          revision: 1,
          presentation: {},
        }),
      settings,
    );
    await page.addScriptTag({ content: bootstrap });
    assert.equal(
      await page.evaluate(() => localStorage.getItem("goa2:board-brightness")),
      null,
      "a new review step starts at app defaults",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("personal")),
      "keep",
    );
    await page.reload();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("goa2:board-brightness")),
      "0.9",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("personal")),
      "keep",
    );
  } finally {
    await browser.close();
  }
});

test("working-tree evidence hashes served bytes and never labels local modifications clean", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "goa2-provenance-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync("git", ["-c", "core.bare=false", ...args], {
      cwd: root,
      windowsHide: true,
      stdio: "pipe",
    });
  git(["init"]);
  git(["config", "user.name", "Lab test"]);
  git(["config", "user.email", "lab@example.invalid"]);
  await fs.writeFile(path.join(root, "code.js"), "original");
  git(["add", "code.js"]);
  git(["commit", "-m", "Initial"]);
  const clean = await checkoutEvidence(root);
  assert.equal(clean.dirty, false);
  await fs.writeFile(path.join(root, "code.js"), "changed");
  await fs.writeFile(path.join(root, "new.js"), "untracked");
  const changed = await checkoutEvidence(root);
  assert.equal(changed.dirty, true);
  assert.equal(changed.commit, clean.commit);
  assert.notEqual(changed.workingTreeHash, clean.workingTreeHash);
  assert.equal(changed.files.length, 2);
  await fs.writeFile(path.join(root, "code.js"), "changed again");
  assert.notEqual(
    (await checkoutEvidence(root)).workingTreeHash,
    changed.workingTreeHash,
  );
});

test("Live asset transport serves exact bytes, observes edits and cannot read outside supported asset roots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "goa2-live-assets-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "public/cards"), { recursive: true });
  const asset = path.join(root, "public/cards/fixture.png");
  await fs.writeFile(asset, Buffer.from([1, 2, 3, 4]));
  await fs.writeFile(path.join(root, "private.txt"), "private");
  const cache = new LiveAssets(root, { maxBytes: 8 });
  assert.deepEqual(
    (await cache.get("/cards/fixture.png")).body,
    Buffer.from([1, 2, 3, 4]),
  );
  assert.equal(
    (await cache.get("/cards/fixture.png")).contentType,
    "image/png",
  );
  await fs.writeFile(asset, Buffer.from([4, 3, 2, 1]));
  assert.deepEqual(
    (await cache.get("/cards/fixture.png")).body,
    Buffer.from([4, 3, 2, 1]),
  );
  for (const name of [
    "/cards/../../private.txt",
    "/cards/%2e%2e/%2e%2e/private.txt",
    "/.env",
    "/cards/..%5c..%5cprivate.txt",
  ])
    assert.equal(await cache.get(name), null);
  assert.equal(await cache.get("/cards/missing.png"), null);
  const archived = path.join(
    root,
    "model-archive/heroes/arien/arien-original.glb",
  );
  await fs.mkdir(path.dirname(archived), { recursive: true });
  await fs.writeFile(archived, Buffer.from([9, 8, 7]));
  assert.deepEqual(
    (await cache.get("/models/heroes/original/arien.glb")).body,
    Buffer.from([9, 8, 7]),
  );
  assert.equal(
    await cache.get("/models/heroes/original/../../private.txt"),
    null,
  );
});

test("Python and JavaScript share the Presentation contract fixtures", async () => {
  const cases = JSON.parse(
    await fs.readFile(
      new URL("./presentation-contract.json", import.meta.url),
      "utf8",
    ),
  );
  for (const c of cases) {
    if (c.invalid)
      assert.throws(() => toPresentation(c.input), undefined, c.name);
    else assert.deepEqual(toPresentation(c.input), c.expected, c.name);
  }
});

test("editing file-backed Layouts persists only overrides and survives restart", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lab-layout-override-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, "shared"),
    data = path.join(root, "local");
  await fs.mkdir(shared);
  const source = makeLayout("Shared test", [config]);
  await fs.writeFile(path.join(shared, "one.json"), JSON.stringify(source));
  await fs.writeFile(
    path.join(shared, "two.json"),
    JSON.stringify(makeLayout("Untouched", [config])),
  );
  const layouts = await new Layouts(data, shared).init({});
  const saved = await layouts.save(
    " Shared test ",
    [{ ...config, profile: "landscape" }],
    "none",
  );
  assert.equal(saved.id, source.id);
  const reloaded = await new Layouts(data, shared).init({});
  assert.equal(layoutSlots(reloaded.find(source.id))[0].profile, "landscape");
  assert.equal(
    JSON.parse(await fs.readFile(path.join(data, "layouts.json"), "utf8"))
      .length,
    1,
  );
});

test("concurrent Live asset misses keep byte accounting exact and invalidate edits", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "lab-asset-concurrent-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "public/cards"), { recursive: true });
  const file = path.join(root, "public/cards/a.png");
  await fs.writeFile(file, "1234");
  await fs.writeFile(path.join(root, "public/cards/b.png"), "5678");
  const assets = new LiveAssets(root, { maxBytes: 8 });
  const reads = await Promise.all(
    Array.from({ length: 8 }, () => assets.get("/cards/a.png")),
  );
  assert.ok(reads.every((r) => r.body.toString() === "1234"));
  assert.equal(assets.bytes, 4);
  assert.equal(assets.cache.size, 1);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      assets.get(i % 2 ? "/cards/a.png" : "/cards/b.png"),
    ),
  );
  assert.equal(assets.bytes, 8);
  assert.equal(
    assets.bytes,
    [...assets.cache.values()].reduce((n, e) => n + e.result.body.length, 0),
  );
  await fs.writeFile(file, "changed");
  assert.equal((await assets.get("/cards/a.png")).body.toString(), "changed");
  assert.equal(assets.bytes, 7);
  assert.equal(assets.pending.size, 0);
});
