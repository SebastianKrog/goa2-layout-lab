import { Synchronizer } from "./synchronize.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  PROFILES,
  DATA,
  gameURL,
  validateSlots,
  slotsForSituation,
} from "./config.mjs";
import { instrumentScript } from "./instrument.mjs";
import { delay } from "./services.mjs";
import {
  capturePresentation,
  restorePresentation,
  setCamera,
  showPane,
  inspectHero,
} from "./presentation.mjs";

export class Comparison {
  constructor(services, api, options = {}) {
    this.services = services;
    this.api = api;
    this.options = options;
    this.windows = [];
    this.situationId = null;
    this.scriptInfo = null;
    this.sync = new Synchronizer(this);
  }
  async launch() {
    if (this.options.native) {
      const { NativeDesktop } = await import("./desktop/driver.mjs");
      this.desktop = new NativeDesktop({ userData: this.options.userData });
      await this.desktop.launch();
      this.browser = this.desktop;
      return;
    }
    try {
      this.browser = await chromium.launch({
        headless: !!this.options.headless,
        args: [
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
        ],
      });
    } catch (error) {
      if (
        process.platform === "linux" &&
        /loading shared libraries|Host system is missing dependencies/.test(
          error.message,
        )
      )
        throw new Error(
          "Chromium needs Linux system libraries. Run: node node_modules/playwright/cli.js install-deps chromium (may require sudo).",
          { cause: error },
        );
      if (
        process.platform === "linux" &&
        /Missing X server|without having a XServer|\$DISPLAY/.test(
          error.message,
        )
      )
        throw new Error(
          "Headed Chromium needs a Linux display (desktop, WSLg or X forwarding). For a server use: npm run compare -- --headless --no-open",
          { cause: error },
        );
      throw error;
    }
  }
  async open(
    config,
    presentation,
    existingClone = null,
    slotIndex,
    situation = null,
  ) {
    if (presentation?.render && presentation.render !== config.render)
      presentation = presentation.modes?.[config.render];
    const port = await this.services.frontend(config.source);
    const clone =
      existingClone ||
      (await this.api("/clone", {
        situation_id: situation?.id || this.situationId,
        ...(situation ? { situation } : {}),
        human_seat: this.manualSeat(config, situation),
        bots: config.bots || {},
      }));
    const profile = PROFILES[config.profile];
    const context = await this.browser.newContext({
      ...profile,
      screen: profile.viewport,
      locale: "en-GB",
      timezoneId: "Europe/Copenhagen",
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const win = {
      config: { ...config },
      situation,
      initialPresentation: presentation,
      clone,
      context,
      page,
      warnings: [],
      errors: [],
      assets: [],
      views: {},
      broken: false,
    };
    try {
      await page.clock.setFixedTime(1792238400000);
      await page.addInitScript(
        ({ storage, oldPath, newPath }) => {
          for (let [key, value] of Object.entries(storage || {})) {
            if (oldPath) key = key.replaceAll(oldPath, newPath);
            if (localStorage.getItem(key) === null)
              localStorage.setItem(key, value);
          }
          const Original = window.WebSocket;
          window.addEventListener("keydown", (e) => {
            if (e.key === "Alt") window.__GOA2_LAB_ALT__ = true;
          });
          window.addEventListener("keyup", (e) => {
            if (e.key === "Alt") window.__GOA2_LAB_ALT__ = false;
          });
          window.addEventListener("blur", () => {
            window.__GOA2_LAB_ALT__ = false;
          });
          window.WebSocket = class extends Original {
            constructor(...args) {
              super(...args);
              this.addEventListener("message", (event) => {
                try {
                  const value = JSON.parse(event.data);
                  if (value.type === "STATE_UPDATE")
                    window.__GOA2_LAB_STATE__ = value;
                  if (value.type === "update")
                    window.__GOA2_LAB_HMR_UPDATES__ =
                      (window.__GOA2_LAB_HMR_UPDATES__ || 0) + 1;
                } catch {
                  /* Vite and binary messages are not game state. */
                }
              });
            }
          };
        },
        {
          storage: presentation?.storage || {},
          oldPath: presentation?.gamePath,
          newPath: `/game/${clone.game_id}`,
        },
      );
      await this.sync.attach(win);
      await this.reporter?.attach(win);
      page.on("pageerror", (error) => win.errors.push(error.message));
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          win.errors = [];
          win.assets = [];
        }
      });
      page.on("response", (response) => {
        const resource = response.request().resourceType();
        if (response.ok())
          win.assets = win.assets.filter(
            (failure) => !failure.endsWith(response.url()),
          );
        if (
          response.status() >= 400 &&
          (["image", "font"].includes(resource) ||
            /\.glb(?:\?|$)/.test(response.url()))
        )
          win.assets.push(`${response.status()} ${response.url()}`);
      });
      page.on("requestfailed", (request) => {
        if (request.failure()?.errorText === "net::ERR_ABORTED") return;
        if (
          ["image", "font"].includes(request.resourceType()) ||
          /\.glb(?:\?|$)/.test(request.url())
        )
          win.assets.push(`${request.failure()?.errorText} ${request.url()}`);
      });
      if (config.source === "target") {
        if (
          !this.scriptInfo ||
          this.scriptInfo.revision !== this.services.references.script
        )
          this.scriptInfo = await this.services.script();
        const code = instrumentScript(this.scriptInfo.content);
        page.on("domcontentloaded", async () => {
          try {
            if (!page.url().includes("/game/")) return;
            await page.waitForSelector('[class*="sidebar"]', {
              timeout: 30_000,
            });
            await page.addScriptTag({ content: code });
          } catch (e) {
            win.errors.push(`Userscript injection: ${e.message}`);
          }
        });
      }
      await page.goto(gameURL(port, clone, config), {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await this.ready(win);
      win.warnings = await restorePresentation(page, presentation, config);
      await page.evaluate(
        (title) => {
          document.title = title;
        },
        `${config.label || config.source} Â· ${config.render.toUpperCase()} Â· ${config.seat} â€” GoA2 comparison`,
      );
      if (!this.options.headless && !this.desktop) {
        const session = await context.newCDPSession(page);
        try {
          const { windowId } = await session.send("Browser.getWindowForTarget");
          const existingIndex = this.windows.findIndex(
            (w) => w.clone.game_id === clone.game_id,
          );
          const index =
            slotIndex ??
            (existingIndex < 0 ? this.windows.length : existingIndex);
          await session.send("Browser.setWindowBounds", {
            windowId,
            bounds: {
              left:
                config.profile === "desktop"
                  ? 40 + index * 75
                  : 20 + index * 480,
              top: 60,
              width: Math.max(460, profile.viewport.width + 18),
              height: Math.min(1040, profile.viewport.height + 100),
            },
          });
        } finally {
          await session.detach();
        }
      }
      win.views[config.render] =
        presentation || (await capturePresentation(page, config.render));
      this.sync.snapshots.set(
        win,
        await capturePresentation(page, config.render),
      );
      return win;
    } catch (error) {
      const diagnostics = await page
        .evaluate(() => ({
          phase: window.__GOA2_LAB_STATE__?.view?.phase,
          bridges: Object.keys(window.__GOA2_LAB_BRIDGE__ || {}),
          text: document.body?.innerText.slice(0, 1800),
        }))
        .catch(() => ({}));
      await fs.writeFile(
        path.join(DATA, "runtime", `failed-${config.source}.json`),
        JSON.stringify(
          {
            error: error.message,
            diagnostics,
            errors: win.errors,
            assets: win.assets,
          },
          null,
          2,
        ),
      );
      await page
        .screenshot({
          path: path.join(DATA, "runtime", `failed-${config.source}.png`),
        })
        .catch(() => {});
      await context.close();
      if (!existingClone)
        await this.api(`/games/${clone.game_id}`, undefined, "DELETE").catch(
          () => {},
        );
      throw error;
    }
  }
  async ready(win) {
    const { page, config } = win;
    await page
      .waitForFunction(() => !!window.__GOA2_LAB_STATE__?.view, null, {
        timeout: 90_000,
      })
      .catch((e) => {
        throw new Error(
          `Game state did not arrive for ${config.source}: ${e.message} ${win.errors.join("; ")}`,
        );
      });
    if (
      config.layout === "mobile" &&
      !(await page.locator("[data-pane]").count())
    )
      throw new Error(
        "Unavailable in this version: native mobile shell. Select the desktop UI for this comparator commit.",
      );
    await page
      .waitForFunction(
        (mode) => {
          const bridge =
            window.__GOA2_LAB_BRIDGE__?.[
              mode === "3d" ? "camera3d" : "camera2d"
            ];
          const camera = bridge?.get();
          return camera && (mode !== "3d" || camera.target);
        },
        config.render,
        { timeout: 90_000 },
      )
      .catch((e) => {
        throw new Error(
          `${config.render} camera bridge did not initialize for ${config.source}: ${e.message} ${win.errors.join("; ")}`,
        );
      });
    if (config.source === "target" && config.profile !== "desktop") {
      await page.waitForFunction(
        () => document.documentElement.hasAttribute("data-m2-active"),
        null,
        { timeout: 30_000 },
      );
    }
    if (config.render === "3d") {
      await page.waitForSelector("canvas", {
        state: "visible",
        timeout: 60_000,
      });
      const lost = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        const gl = c?.getContext("webgl2") || c?.getContext("webgl");
        return !gl || gl.isContextLost();
      });
      if (lost)
        throw new Error("WebGL is unavailable or its context was lost.");
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle", { timeout: 60_000 });
  }
  async load(situationId, configs, presentations = {}, savedSituation = null) {
    // Resolve the roster before closing an existing comparison. This also
    // repairs old drafts/presets that still refer to a different game's hero.
    validateSlots(configs);
    const situation =
      savedSituation ||
      (await this.api(
        `/situations/${encodeURIComponent(situationId)}`,
        undefined,
        "GET",
      ));
    if (!situation) throw new Error("Choose a saved situation.");
    const slots = slotsForSituation(configs, situation);
    if (slots.some((s) => Object.keys(s.bots || {}).length)) {
      const health = await this.api("/health", undefined, "GET");
      if (
        slots.some((s) =>
          Object.values(s.bots || {}).some(
            (kind) => !health.bot_kinds?.includes(kind),
          ),
        )
      )
        throw new Error(
          "This backend has no requested bots. Configure the bots backend checkout.",
        );
    }
    if (
      this.sync.mode !== "none" &&
      (slots.length === 1 ||
        slots.some((s) => Object.keys(s.bots || {}).length))
    )
      await this.sync.setMode("none");
    await this.clear();
    this.situationId = situationId;
    this.heroIds = Object.values(situation.checkpoint.state.teams).flatMap(
      (t) => t.heroes.map((h) => h.id),
    );
    // Wait for every attempt before cleanup, so a slower successful view cannot
    // leak its context/clone after another view fails. Keep configured slot order.
    const opened = await Promise.allSettled(
      slots.map((slot, i) =>
        this.open(slot, presentations[i], null, i, situation),
      ),
    );
    this.windows = opened
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
    const failed = opened.findIndex((r) => r.status === "rejected");
    if (failed >= 0) {
      await this.clear();
      throw new Error(`View ${failed + 1}: ${opened[failed].reason.message}`, {
        cause: opened[failed].reason,
      });
    }
    const required = new Set(
      slots.map((s) => (s.source === "target" ? "base" : s.source)),
    );
    for (const key of ["base", "comparator", "live"])
      if (!required.has(key)) await this.services.stop(key);
    return this.status();
  }
  async closeWindow(win) {
    await win.context.close().catch(() => {});
    await this.api(`/games/${win.clone.game_id}`, undefined, "DELETE").catch(
      () => {},
    );
  }
  async clear() {
    await Promise.all(this.windows.map((win) => this.closeWindow(win)));
    this.windows = [];
  }
  async reset(index) {
    const indexes =
      index === undefined ? this.windows.map((_, i) => i) : [index];
    for (const i of indexes) {
      const old = this.window(i);
      await this.closeWindow(old);
      this.windows[i] = await this.open(
        old.config,
        old.initialPresentation,
        null,
        i,
        old.situation,
      );
    }
    return this.status();
  }
  window(index) {
    const win = this.windows[index];
    if (!win) throw new Error("Comparison window not found.");
    return win;
  }
  async configure(index, update, restoreSaved = true) {
    const old = this.window(index);
    const current = old.page.isClosed()
      ? old.views[old.config.render]
      : await capturePresentation(old.page, old.config.render);
    old.views[old.config.render] = current;
    const config = { ...old.config, ...update };
    validateSlots([config]);
    const botsChanged =
      JSON.stringify(config.bots || {}) !==
      JSON.stringify(old.config.bots || {});
    if (botsChanged) {
      if (Object.keys(config.bots || {}).length)
        await this.sync.setMode("none");
      await this.api("/bots", {
        game_id: old.clone.game_id,
        human_seat: this.manualSeat(config, old.situation),
        bots: config.bots || {},
      });
      // Keep controller metadata accurate even if reopening the renderer fails.
      old.config.bots = config.bots;
    }
    const withoutBots = ({ bots, autoSwitch, ...rest }) => rest;
    if (
      !old.page.isClosed() &&
      JSON.stringify(withoutBots(config)) ===
        JSON.stringify(withoutBots(old.config))
    ) {
      old.config = config;
      return this.status();
    }
    await old.context.close().catch(() => {});
    const presentation = restoreSaved ? old.views[config.render] : null;
    const win = await this.open(
      config,
      presentation,
      old.clone,
      index,
      old.situation,
    );
    win.views = { ...old.views, [config.render]: presentation };
    win.initialPresentation = old.initialPresentation;
    this.windows[index] = win;
    return this.status();
  }
  manualSeat(config, situation = null) {
    return (
      (situation
        ? Object.values(situation.checkpoint.state.teams).flatMap((t) =>
            t.heroes.map((h) => h.id),
          )
        : this.heroIds || Object.keys(this.windows[0]?.clone.seats || {})
      ).find((id) => !config.bots?.[id]) || config.seat
    );
  }
  async switchSeat(index, seat) {
    const win = this.window(index);
    if (!win.clone.seats[seat]) return;
    const presentation = await capturePresentation(win.page, win.config.render);
    const url = new URL(win.page.url());
    url.searchParams.set("token", win.clone.seats[seat]);
    // Reuse the page/context and its assets; do not clone/reset the game or
    // carry the old player's private card selection into the new viewpoint.
    win.config = { ...win.config, seat };
    await win.page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await this.ready(win);
    win.warnings = await restorePresentation(
      win.page,
      {
        render: win.config.render,
        camera: presentation.camera,
      },
      win.config,
    );
  }
  async followDecisions(
    switcher = (index, seat) => this.switchSeat(index, seat),
  ) {
    for (const [index, win] of this.windows.entries()) {
      if (!win.config.autoSwitch || win.page.isClosed()) continue;
      try {
        const { players } = await this.api(
          `/games/${win.clone.game_id}/responders`,
          undefined,
          "GET",
        );
        const eligible = players.filter((id) => win.clone.seats[id]);
        // Stable while the same hero still owes a choice, including multiple
        // inputs in an action and concurrent/team decisions.
        if (!eligible.length || eligible.includes(win.config.seat)) continue;
        await switcher(index, eligible[0]);
      } catch (error) {
        win.config.autoSwitch = false;
        win.warnings.push("Auto switch stopped: " + error.message);
      }
    }
  }
  async save(index, name) {
    const source = this.window(index);
    return this.api("/capture", {
      game_id: source.clone.game_id,
      name,
      provenance: { kind: "capture", source_situation: source.situation?.id },
    });
  }
  async addView({ config, situationId, fromIndex = 0, index }) {
    if (index === undefined && this.windows.length >= 3)
      throw new Error("The desk supports up to three views.");
    if (index !== undefined) this.window(index);
    let situation, presentation;
    if (situationId) {
      situation = await this.api(
        `/situations/${encodeURIComponent(situationId)}`,
        undefined,
        "GET",
      );
    } else {
      const source = this.window(fromIndex);
      const captured = await this.api(
        `/games/${source.clone.game_id}/checkpoint`,
        undefined,
        "GET",
      );
      situation = captured.situation;
      situation.id = source.situation?.id || situation.id;
      situation.name = (source.situation?.name || "Game") + " (current state)";
      presentation = await capturePresentation(
        source.page,
        source.config.render,
      );
    }
    const [resolved] = slotsForSituation([config], situation);
    if (Object.keys(resolved.bots || {}).length)
      await this.sync.setMode("none");
    const destination = index ?? this.windows.length;
    const win = await this.open(
      resolved,
      presentation,
      null,
      destination,
      situation,
    );
    if (index !== undefined) await this.closeWindow(this.windows[index]);
    this.windows[destination] = win;
    this.situationId = this.windows[0].situation?.id;
    return this.status();
  }
  async removeView(index) {
    const win = this.window(index);
    await this.closeWindow(win);
    this.windows.splice(index, 1);
    if (this.windows.length < 2) await this.sync.setMode("none");
    this.situationId = this.windows[0]?.situation?.id || null;
    return this.status();
  }
  async cameraCopy(from, indexes) {
    const source = this.window(from);
    const value = await capturePresentation(source.page, source.config.render);
    for (const i of indexes) {
      if (i === from) continue;
      const dest = this.window(i);
      if (dest.config.render !== source.config.render)
        throw new Error("Camera copy requires matching render modes.");
      await setCamera(dest.page, value.camera, dest.config.render);
    }
    return this.status();
  }
  async pane(index, pane) {
    const win = this.window(index);
    await showPane(win.page, pane, win.config);
    return this.status();
  }
  async hero(index, heroId) {
    const win = this.window(index);
    await inspectHero(win.page, heroId);
    return this.status();
  }
  status() {
    return {
      synchronization: this.sync.status(),
      display: this.desktop
        ? "native"
        : this.options.headless
          ? "browser"
          : "windows",
      situationId: this.situationId,
      references: this.services.references,
      comparator: this.services.comparator,
      runtime: {
        mode: this.services.mode,
        platform: process.platform,
        arch: process.arch,
      },
      script:
        this.windows.some((w) => w.config.source === "target") &&
        this.scriptInfo
          ? {
              checksum: this.scriptInfo.checksum,
              revision: this.scriptInfo.revision,
            }
          : null,
      windows: this.windows.map((w, index) => ({
        index,
        config: w.config,
        situationId: w.situation?.id || this.situationId,
        situationName: w.situation?.name,
        gameId: w.clone.game_id,
        nativeId: w.context?.nativeId,
        closed: w.page.isClosed?.() || false,
        seats: Object.keys(w.clone.seats),
        warnings: w.warnings,
        errors: w.errors,
        assets: w.assets,
        url: w.page.url().replace(/token=[^&]+/, "token=[private]"),
      })),
      services: this.services.status(),
    };
  }
  async close() {
    await this.clear();
    await this.browser?.close();
  }
}
