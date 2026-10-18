import { delay } from "./services.mjs";

async function clickControl(page, control) {
  if (page.__labNative || page.__labSyncReplaying)
    return control.evaluate((element) => element.click());
  return control.click();
}

// These adapters perform presentation actions only. They never replay a
// generic click trace, which could accidentally commit a card or submit input.
export async function capturePresentation(page, render) {
  return page.evaluate((render) => {
    const root = document.documentElement;
    const selected = document.querySelector('[data-pane][aria-pressed="true"]');
    const script = !!window.GOA2Mobile2D;
    const deckOpen = [...document.querySelectorAll("[data-lab-deck]")].some(
      (e) => e.checkVisibility(),
    );
    const logOpen = !!document.querySelector(
      '[data-lab-log="floating"] button[aria-expanded="true"]',
    );
    const rawPane = script
      ? root.hasAttribute("data-m2-deck-open")
        ? "deck"
        : root.dataset.m2Panel || root.dataset.m2Mode || "board"
      : selected?.dataset.pane ||
        (deckOpen ? "deck" : logOpen ? "log" : "board");
    const pane = rawPane === "tools" ? "settings" : rawPane;
    const storage = {};
    for (const key of Object.keys(localStorage)) {
      if (
        /^goa2[.:-]/i.test(key) &&
        !/token|auth|credential|spectator/i.test(key)
      )
        storage[key] = localStorage.getItem(key);
    }
    const scroll = [...document.querySelectorAll("*")]
      .filter((e) => e.scrollTop || e.scrollLeft)
      .map((e) => ({
        id: e.id || null,
        className: typeof e.className === "string" ? e.className : null,
        top: e.scrollTop,
        left: e.scrollLeft,
      }))
      .filter((s) => s.id || s.className)
      .slice(0, 40);
    const hovered = [...document.querySelectorAll("[data-lab-card]")].find(
      (e) => e.matches(":hover") || e.hasAttribute("data-lab-hover"),
    );
    const selectedCard = document.querySelector(
      "[data-lab-card][data-lab-selected]",
    );
    return {
      render,
      pane,
      storage,
      gamePath: location.pathname,
      scroll,
      windowScroll: { x: scrollX, y: scrollY },
      camera:
        window.__GOA2_LAB_BRIDGE__?.[
          render === "3d" ? "camera3d" : "camera2d"
        ]?.get(),
      rotation: window.GOA2Mobile2D?.__labRotation?.get(),
      inspection3d: window.__GOA2_LAB_BRIDGE__?.inspection3d?.get(),
      inspectionScript: window.GOA2Mobile2D?.__labInspection?.get(),
      inspectionMobile:
        document.querySelector("[data-lab-mobile-inspection]")?.dataset
          .labMobileInspection || null,
      inspectedCard: hovered?.dataset.labCard || null,
      altHeld: !!window.__GOA2_LAB_ALT__,
      selectedCard: selectedCard?.dataset.labCard || null,
      inspectedHero: window.__GOA2_LAB_INSPECTED_HERO__ || null,
      deckOpen,
    };
  }, render);
}

