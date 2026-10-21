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

async function mount() {
  await restore();
  const host = document.createElement("div");
  host.id = "goa2-device-report";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host{all:initial;font:14px system-ui;color:#f8f3e9}button,textarea{font:inherit}button{min-height:44px;padding:8px 14px;cursor:pointer}button:disabled{opacity:.5}
    #launch{position:fixed;z-index:2147483000;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));border:1px solid #e8ba60;border-radius:24px;background:#292238;color:#ffe0a0;box-shadow:0 3px 12px #0009;font-weight:600}
    dialog{position:fixed;box-sizing:border-box;width:min(94vw,480px);max-height:90dvh;overflow:auto;border:1px solid #897455;border-radius:12px;background:#24202e;color:#f8f3e9;padding:16px}dialog::backdrop{background:#000b}
    h2{font-size:19px;margin:0 0 12px}textarea{display:block;box-sizing:border-box;width:100%;padding:10px;margin-top:8px;background:#15121b;color:inherit;border:1px solid #91836d;border-radius:6px}p{font-size:13px}img{display:block;max-width:100%;max-height:28dvh;margin:0 auto 12px;object-fit:contain}footer{display:flex;gap:10px;justify-content:flex-end}
  </style><button id="launch" aria-label="Report testing issue">✎ Report</button>
  <dialog aria-labelledby="title"><h2 id="title">Report an issue or idea</h2><div id="editor"><img alt="Captured game screen without reporting controls"><label>What should be fixed or changed?<textarea rows="4" maxlength="10000"></textarea></label><p>Situation, screenshot and comment are saved in the layout lab on your PC.</p></div><p id="status" role="status"></p><p id="error" role="alert"></p><footer><button id="cancel">Cancel</button><button id="save">Save report</button></footer></dialog>`;
  const $ = (id) => shadow.getElementById(id);
  const dialog = shadow.querySelector("dialog"),
    comment = shadow.querySelector("textarea");
  let capture = null,
    busy = false,
    saved = false;
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
    $("save").disabled = busy || !capture || !comment.value.trim();
    $("cancel").disabled = busy;
  };
  $("launch").onclick = async () => {
    if (busy) return;
    busy = true;
    capture = null;
    saved = false;
    $("launch").style.visibility = "hidden";
    $("editor").hidden = false;
    $("status").textContent = "";
    $("error").textContent = "";
    comment.value = "";
    $("save").hidden = false;
    $("cancel").textContent = "Cancel";
    try {
      const [moment, screenshot] = await Promise.all([
        post("capture", {
          presentation: capturePresentation(config.render),
          viewport: {
            width: innerWidth,
            height: innerHeight,
            pixelRatio: devicePixelRatio,
            userAgent: navigator.userAgent,
          },
        }),
        window.htmlToImage.toPng(document.body, {
          width: innerWidth,
          height: innerHeight,
          pixelRatio: Math.min(devicePixelRatio, 2),
          backgroundColor: getComputedStyle(document.body).backgroundColor,
          filter: (node) => node !== host,
        }),
      ]);
      capture = { id: moment.id, screenshot };
      shadow.querySelector("img").src = screenshot;
    } catch (error) {
      $("error").textContent = error.message;
      shadow.querySelector("img").removeAttribute("src");
    } finally {
      busy = false;
      $("launch").style.visibility = "";
      update();
      dialog.showModal();
      comment.focus();
    }
  };
  $("cancel").onclick = () => dialog.close();
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  comment.oninput = update;
  $("save").onclick = async () => {
    if (!capture || busy || saved) return;
    busy = true;
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
      busy = false;
      update();
      if (saved) $("cancel").focus();
    }
  };
}
mount().catch((error) => {
  console.error("Layout lab device view:", error);
  window.__GOA2_DEVICE_RESTORE_WARNINGS__ = [error.message];
});
