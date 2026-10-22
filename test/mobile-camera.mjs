import assert from "node:assert/strict";
import fs from "node:fs/promises";
for (const [k, p] of Object.entries({
  DESK: 5970,
  BASE: 5971,
  COMPARATOR: 5972,
  LIVE: 5973,
  BACKEND: 10970,
}))
  process.env[`GOA2_LAB_${k}_PORT`] ??= String(p);
process.env.NODE_ENV = "production";
process.env.WSLENV = [process.env.WSLENV, "NODE_ENV"].filter(Boolean).join(":");
const { startDesk } = await import("../src/desk.mjs");
const { DATA } = await import("../src/config.mjs");
const { captureReport } = await import("../src/report.mjs");
const { setCamera, showPane } = await import("../src/presentation.mjs");
const desk = await startDesk({
  flags: new Set([
    "--headless",
    "--verification",
    "--no-auto-load",
    "--no-open",
  ]),
});
const c = desk.comparison;
const out = DATA + "/reviews/m7-camera-" + Date.now();
await fs.mkdir(out, { recursive: true });
const records = [];
const camera = (p) =>
  p.evaluate(() => window.__GOA2_LAB_BRIDGE__.camera2d.get());
async function centred(page, name) {
  return page.evaluate((name) => {
    const svg = document.querySelector("svg[data-board-map]"),
      host = svg.parentElement,
      r = host.getBoundingClientRect();
    const pattern = [...svg.querySelectorAll("pattern")].find(
      (p) => p.id === "hero-pattern-" + name,
    );
    const m = pattern?.closest("g")?.getScreenCTM();
    if (!m) return null;
    const root = svg.closest("[data-mobile-pane]").parentElement;
    const obstacles = [
      ...root.querySelectorAll(
        "[data-board-reserved], [data-mobile-spell-preview]",
      ),
    ]
      .filter(
        (el) =>
          !el.hidden &&
          el.getClientRects().length &&
          getComputedStyle(el).visibility !== "hidden",
      )
      .map((el) => el.getBoundingClientRect())
      .filter(
        (o) =>
          o.width > 0 &&
          o.height > 0 &&
          o.right > r.left &&
          o.left < r.right &&
          o.bottom > r.top &&
          o.top < r.bottom,
      );
    const xs = [
      ...new Set([
        r.left,
        r.right,
        ...obstacles.flatMap((o) => [
          Math.max(r.left, o.left),
          Math.min(r.right, o.right),
        ]),
      ]),
    ].sort((a, b) => a - b);
    const ys = [
      ...new Set([
        r.top,
        r.bottom,
        ...obstacles.flatMap((o) => [
          Math.max(r.top, o.top),
          Math.min(r.bottom, o.bottom),
        ]),
      ]),
    ].sort((a, b) => a - b);
    let best = {
      area: 0,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    };
    for (const left of xs)
      for (const right of xs)
        for (const top of ys)
          for (const bottom of ys) {
            const area = (right - left) * (bottom - top);
            if (right <= left || bottom <= top || area <= best.area) continue;
            if (
              obstacles.some(
                (o) =>
                  o.left < right &&
                  o.right > left &&
                  o.top < bottom &&
                  o.bottom > top,
              )
            )
              continue;
            best = { area, left, right, top, bottom };
          }
    return {
      x: m.e,
      y: m.f,
      expectedX: (best.left + best.right) / 2,
      expectedY: (best.top + best.bottom) / 2,
      k: window.__GOA2_LAB_BRIDGE__.camera2d.get().k,
    };
  }, name);
}
async function expectCentre(page, name) {
  await page.waitForFunction((name) => {
    const svg = document.querySelector("svg[data-board-map]");
    const p = [...svg.querySelectorAll("pattern")].find(
      (p) => p.id === "hero-pattern-" + name,
    );
    return !!p?.closest("g")?.getScreenCTM();
  }, name);
  await page.waitForTimeout(80);
  const v = await centred(page, name);
  assert.ok(Math.abs(v.x - v.expectedX) < 3, JSON.stringify(v));
  assert.ok(Math.abs(v.y - v.expectedY) < 3, JSON.stringify(v));
}
async function load(id, seat = "hero_arien") {
  await c.load(
    id,
    [
      { source: "live", uiMode: "mobile" },
      { source: "target", uiMode: "desktop" },
    ].map((w) => ({ ...w, seat, profile: "portrait", render: "2d" })),
  );
  for (const w of c.windows)
    await w.page.emulateMedia({ reducedMotion: "reduce" });
  return c.windows[0].page;
}
try {
  let n;
  if (!process.argv.includes("--target-only")) {
    n = await load("e81bc3bd5fff");
    await n.getByRole("button", { name: "Fit board", exact: true }).waitFor();
    const hash = (
      await c.api("/games/" + c.windows[0].clone.game_id, undefined, "GET")
    ).hash;
    // Preserve an uncommitted Hand selection before keyboard-activating Board controls.
    await showPane(n, "hand", c.windows[0].config);
    await n
      .locator('[data-mobile-panel="hand"] [data-lab-card]')
      .first()
      .click();
    await n.keyboard.press("Escape");
    await n.keyboard.press("Escape");
    await n.getByRole("button", { name: "Focus Hanu", exact: true }).waitFor();
    const before = await camera(n);
    await n
      .getByRole("button", { name: "Focus Hanu", exact: true })
      .press("Enter");
    await n.locator('[aria-label="Focused hero"]').waitFor();
    assert.equal(
      (await camera(n)).k,
      before.k,
      "Inspection must not invoke the 250% centering command",
    );
    await n
      .getByRole("button", { name: "Show Arien", exact: true })
      .press("Space");
    await n
      .getByRole("button", {
        name: "Center Arien on Board at 250%",
        exact: true,
      })
      .click();
    await expectCentre(n, "Arien");
    assert.equal((await camera(n)).k, 2.5);
    await n
      .getByRole("button", { name: "Rotate board right", exact: true })
      .click();
    assert.equal((await camera(n)).angle, 90);
    await expectCentre(n, "Arien");
    const saved = await camera(n);
    await n.getByRole("button", { name: "Fit board", exact: true }).click();
    assert.equal((await camera(n)).angle, 90);
    await setCamera(n, saved, "2d");
    await expectCentre(n, "Arien");
    const cdp = await n.context().newCDPSession(n),
      centre = await centred(n, "Arien");
    const points = [
      { id: 1, x: centre.x - 35, y: centre.y },
      { id: 2, x: centre.x + 35, y: centre.y },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { ...points[0], y: centre.y - 15 },
        { ...points[1], y: centre.y + 15 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const touched = await camera(n);
    assert.ok(Math.abs(touched.k - (2.5 * Math.hypot(70, 30)) / 70) < 0.02);
    assert.ok(
      Math.abs(touched.angle - (90 + (Math.atan2(30, 70) * 180) / Math.PI)) <
        0.1,
    );
    await expectCentre(n, "Arien");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 3, x: centre.x, y: centre.y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 3, x: centre.x + 20, y: centre.y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await n
      .getByRole("button", {
        name: "Center Arien on Board at 250%",
        exact: true,
      })
      .click();
    for (const [profile, size] of [
      ["compact", { width: 360, height: 800 }],
      ["landscape", { width: 844, height: 390 }],
      ["portrait", { width: 390, height: 844 }],
    ]) {
      await n.setViewportSize(size);
      await c.windows[1].page.setViewportSize(size);
      await n.waitForTimeout(100);
      await expectCentre(n, "Arien");
      const targetPage = c.windows[1].page;
      // Start the legacy reference at this viewport instead of carrying its old
      // native pan plus userscript centering remainder through a resize.
      await targetPage.reload({ waitUntil: "domcontentloaded" });
      await c.ready(c.windows[1]);
      if (
        await targetPage
          .locator(".m2-summary-identity")
          .filter({ hasText: "Arien" })
          .count()
      )
        await targetPage
          .locator(".m2-summary-identity")
          .filter({ hasText: "Arien" })
          .first()
          .click();
      await targetPage.evaluate(
        (angle) => window.GOA2Mobile2D.__labRotation.set({ angle }),
        (await camera(n)).angle,
      );
      await targetPage.getByRole("button", { name: /^Show Arien/ }).dblclick();
      await targetPage.waitForTimeout(200);
      const report = await captureReport(c, [0, 1]);
      assert.equal(report.diverged, false);
      records.push({ profile, camera: await camera(n), ...report });
    }
    assert.equal(
      (await c.api("/games/" + c.windows[0].clone.game_id, undefined, "GET"))
        .hash,
      hash,
    );
    await n
      .getByRole("button", { name: "Reset board zoom, pan and rotation" })
      .click();
    assert.equal((await camera(n)).angle, 0);
    // Saved cameras without angle remain valid after the native camera extension.
    await setCamera(n, { mode: "2d", k: 1.5, x: 0, y: 0 }, "2d");
    assert.equal((await camera(n)).angle, 0);
    console.log(
      "M7 PASS focus, rotation, pinch, cancellation, orientation and camera restore",
    );
    n = await load("3536c730ea73", "hero_razzle");
    await n.getByRole("button", { name: "Focus Razzle", exact: true }).click();
    const focusHash = (
      await c.api("/games/" + c.windows[0].clone.game_id, undefined, "GET")
    ).hash;
    await n
      .getByRole("button", {
        name: "Center Razzle on Board at 250%",
        exact: true,
      })
      .click();
    await expectCentre(n, "Razzle");
    assert.equal((await camera(n)).k, 2.5);
    assert.equal(
      (await c.api("/games/" + c.windows[0].clone.game_id, undefined, "GET"))
        .hash,
      focusHash,
    );
    console.log("M7 PASS owned-piece focus");
  }
  // A separate clone exercises one real board target after a canceled gesture.
  n = await load("e6cf117c8910");
  await n
    .locator(
      '[aria-label="Game decision"] button:has(img[src="/icons/movement.png"])',
    )
    .first()
    .click();
  await n.getByRole("button", { name: "Confirm choice", exact: true }).click();
  await n.waitForFunction(() => {
    const r = window.__GOA2_LAB_STATE__.input_request;
    return (
      r?.valid_hexes?.length ||
      r?.valid_options?.some((v) => typeof v === "object" && v.q !== undefined)
    );
  });
  const old = await n.evaluate(
    () => window.__GOA2_LAB_STATE__.input_request.request_id,
  );
  await n
    .getByRole("button", { name: "Rotate board right", exact: true })
    .click();
  const target = await n.evaluate(() => {
    const svg = document.querySelector("svg[data-board-map]");
    const polygons = [...svg.querySelectorAll("polygon")].filter(
      (p) => p.getAttribute("stroke") === "#4caf50",
    );
    for (const p of polygons) {
      const m = p.parentElement.getScreenCTM();
      if (
        m &&
        m.e > 0 &&
        m.e < innerWidth &&
        m.f > 0 &&
        m.f < innerHeight &&
        p.parentElement.contains(document.elementFromPoint(m.e, m.f))
      )
        return { x: m.e, y: m.f };
    }
    return null;
  });
  assert.ok(target, "A visible valid target is required");
  await n.mouse.move(target.x, target.y);
  await n.mouse.down();
  await n.mouse.move(target.x + 25, target.y + 10);
  await n.mouse.up();
  assert.equal(
    await n.evaluate(() => window.__GOA2_LAB_STATE__.input_request.request_id),
    old,
    "Pan must not select a target",
  );
  await n.getByRole("button", { name: "Fit board", exact: true }).click();
  const tap = await n.evaluate(() => {
    const svg = document.querySelector("svg[data-board-map]");
    for (const p of svg.querySelectorAll('polygon[stroke="#4caf50"]')) {
      const m = p.parentElement.getScreenCTM();
      if (
        m &&
        m.e > 0 &&
        m.e < innerWidth &&
        m.f > 0 &&
        m.f < innerHeight &&
        p.parentElement.contains(document.elementFromPoint(m.e, m.f))
      )
        return { x: m.e, y: m.f };
    }
    return null;
  });
  assert.ok(tap);
  await n.touchscreen.tap(tap.x, tap.y);
  await n.waitForFunction(
    (old) => window.__GOA2_LAB_STATE__.input_request?.request_id !== old,
    old,
  );
  console.log("M7 PASS valid board target after gesture");
  for (const w of c.windows) assert.deepEqual(w.errors, []);
  await fs.writeFile(
    out + "/results.json",
    JSON.stringify(
      {
        workingTree: true,
        records,
        checks: process.argv.includes("--target-only")
          ? ["target after gesture"]
          : [
              "keyboard focus",
              "separate centering",
              "rotation",
              "pinch",
              "cancel",
              "orientation",
              "camera save/restore",
              "owned piece",
              "target after gesture",
            ],
      },
      null,
      2,
    ),
  );
  console.log("M7 evidence:", out);
} catch (error) {
  for (const [i, w] of c.windows.entries()) {
    await w.page
      .screenshot({ path: out + "/failure-" + i + ".png" })
      .catch(() => {});
    console.error("Render errors", i, w.errors);
  }
  throw error;
} finally {
  await desk.close();
}