export async function showPane(page, pane, config) {
  if (!["board", "heroes", "hand", "deck", "log", "settings"].includes(pane))
    throw new Error("Unknown pane.");
  const kind =
    config.source === "target"
      ? "script"
      : config.layout === "mobile"
        ? "mobile"
        : "desktop";
  if (kind === "mobile") {
    const selected = page.locator('[data-pane][aria-pressed="true"]');
    const active = (await selected.count())
      ? await selected.getAttribute("data-pane")
      : null;
    if (pane === "board") {
      if (active)
        await clickControl(page, page.locator(`[data-pane="${active}"]`));
    } else if (active !== pane)
      await clickControl(page, page.locator(`[data-pane="${pane}"]`));
    // React Router mounts panels asynchronously after the navigation click.
    await page.waitForFunction(
      (pane) =>
        (document.querySelector('[data-pane][aria-pressed="true"]')?.dataset
          .pane || "board") === pane,
      pane,
      { timeout: 5000 },
    );
    return;
  }
  if (kind === "script") {
    const activeScript = await page.evaluate(() =>
      document.documentElement.hasAttribute("data-m2-active"),
    );
    if (!activeScript) {
      if (pane === "board") return;
      throw new Error(`Unavailable on this viewport: userscript ${pane}`);
    }
    const state = await page.evaluate(() => ({
      deck: document.documentElement.hasAttribute("data-m2-deck-open"),
      mode:
        document.documentElement.dataset.m2Panel ||
        document.documentElement.dataset.m2Mode ||
        "board",
    }));
    const active = state.deck
      ? "deck"
      : state.mode === "tools"
        ? "settings"
        : state.mode;
    if (active === pane) return;
    const mode = pane === "settings" ? "tools" : pane;
    if (pane === "board") {
      const previous = active === "settings" ? "tools" : active;
      const control = page.locator(`[data-mode="${previous}"]`).first();
      if (await control.count()) await clickControl(page, control);
      else throw new Error("Unavailable in this version: return to Board");
    } else {
      const control = page.locator(`[data-mode="${mode}"]`).first();
      if (!(await control.count()))
        throw new Error(`Unavailable in this version: ${pane}`);
      await clickControl(page, control);
    }
    return;
  }
  if (pane === "board") {
    await page.keyboard.press("Escape");
    const openLog = page.locator(
      '[data-lab-log="floating"] button[aria-expanded="true"]',
    );
    if (await openLog.count()) await clickControl(page, openLog);
    return;
  }
  if (pane === "log") {
    const toggle = page.locator('[data-lab-log="floating"] button');
    if (!(await toggle.count()))
      throw new Error("Unavailable in this version: Log");
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await clickControl(page, toggle);
    return;
  }
  if (pane === "deck") {
    const button = page.getByRole("button", { name: /View Deck/i }).first();
    if (!(await button.count()))
      throw new Error("Unavailable in this version/viewpoint: Deck");
    await clickControl(page, button);
    return;
  }
  const selector =
    pane === "heroes"
      ? "[data-lab-hero]"
      : pane === "hand"
        ? "[data-lab-card]"
        : pane === "log"
          ? '[class*="EventLog_"]'
          : null;
  if (selector && (await page.locator(selector).count())) {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    return;
  }
  throw new Error(`Unavailable in this version: ${pane} panel`);
}

