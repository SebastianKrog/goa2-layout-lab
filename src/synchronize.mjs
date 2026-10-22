import { capturePresentation, showPane, inspectHero } from "./presentation.mjs";
export const ACTIONS = [
  "SUBMIT_INPUT",
  "COMMIT_CARD",
  "UNCOMMIT_CARD",
  "PASS_TURN",
  "FINISH_PLANNING",
  "ROLLBACK",
  "CHEATS_GOLD",
  "SET_READY",
  "STARTING_POSITION",
  "PROPOSE_OVERRIDE",
  "VOTE_OVERRIDE",
  "CANCEL_OVERRIDE",
];
export function installBridge({ mode, cheats, actions }) {
  const bridge = (window.__GOA2_LAB_SYNC__ = {
    mode,
    replaying: false,
    cheats,
    sockets: new Set(),
  });
  const applyCheats = () => {
    document.documentElement?.toggleAttribute(
      "data-lab-show-cheats",
      bridge.cheats,
    );
    if (!document.getElementById("lab-cheats-visibility")) {
      const style = document.createElement("style");
      style.id = "lab-cheats-visibility";
      style.textContent =
        ':root:not([data-lab-show-cheats]) [data-lab-cheats],:root:not([data-lab-show-cheats]) [class*="cheatPanel"]{display:none!important}';
      (document.head || document.documentElement)?.append(style);
    }
  };
  bridge.applyCheats = applyCheats;
  document.addEventListener("DOMContentLoaded", applyCheats);
  if (document.documentElement) applyCheats();
  const Original = window.WebSocket;
  window.WebSocket = class extends Original {
    constructor(...args) {
      super(...args);
      if (
        new URL(this.url, location.href).pathname.match(
          /(?:^|\/)games\/[^/]+\/ws$/,
        )
      )
        bridge.sockets.add(this);
      this.addEventListener("close", () => bridge.sockets.delete(this));
    }
    send(raw) {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return super.send(raw);
      }
      if (
        bridge.sockets.has(this) &&
        actions.includes(message.type) &&
        bridge.mode !== "none"
      ) {
        if (bridge.replaying && !bridge.humanGesture) return;
        void window
          .__labSyncEvent({ kind: "action", message, clickId: bridge.clickId })
          .catch((error) => bridge.reject(message, error.message));
        return;
      }
      return super.send(raw);
    }
  };
  bridge.reject = (message, detail) => {
    for (const ws of bridge.sockets)
      ws.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "ERROR",
            detail,
            client_action_id: message.client_action_id,
          }),
        }),
      );
  };
  for (const type of ["click", "change", "keydown"])
    document.addEventListener(
      type,
      (event) => {
        if (event.isTrusted) {
          bridge.humanGesture = true;
          setTimeout(() => {
            bridge.humanGesture = false;
          }, 0);
        }
      },
      true,
    );
  let sequence = 0;
  function capture(event) {
    if (!event.isTrusted || bridge.mode !== "api-clicks") return;
    const node = event.target.closest?.(
      '[data-lab-card],[data-pane],button,[role="button"],input,select',
    );
    if (!node) return;
    const clickId = ++sequence;
    bridge.clickId = clickId;
    setTimeout(() => {
      if (bridge.clickId === clickId) bridge.clickId = null;
    }, 0);
    setTimeout(() => {
      const descriptor = {
        card: node.dataset.labCard || null,
        pane: node.dataset.pane || null,
        label: node.getAttribute("aria-label") || "",
        title: node.title || "",
        text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 200),
        tag: node.tagName,
        type: node.type || "",
        value: node.value,
        checked: node.checked,
      };
      void window
        .__labSyncEvent({ kind: "click", clickId, descriptor })
        .catch(() => {});
    }, 180);
  }
  document.addEventListener("click", capture, true);
  document.addEventListener("change", capture, true);
}
export class Synchronizer {
  constructor(comparison) {
    this.comparison = comparison;
    this.mode = "none";
    this.cheats = false;
    this.error = null;
    this.skipped = 0;
    this.pending = 0;
    this.queue = Promise.resolve();
    this.actionClicks = new Set();
    this.snapshots = new WeakMap();
    this.busy = () => false;
  }
  status() {
    return {
      mode: this.mode,
      cheats: this.cheats,
      pending: this.pending,
      error: this.error,
      skipped: this.skipped,
    };
  }
  async attach(win) {
    await win.page.exposeBinding("__labSyncEvent", (_, event) =>
      this.receive(win, event),
    );
    await win.page.addInitScript(installBridge, {
      mode: this.mode,
      cheats: this.cheats,
      actions: ACTIONS,
    });
  }
  async updateBridges() {
    await Promise.all(
      this.comparison.windows
        .filter((w) => !w.page.isClosed())
        .map((w) =>
          w.page.evaluate(({ mode, cheats }) => {
            const b = window.__GOA2_LAB_SYNC__;
            if (b) {
              b.mode = mode;
              b.cheats = cheats;
              b.applyCheats();
            }
          }, this.status()),
        ),
    );
  }
  async setMode(mode) {
    if (!["none", "api", "api-clicks"].includes(mode))
      throw Error("Unknown synchronization mode");
    await this.queue;
    if (mode !== "none") {
      if (
        this.comparison.windows.some(
          (w) => Object.keys(w.config.bots || {}).length,
        )
      )
        throw Error(
          "Turn off bots in every view before synchronizing. Bot games advance independently.",
        );
      if (this.comparison.windows.length < 2)
        throw Error("Load at least two views before synchronizing.");
      const states = await Promise.all(
        this.comparison.windows.map((w) =>
          this.comparison.api("/games/" + w.clone.game_id, undefined, "GET"),
        ),
      );
      if (new Set(states.map((s) => s.hash)).size !== 1)
        throw Error(
          "Games have diverged. Reset all to the same situation before synchronizing.",
        );
    }
    this.mode = mode;
    this.error = null;
    this.skipped = 0;
    this.actionClicks.clear();
    for (const w of this.comparison.windows)
      this.snapshots.set(w, await capturePresentation(w.page, w.config.render));
    await this.updateBridges();
    return this.status();
  }
  async setCheats(show) {
    this.cheats = !!show;
    await this.updateBridges();
    return this.status();
  }
  receive(win, event) {
    if (this.mode === "none" || !this.comparison.windows.includes(win))
      return Promise.resolve();
    if (event.kind === "action" && event.clickId)
      this.actionClicks.add(win.clone.game_id + ":" + event.clickId);
    this.pending++;
    const mode = this.mode;
    const work = this.queue
      .then(async () => {
        if (this.mode !== mode || !this.comparison.windows.includes(win))
          return;
        if (this.busy())
          throw Error(
            "Wait for the comparison operation to finish before playing.",
          );
        if (event.kind === "action") {
          await this.comparison.api("/synchronize", {
            games: this.comparison.windows.map((w) => w.clone.game_id),
            source: win.clone.game_id,
            actor: win.config.seat,
            message: event.message,
          });
        } else if (event.kind === "click" && mode === "api-clicks") {
          const key = win.clone.game_id + ":" + event.clickId;
          if (this.actionClicks.delete(key)) return;
          await this.mirrorClick(win, event.descriptor);
        }
      })
      .catch(async (error) => {
        this.mode = "none";
        this.error = "Synchronization stopped: " + error.message;
        if (event.kind === "action")
          await win.page
            .evaluate(
              ({ message, detail }) =>
                window.__GOA2_LAB_SYNC__?.reject(message, detail),
              { message: event.message, detail: this.error },
            )
            .catch(() => {});
        await this.updateBridges().catch(() => {});
        throw error;
      })
      .finally(() => this.pending--);
    this.queue = work.catch(() => {});
    return work;
  }
  async mirrorClick(source, descriptor) {
    const current = await capturePresentation(
        source.page,
        source.config.render,
      ),
      previous = this.snapshots.get(source);
    this.snapshots.set(source, current);
    for (const dest of this.comparison.windows) {
      if (dest === source) continue;
      dest.page.__labSyncReplaying = true;
      await dest.page.evaluate(() => {
        window.__GOA2_LAB_SYNC__.replaying = true;
      });
      try {
        if (previous && current.pane !== previous.pane)
          await showPane(dest.page, current.pane, dest.config);
        else if (
          current.inspectedHero &&
          current.inspectedHero !== previous?.inspectedHero
        )
          await inspectHero(dest.page, current.inspectedHero);
        else {
          const matched = await dest.page.evaluate((d) => {
            let candidates = [
              ...document.querySelectorAll(
                '[data-lab-card],[data-pane],button,[role="button"],input,select',
              ),
            ].filter((e) => e.checkVisibility() && !e.disabled);
            if (d.card)
              candidates = candidates.filter(
                (e) => e.dataset.labCard === d.card,
              );
            else if (d.pane)
              candidates = candidates.filter((e) => e.dataset.pane === d.pane);
            else if (d.label)
              candidates = candidates.filter(
                (e) => e.getAttribute("aria-label") === d.label,
              );
            else if (d.title)
              candidates = candidates.filter((e) => e.title === d.title);
            else if (d.text)
              candidates = candidates.filter(
                (e) =>
                  e.tagName === d.tag &&
                  e.textContent.trim().replace(/\s+/g, " ") === d.text,
              );
            else return false;
            if (candidates.length !== 1) return false;
            const e = candidates[0];
            if (e instanceof HTMLSelectElement) {
              e.value = d.value;
              e.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (e instanceof HTMLInputElement && e.type === "checkbox") {
              if (e.checked !== d.checked) e.click();
            } else e.click();
            return true;
          }, descriptor);
          if (!matched) this.skipped++;
        }
        await dest.page.waitForTimeout(60);
        this.snapshots.set(
          dest,
          await capturePresentation(dest.page, dest.config.render),
        );
      } catch {
        this.skipped++;
      } finally {
        dest.page.__labSyncReplaying = false;
        await dest.page
          .evaluate(() => {
            window.__GOA2_LAB_SYNC__.replaying = false;
          })
          .catch(() => {});
      }
    }
  }
}
