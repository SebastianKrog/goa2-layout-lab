// ==UserScript==
// @name GoA2 Layout lab device reporter
// @description Injected only by the layout lab's device-view server.
// @grant none
// ==/UserScript==
import { capturePresentation } from "/__device/presentation.js";

const { config, presentation } = window.__GOA2_DEVICE__;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, timeout = 10000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    const value = read();
    if (value) return value;
    await sleep(80);
  }
  throw Error("The requested presentation is unavailable in this view.");
}
const visible = (selector) =>
  [...document.querySelectorAll(selector)].find(
    (e) => e.getClientRects().length,
  );

async function restore() {
  await until(() => window.__GOA2_LAB_STATE__?.view, 90000);
  if (config.source === "target") {
    await until(() => document.querySelector('[class*="sidebar"]'));
    const script = document.createElement("script");
    script.src = "/__device/target.js";
    document.head.append(script);
    await until(() => window.GOA2Mobile2D);
  }
  const warnings = [];
  const attempt = async (name, action) => {
    try {
      await action();
    } catch {
      warnings.push(name);
    }
  };
  const pane = async (name) => {
    if (config.layout !== "mobile") return;
    const current = document.querySelector('[data-pane][aria-pressed="true"]');
    if (name === "board") {
      if (current) current.click();
    } else if (current?.dataset.pane !== name)
      (await until(() => visible(`[data-pane="${CSS.escape(name)}"]`))).click();
    await until(
      () =>
        (document.querySelector('[data-pane][aria-pressed="true"]')?.dataset
          .pane || "board") === name,
    );
  };
  if (presentation.selectedCard)
    await attempt("Selected card", async () => {
      const state = window.__GOA2_LAB_STATE__;
      const cardId = presentation.selectedCard;
      if (
        state.view.phase !== "PLANNING" ||
        !Object.values(state.view.teams)
          .flatMap((t) => t.heroes)
          .some(
            (h) => Array.isArray(h.hand) && h.hand.some((c) => c.id === cardId),
          )
      )
        throw Error();
      await pane("hand");
      (
        await until(() => visible(`[data-lab-card="${CSS.escape(cardId)}"]`))
      ).click();
    });
  await attempt("Pane", () => pane(presentation.pane || "board"));
  if (presentation.camera && presentation.camera.mode === config.render)
    await attempt("Camera", async () => {
      const bridge = await until(
        () =>
          window.__GOA2_LAB_BRIDGE__?.[
            config.render === "3d" ? "camera3d" : "camera2d"
          ],
      );
      bridge.set(presentation.camera);
    });
  if (presentation.inspectionScript && config.source === "target")
    await attempt("Userscript inspection", async () => {
      (await until(() => window.GOA2Mobile2D?.__labInspection)).set(
        presentation.inspectionScript,
      );
    });
  if (presentation.inspectionMobile)
    await attempt("Card inspection", async () => {
      (
        await until(() =>
          visible(
            `[data-lab-inspect-card="${CSS.escape(presentation.inspectionMobile)}"]`,
          ),
        )
      ).click();
    });
  window.__GOA2_DEVICE_RESTORE_WARNINGS__ = warnings;
}