export async function restorePresentation(page, value, config) {
  if (!value) return [];
  const warnings = [];
  const attempt = async (name, action) => {
    try {
      await action();
    } catch (e) {
      warnings.push(`${name}: ${e.message}`);
    }
  };
  await attempt("Pane", () =>
    showPane(page, value.pane || (value.deckOpen ? "deck" : "board"), config),
  );
  if (value.altHeld) await page.keyboard.down("Alt");
  if (value.inspectionScript && config.source === "target")
    await attempt("Userscript inspection", () =>
      page.evaluate((v) => {
        if (!window.GOA2Mobile2D?.__labInspection)
          throw new Error("Unavailable in this version");
        window.GOA2Mobile2D.__labInspection.set(v);
      }, value.inspectionScript),
    );
  if (value.selectedCard)
    await attempt("Selected card", async () => {
      // Only planning hand selection is safe to restore. Never click card choices.
      const safe = await page.evaluate((id) => {
        const state = window.__GOA2_LAB_STATE__;
        return (
          state?.view?.phase === "PLANNING" &&
          Object.values(state.view.teams)
            .flatMap((t) => t.heroes)
            .some(
              (h) => Array.isArray(h.hand) && h.hand.some((c) => c.id === id),
            )
        );
      }, value.selectedCard);
      if (!safe) throw new Error("Unavailable at this decision");
      if (config.layout === "mobile") await showPane(page, "hand", config);
      const target = page
        .locator(`[data-lab-card=${JSON.stringify(value.selectedCard)}]:visible`)
        .first();
      await target.waitFor({ state: "visible", timeout: 5000 }).catch(() => {
        throw new Error("Card is absent from this layout");
      });
      await clickControl(page, target);
      if (config.layout === "mobile" && value.pane && value.pane !== "hand")
        await showPane(page, value.pane, config);
    });
  if (value.inspectedCard)
    await attempt("Card inspection", async () => {
      const card = page
        .locator(
          `[data-lab-card=${JSON.stringify(value.inspectedCard)}]:visible`,
        )
        .first();
      if (!(await card.count())) throw new Error("Unavailable in this version");
      if (page.__labNative)
        await card.evaluate((e) => {
          document
            .querySelectorAll("[data-lab-hover]")
            .forEach((n) => n.removeAttribute("data-lab-hover"));
          e.dataset.labHover = "true";
          e.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
      else await card.hover();
    });
  if (value.inspectedHero)
    await attempt("Hero inspection", () =>
      inspectHero(page, value.inspectedHero),
    );
  if (value.camera)
    await attempt("Camera", () => setCamera(page, value.camera, config.render));
  if (value.inspection3d && config.render === "3d")
    await attempt("3D inspection", async () => {
      await page.evaluate((v) => {
        const bridge = window.__GOA2_LAB_BRIDGE__?.inspection3d;
        if (!bridge) throw new Error("3D inspection is not ready");
        bridge.set(v);
      }, value.inspection3d);
      if (value.inspection3d.altHeld) await page.keyboard.down("Alt");
    });
  if (value.rotation && config.source === "target")
    await attempt("Board rotation", () =>
      page.evaluate((v) => {
        if (!window.GOA2Mobile2D?.__labRotation)
          throw new Error("Unavailable in this version");
        window.GOA2Mobile2D.__labRotation.set(v);
      }, value.rotation),
    );
  if (value.inspectionMobile && config.layout === "mobile")
    await attempt("Mobile inspection", async () => {
      const target = page
        .locator(
          `[data-lab-inspect-card=${JSON.stringify(value.inspectionMobile)}]:visible`,
        )
        .first();
      if (!(await target.count()))
        throw new Error("Card absent from this pane/player-scoped view");
      await clickControl(page, target);
      await page
        .locator("[data-lab-mobile-inspection]")
        .waitFor({ state: "visible", timeout: 5000 });
    });
  await page.evaluate((v) => {
    for (const s of v.scroll || []) {
      const e = s.id
        ? document.getElementById(s.id)
        : [...document.querySelectorAll("*")].find(
            (e) =>
              typeof e.className === "string" && e.className === s.className,
          );
      if (e) {
        e.scrollTop = s.top;
        e.scrollLeft = s.left;
      }
    }
    if (v.windowScroll) window.scrollTo(v.windowScroll.x, v.windowScroll.y);
  }, value);
  await delay(150);
  return warnings;
}

export async function inspectHero(page, heroId) {
  const is3D = await page.evaluate(
    () => !!window.__GOA2_LAB_BRIDGE__?.inspection3d,
  );
  if (is3D) {
    await page.evaluate(
      (heroId) => window.__GOA2_LAB_BRIDGE__.inspection3d.set({ heroId }),
      heroId,
    );
    return;
  }
  const hero = page
    .locator(`[data-lab-hero=${JSON.stringify(heroId)}]`)
    .first();
  if (!(await hero.count()))
    throw new Error("Unavailable in this version/viewpoint: hero inspection");
  await hero.scrollIntoViewIfNeeded();
  await page.evaluate((id) => {
    window.__GOA2_LAB_INSPECTED_HERO__ = id;
  }, heroId);
}

export async function setCamera(page, camera, render) {
  if (camera.mode !== render)
    throw new Error("Camera copy requires matching 2D/3D render modes.");
  await page.evaluate((v) => {
    const bridge =
      window.__GOA2_LAB_BRIDGE__?.[v.mode === "3d" ? "camera3d" : "camera2d"];
    if (!bridge) throw new Error("Camera is not ready");
    bridge.set(v);
  }, camera);
  await delay(250);
  const actual = await page.evaluate(
    (mode) =>
      window.__GOA2_LAB_BRIDGE__?.[
        mode === "3d" ? "camera3d" : "camera2d"
      ]?.get(),
    render,
  );
  const numbers = (v) =>
    Object.values(v).flatMap((n) =>
      Array.isArray(n) ? n : typeof n === "number" ? [n] : [],
    );
  const expected = numbers(camera),
    got = numbers(actual || {});
  if (
    expected.length !== got.length ||
    expected.some((n, i) => Math.abs(n - got[i]) > 0.015)
  )
    throw new Error(
      "Camera restore did not settle at the requested viewpoint (possibly clamped).",
    );
}
