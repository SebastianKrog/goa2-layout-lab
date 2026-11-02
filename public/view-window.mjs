import { observeTagLists } from "./tag-ui.mjs";
import { NativeView } from "./native.mjs";
import { LiveView } from "./live.mjs";
const index = Number(new URLSearchParams(location.search).get("index"));
const desktop = window.layoutLabDesktop;
const surface = document.getElementById("surface");
const controls = document.getElementById("controls");
let live, key, footer, header;
let editorFrame;
function receive(payload) {
  if (payload.index !== index) return;
  if (payload.editorContext) {
    editorFrame?.contentWindow.postMessage(
      { type: "lab-editor-context", context: payload.editorContext },
      location.origin,
    );
    return;
  }
  document.title = payload.title + " — GoA2 Layout Lab";
  if (payload.header !== undefined && header !== payload.header) {
    header = payload.header;
    document.getElementById("viewHeader").innerHTML = header;
    observeTagLists(document.getElementById("viewHeader"));
  }
  const next = payload.closed
    ? null
    : desktop
      ? payload.nativeId
      : payload.gameId;
  if (next !== key) {
    live?.destroy();
    live = null;
    key = next;
    surface.replaceChildren();
    if (next && payload.viewport) {
      const View = desktop ? NativeView : LiveView;
      live = new View(index, payload, payload.viewport);
      surface.append(live.host);
    } else {
      const waiting = document.createElement("p");
      waiting.id = "waiting";
      waiting.textContent = "Waiting for this View to reopen…";
      surface.append(waiting);
    }
  }
  if (footer !== payload.footer) {
    footer = payload.footer;
    // This markup is serialized from the trusted same-origin lab controls.
    controls.innerHTML = footer;
  }
  const notice = document.getElementById("viewWarnings");
  if (notice) {
    notice.hidden = !payload.warnings?.length;
    notice.textContent = (payload.warnings || []).join("\n");
  }
  live?.zoom(payload.fit);
  live?.pause(payload.paused);
  live?.resize();
}
function action(event) {
  const target = event.target.closest("[data-window-control]");
  if (!target || target.disabled) return;
  if (event.type === "click" && target.tagName !== "BUTTON") return;
  if (event.type === "change" && target.tagName === "BUTTON") return;
  if (target.dataset.windowControl === "edit") {
    if (!editorFrame) {
      editorFrame = document.createElement("iframe");
      editorFrame.className = "view-editor-frame";
      editorFrame.title = "Edit this View";
      editorFrame.src = "/?editView=" + index;
      document.body.append(editorFrame);
      window.dispatchEvent(new Event("resize"));
    }
    return;
  }
  const payload = {
    index,
    control: target.dataset.windowControl,
    kind: event.type,
    value: target.value,
    checked: target.checked,
  };
  if (target.hasAttribute("data-action-menu")) target.value = "";
  if (desktop) desktop.windowAction(payload);
  else
    window.opener?.postMessage(
      { type: "lab-view-action", ...payload },
      location.origin,
    );
}
window.addEventListener("message", (event) => {
  if (
    event.origin === location.origin &&
    editorFrame &&
    event.source === editorFrame.contentWindow &&
    event.data?.type === "lab-editor-ready"
  ) {
    const request = { index, control: "editor-context", kind: "click" };
    if (desktop) desktop.windowAction(request);
    else
      window.opener?.postMessage(
        { type: "lab-view-action", ...request },
        location.origin,
      );
    return;
  }
  if (
    event.origin === location.origin &&
    editorFrame &&
    event.source === editorFrame.contentWindow &&
    event.data?.type === "lab-editor-closed"
  ) {
    editorFrame.remove();
    editorFrame = null;
    window.dispatchEvent(new Event("resize"));
  }
});
controls.addEventListener("click", action);
controls.addEventListener("change", action);
if (desktop) desktop.onWindowContent(receive);
else {
  window.addEventListener("message", (event) => {
    if (
      event.origin === location.origin &&
      event.source === window.opener &&
      event.data?.type === "lab-view-content"
    )
      receive(event.data);
  });
  window.opener?.postMessage(
    { type: "lab-view-ready", index },
    location.origin,
  );
}
window.addEventListener("pagehide", () => live?.destroy());