function makeMovable(button) {
  const key = "goa2-lab-report-position-v1";
  let pointer = null,
    timer,
    dragging = false,
    suppressClick = false;
  const clamp = (x, y) => ({
    x: Math.max(8, Math.min(x, innerWidth - button.offsetWidth - 8)),
    y: Math.max(8, Math.min(y, innerHeight - button.offsetHeight - 8)),
  });
  function place(x, y) {
    const position = clamp(x, y);
    Object.assign(button.style, {
      left: `${position.x}px`,
      top: `${position.y}px`,
      right: "auto",
    });
  }
  function save() {
    const rect = button.getBoundingClientRect();
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          x: rect.left / innerWidth,
          y: rect.top / innerHeight,
        }),
      );
    } catch {
      /* Optional preference. */
    }
  }
  try {
    const position = JSON.parse(localStorage.getItem(key));
    if (Number.isFinite(position?.x) && Number.isFinite(position?.y))
      place(position.x * innerWidth, position.y * innerHeight);
  } catch {
    /* No saved position. */
  }
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const rect = button.getBoundingClientRect();
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: rect.left,
      y: rect.top,
    };
    button.setPointerCapture(event.pointerId);
    timer = setTimeout(() => {
      if (!pointer) return;
      dragging = true;
      suppressClick = true;
      button.dataset.dragging = "true";
      try {
        navigator.vibrate?.(15);
      } catch {
        /* Not supported on every phone. */
      }
    }, 450);
  });
  button.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.startX,
      dy = event.clientY - pointer.startY;
    if (dragging) {
      event.preventDefault();
      place(pointer.x + dx, pointer.y + dy);
    } else if (Math.hypot(dx, dy) > 8) {
      clearTimeout(timer);
      suppressClick = true;
    }
  });
  function release(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    clearTimeout(timer);
    if (dragging) {
      delete button.dataset.dragging;
      save();
    }
    pointer = null;
    dragging = false;
    // The click synthesized by pointerup follows this event synchronously.
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  button.addEventListener(
    "click",
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  addEventListener("resize", () => {
    if (button.style.left) {
      const rect = button.getBoundingClientRect();
      place(rect.left, rect.top);
    }
  });
}

function captureAdapters() {
  const originalFetch = window.fetch;
  const pendingImages = new Map();
  window.fetch = function (resource, init) {
    const method = (init?.method || resource?.method || "GET").toUpperCase();
    const url = new URL(
      typeof resource === "string" || resource instanceof URL
        ? resource
        : resource.url,
      location.href,
    );
    if (
      method !== "GET" ||
      url.origin !== location.origin ||
      !/\.(png|jpe?g|webp|gif|svg|woff2?|ttf|otf)$/i.test(url.pathname) ||
      url.pathname.startsWith("/api/")
    )
      return originalFetch.call(this, resource, init);
    const key = JSON.stringify([
      url.href,
      init?.credentials || resource?.credentials,
      init?.mode || resource?.mode,
    ]);
    if (!pendingImages.has(key))
      pendingImages.set(key, originalFetch.call(this, resource, init));
    // Each embedding call needs its own response body reader.
    return pendingImages.get(key).then((response) => response.clone());
  };
  const sourceCanvases = new Set(document.body.querySelectorAll("canvas"));
  const originalEncode = HTMLCanvasElement.prototype.toDataURL;
  const ratio = Math.min(devicePixelRatio, 2);
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    if (!sourceCanvases.has(this)) return originalEncode.apply(this, args);
    const bounds = this.getBoundingClientRect();
    if (
      !bounds.width ||
      !bounds.height ||
      bounds.bottom <= 0 ||
      bounds.right <= 0 ||
      bounds.top >= innerHeight ||
      bounds.left >= innerWidth
    )
      return "data:,";
    const scale = Math.min(
      1,
      (bounds.width * ratio) / this.width,
      (bounds.height * ratio) / this.height,
    );
    if (scale >= 1) return originalEncode.apply(this, args);
    const bitmap = document.createElement("canvas");
    bitmap.width = Math.max(1, Math.ceil(this.width * scale));
    bitmap.height = Math.max(1, Math.ceil(this.height * scale));
    bitmap.getContext("2d").drawImage(this, 0, 0, bitmap.width, bitmap.height);
    return originalEncode.apply(bitmap, args);
  };
  return () => {
    window.fetch = originalFetch;
    HTMLCanvasElement.prototype.toDataURL = originalEncode;
  };
}

