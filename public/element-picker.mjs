// Serialized into lab-owned game pages; no product frontend changes.
export function installElementPicker(initiallyActive = false) {
  if (window.__GOA2_ELEMENT_PICKER__) return;
  let active = false,
    selecting = false,
    suppressUntil = 0,
    overlay,
    cursorStyle,
    target;
  const cleanText = (node) =>
    (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const classes = (node) =>
    [...node.classList]
      .map((name) => name.replace(/_[a-z0-9]{5,}_(?:\d+)?$/i, ""))
      .sort();
  function path(node) {
    const parts = [];
    while (node && node.nodeType === 1) {
      const peers = node.parentElement
        ? [...node.parentElement.children].filter(
            (e) => e.localName === node.localName,
          )
        : [node];
      parts.unshift(
        CSS.escape(node.localName) +
          ":nth-of-type(" +
          (peers.indexOf(node) + 1) +
          ")",
      );
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  function describe(node) {
    const selectors = [];
    for (const name of [
      "data-testid",
      "data-lab-card",
      "data-pane",
      "data-lab-hero",
      "aria-label",
      "id",
    ])
      if (node.hasAttribute(name))
        selectors.push(
          "div[" + name + "=" + JSON.stringify(node.getAttribute(name)) + "]",
        );
    if (node.classList.length)
      selectors.push(
        "div" + [...node.classList].map((c) => "." + CSS.escape(c)).join(""),
      );
    for (const name of [...node.classList]) {
      const match = /^(_?[A-Za-z][A-Za-z0-9]*?)_[a-z0-9]{5,}_/i.exec(name);
      if (match)
        selectors.push("div[class*=" + JSON.stringify(match[1] + "_") + "]");
    }
    return {
      selectors: [...new Set(selectors)],
      path: path(node),
      text: cleanText(node),
      classes: classes(node),
      tag: "div",
    };
  }
  function resolve(descriptor, source = false) {
    const visible = (e) =>
      e.localName === "div" &&
      !e.hasAttribute("data-lab-element-overlay") &&
      e.checkVisibility() &&
      e.getBoundingClientRect().width > 0 &&
      e.getBoundingClientRect().height > 0;
    if (source) {
      const e = target?.isConnected ? target : null;
      if (e && visible(e)) return { selector: path(e), match: "selected div" };
      return { error: "The selected div is no longer present." };
    }
    let ambiguous = false;
    for (const selector of descriptor.selectors || []) {
      let matches = [...document.querySelectorAll(selector)].filter(visible);
      if (matches.length > 1 && descriptor.text) {
        const exact = matches.filter((e) => cleanText(e) === descriptor.text);
        if (exact.length === 1) matches = exact;
      }
      if (matches.length === 1)
        return { selector: path(matches[0]), match: selector };
      if (matches.length > 1) ambiguous = true;
    }
    const e = document.querySelector(descriptor.path);
    if (
      !ambiguous &&
      e &&
      visible(e) &&
      ((descriptor.text && cleanText(e) === descriptor.text) ||
        classes(e).some((c) => descriptor.classes?.includes(c)))
    )
      return {
        selector: path(e),
        match: "matching structure and content/class",
      };
    return {
      error: ambiguous
        ? "The equivalent div is ambiguous in this view."
        : "No equivalent div is visible in this view.",
    };
  }
  function draw() {
    if (!overlay || !target?.isConnected) {
      if (overlay) overlay.hidden = true;
      return;
    }
    const r = target.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
    overlay.hidden = !r.width || !r.height;
  }
  function point(event) {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    target = hit?.closest("div:not([data-lab-element-overlay])");
    if (target?.hasAttribute("data-lab-element-overlay")) target = null;
    draw();
  }
  function setActive(value) {
    if (!value && selecting) suppressUntil = performance.now() + 350;
    active = !!value;
    selecting = false;
    overlay?.remove();
    cursorStyle?.remove();
    overlay = cursorStyle = null;
    if (!active || !document.body) return;
    cursorStyle = document.createElement("style");
    cursorStyle.dataset.labElementCursor = "";
    cursorStyle.textContent = "html,body,body *{cursor:crosshair!important}";
    overlay = document.createElement("div");
    overlay.dataset.labElementOverlay = "";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      "position:fixed;box-sizing:border-box;pointer-events:none;z-index:2147483647;border:3px solid #008cff;box-shadow:0 0 7px 3px #008cff,0 0 18px 6px #008cff99;background:#008cff0a;";
    overlay.hidden = true;
    document.head.append(cursorStyle);
    document.body.append(overlay);
  }
  const stop = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener(
    "pointermove",
    (event) => {
      if (active) {
        point(event);
        stop(event);
      }
    },
    true,
  );
  for (const type of [
    "pointerdown",
    "mousedown",
    "mouseup",
    "mousemove",
    "click",
    "dblclick",
    "contextmenu",
    "touchstart",
    "touchend",
  ])
    window.addEventListener(
      type,
      (event) => {
        if (active || performance.now() < suppressUntil) {
          if (active && type === "pointerdown") point(event);
          stop(event);
        }
      },
      { capture: true, passive: false },
    );
  window.addEventListener(
    "pointerup",
    (event) => {
      if (!active) return;
      stop(event);
      if (selecting || !target) return;
      selecting = true;
      void window
        .__labElementPick({ kind: "select", descriptor: describe(target) })
        .catch(() => {
          selecting = false;
        });
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (!active) return;
      stop(event);
      if (event.key === "Escape")
        void window.__labElementPick({ kind: "cancel" });
    },
    true,
  );
  window.addEventListener(
    "scroll",
    () => {
      if (active) draw();
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (active) draw();
  });
  window.__GOA2_ELEMENT_PICKER__ = {
    setActive,
    resolve,
    describe,
    get active() {
      return active;
    },
  };
  if (document.body) setActive(initiallyActive);
  else
    document.addEventListener(
      "DOMContentLoaded",
      () => setActive(initiallyActive),
      { once: true },
    );
}
