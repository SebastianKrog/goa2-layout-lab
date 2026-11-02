// Keep one shell per View slot; its controls invoke the existing desk controls.
export class ViewWindows {
  constructor(changed, error) {
    this.changed = changed;
    this.error = error;
    this.detached = new Set();
    this.popups = new Map();
    this.fit = new Map();
    this.desktop = window.layoutLabDesktop;
    const action = (payload) => {
      if (
        payload.control === "editor-context" &&
        this.detached.has(payload.index)
      ) {
        const context = this.editorContext?.();
        if (this.desktop)
          this.desktop.windowContent({
            index: payload.index,
            editorContext: context,
          });
        else
          this.popups.get(payload.index)?.postMessage(
            {
              type: "lab-view-content",
              index: payload.index,
              editorContext: context,
            },
            location.origin,
          );
        return;
      }
      const control = document.querySelector(
        `.slot[data-index="${payload.index}"] [data-window-control="${payload.control}"]`,
      );
      if (
        !control ||
        control.disabled ||
        !["click", "change"].includes(payload.kind)
      )
        return;
      if (payload.kind === "click") control.click();
      else {
        if (control.type === "checkbox") control.checked = !!payload.checked;
        else control.value = payload.value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    if (this.desktop) {
      this.desktop.onWindows((indices) => this.setState(indices));
      this.desktop.onWindowAction(action);
      void this.desktop.windows().then((indices) => this.setState(indices));
    } else {
      window.addEventListener("message", (event) => {
        if (event.origin !== location.origin) return;
        const payload = event.data;
        if (!payload || this.popups.get(payload.index) !== event.source) return;
        if (payload.type === "lab-view-action") action(payload);
        if (payload.type === "lab-view-ready") this.sync();
      });
      this.timer = setInterval(() => {
        for (const [index, popup] of this.popups)
          if (popup.closed) {
            this.popups.delete(index);
            this.detached.delete(index);
            this.changed();
          }
      }, 500);
      window.addEventListener("pagehide", () => {
        clearInterval(this.timer);
        for (const popup of this.popups.values()) popup.close();
      });
    }
  }
  setState(indices) {
    if (JSON.stringify([...this.detached]) === JSON.stringify(indices)) return;
    this.detached = new Set(indices);
    this.changed();
  }
  setFit(index, fit) {
    this.fit.set(index, fit);
    this.sync();
  }
  async toggle(index, win) {
    try {
      if (this.desktop) {
        this.setState(
          await this.desktop.toggleWindow({
            index,
            id: win.nativeId,
            title:
              win.config.label || `View ${String.fromCharCode(65 + index)}`,
          }),
        );
      } else if (this.detached.has(index)) {
        this.popups.get(index)?.close();
        this.popups.delete(index);
        this.detached.delete(index);
        this.changed();
      } else {
        const popup = window.open(
          `/view.html?index=${index}`,
          `lab-view-${index}`,
          "popup,width=1000,height=850",
        );
        if (!popup)
          throw Error(
            "Allow popups for this lab to open a separate View window.",
          );
        this.popups.set(index, popup);
        this.detached.add(index);
        this.changed();
      }
    } catch (e) {
      this.error(e);
    }
  }
  sync(windows = this.windows || [], liveViews = this.liveViews || new Map()) {
    this.windows = windows;
    this.liveViews = liveViews;
    this.desktop?.pruneWindows(windows.length);
    for (const [index, popup] of this.popups)
      if (index >= windows.length) {
        popup.close();
        this.popups.delete(index);
        this.detached.delete(index);
      }
    for (const index of this.detached) {
      const win = windows[index];
      const footer = document.querySelector(
        `.slot[data-index="${index}"] .slot-footer`,
      );
      if (!win || !footer) continue;
      const clone = footer.cloneNode(true);
      clone.hidden = false;
      for (const source of footer.querySelectorAll("input, select, button")) {
        const target = clone.querySelector(
          `[data-window-control="${source.dataset.windowControl}"]`,
        );
        if (!target) continue;
        target.disabled = source.disabled;
        if (source.type === "checkbox")
          target.toggleAttribute("checked", source.checked);
        if (source.tagName === "SELECT")
          for (const option of target.options)
            option.toggleAttribute("selected", option.value === source.value);
      }
      clone.querySelector("[data-inline-only]")?.remove();
      const live = [...liveViews.values()].find((v) => v.index === index);
      const payload = {
        index,
        nativeId: win.nativeId,
        gameId: win.gameId,
        config: win.config,
        warnings: win.warnings || [],
        viewport:
          live?.viewport || this.profiles?.[win.config.profile]?.viewport,
        closed: win.closed,
        title: win.config.label || `View ${String.fromCharCode(65 + index)}`,
        footer: clone.outerHTML,
        header: footer.closest(".slot").querySelector(".slot-header").outerHTML,
        fit: this.fit.get(index) ?? live?.fit !== false,
        paused: document.body.classList.contains("busy"),
      };
      if (this.desktop) this.desktop.windowContent(payload);
      else
        this.popups
          .get(index)
          ?.postMessage(
            { type: "lab-view-content", ...payload },
            location.origin,
          );
    }
  }
}