async function mount() {
  await restore();
  const host = document.createElement("div");
  host.id = "goa2-device-report";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host{all:initial;font:14px system-ui;color:#f8f3e9}button,textarea{font:inherit}button{min-height:44px;padding:8px 14px;cursor:pointer}button:disabled{opacity:.5}
    #launch{position:fixed;z-index:2147483000;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));border:1px solid #e8ba60;border-radius:24px;background:#292238;color:#ffe0a0;box-shadow:0 3px 12px #0009;font-weight:600;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
    #launch[data-dragging]{box-shadow:0 0 0 3px #e8ba6080,0 5px 18px #000b;cursor:grabbing}
    dialog{position:fixed;box-sizing:border-box;width:min(94vw,480px);max-height:90dvh;overflow:auto;border:1px solid #897455;border-radius:12px;background:#24202e;color:#f8f3e9;padding:16px}dialog::backdrop{background:#000b}
    h2{font-size:19px;margin:0 0 12px}textarea{display:block;box-sizing:border-box;width:100%;padding:10px;margin-top:8px;background:#15121b;color:inherit;border:1px solid #91836d;border-radius:6px}p{font-size:13px}img{display:block;max-width:100%;max-height:28dvh;margin:0 auto 12px;object-fit:contain}img:not([src]){display:none}footer{display:flex;gap:10px;justify-content:flex-end}
  </style><button id="launch" aria-label="Report testing issue" title="Tap to report. Hold to move.">✎ Report</button>
  <dialog aria-labelledby="title"><h2 id="title">Report an issue or idea</h2><div id="editor"><img alt="Captured game screen without reporting controls"><label>What should be fixed or changed?<textarea rows="4" maxlength="10000"></textarea></label><p>Situation, screenshot and comment are saved in the layout lab on your PC.</p></div><p id="status" role="status"></p><p id="error" role="alert"></p><footer><button id="discard">Discard</button><button id="cancel" autofocus>Close</button><button id="save">Save report</button></footer></dialog>`;
  const $ = (id) => shadow.getElementById(id);
  const dialog = shadow.querySelector("dialog"),
    comment = shadow.querySelector("textarea");
  const image = shadow.querySelector("img");
  let capture = null,
    capturing = false,
    saving = false,
    saved = false;
  makeMovable($("launch"));
  async function post(action, payload) {
    const response = await fetch(`/__device/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const value = await response.json();
    if (!response.ok)
      throw Error(value.error || "Report failed. Please retry.");
    return value;
  }
  const update = () => {
    $("save").disabled =
      capturing || saving || !capture || !comment.value.trim();
    $("cancel").disabled = saving;
    $("discard").disabled = capturing || saving;
    $("discard").hidden = saved;
  };
  $("launch").addEventListener("click", async () => {
    if (dialog.open) return;
    if (capturing || (capture && !saved)) {
      dialog.showModal();
      return;
    }
    capturing = true;
    if (saved) comment.value = "";
    saved = false;
    capture = null;
    $("editor").hidden = false;
    $("status").textContent =
      "Preparing screenshot… You can write your comment now.";
    $("error").textContent = "";
    image.removeAttribute("src");
    $("save").hidden = false;
    $("cancel").textContent = "Close";
    update();
    // Keep the game viewport stable if typing opens the phone keyboard.
    const frameWidth = innerWidth,
      frameHeight = innerHeight;
    const viewportLock = document.createElement("style");
    viewportLock.textContent = `[data-mobile-pane]{width:${frameWidth}px!important;height:${frameHeight}px!important;--mobile-viewport-height:${frameHeight}px!important}`;
    document.head.append(viewportLock);
    // Show feedback on the first frame, before screenshot rendering.
    const windowPosition = { x: scrollX, y: scrollY };
    dialog.showModal();
    scrollTo(windowPosition.x, windowPosition.y);
    const viewport = {
      width: frameWidth,
      height: frameHeight,
      pixelRatio: devicePixelRatio,
      userAgent: navigator.userAgent,
    };
    const started = performance.now();
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    );
    const restoreAdapters = captureAdapters();
    try {
      const [moment, screenshot] = await Promise.all([
        post("capture", {
          presentation: capturePresentation(config.render),
          viewport,
        }),
        window.htmlToImage.toPng(document.body, {
          width: viewport.width,
          height: viewport.height,
          pixelRatio: Math.min(viewport.pixelRatio, 2),
          preferredFontFormat: "woff2",
          backgroundColor: getComputedStyle(document.body).backgroundColor,
          filter: (node) => {
            if (node === host) return false;
            // Invisible pane/deck subtrees can contain thousands of nodes.
            if (node instanceof HTMLElement) {
              const style = getComputedStyle(node);
              if (style.display === "none") return false;
            }
            return true;
          },
        }),
      ]);
      capture = { id: moment.id, screenshot };
      image.src = screenshot;
      $("status").textContent = "Screenshot ready.";
      window.__GOA2_DEVICE_CAPTURE_MS__ = Math.round(
        performance.now() - started,
      );
    } catch (error) {
      $("error").textContent = error.message;
      $("status").textContent =
        "Capture failed. Close and tap Report to try again.";
    } finally {
      capturing = false;
      viewportLock.remove();
      restoreAdapters();
      update();
    }
  });
  $("cancel").onclick = () => dialog.close();
  $("discard").onclick = () => {
    if (capturing || saving) return;
    capture = null;
    comment.value = "";
    dialog.close();
  };
  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  comment.oninput = update;
  $("save").onclick = async () => {
    if (!capture || capturing || saving || saved) return;
    saving = true;
    $("error").textContent = "";
    update();
    try {
      const result = await post("report", {
        ...capture,
        comment: comment.value,
      });
      saved = true;
      $("status").textContent = `Saved in layout lab. Situation: ${result.id}`;
      $("editor").hidden = true;
      $("save").hidden = true;
      $("cancel").textContent = "Done";
    } catch (error) {
      $("error").textContent = error.message;
    } finally {
      saving = false;
      update();
      if (saved) $("cancel").focus();
    }
  };
}
mount().catch((error) => {
  console.error("Layout lab device view:", error);
  window.__GOA2_DEVICE_RESTORE_WARNINGS__ = [error.message];
});
