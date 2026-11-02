import { initReportsPanel } from "./reports-panel.mjs";
import { tagList } from "./tag-ui.mjs";
import {
  normalizeTags,
  parseTags,
  situationTags,
  tagLabel,
  tagType,
} from "./tags.mjs";
import { initReviewsPanel } from "./reviews-panel.mjs";
import { initElementReportPanel } from "./element-report-panel.mjs";
import { initDevicePanel } from "./device-panel.mjs";
import { LiveView } from "./live.mjs";
import { ViewWindows } from "./view-windows.mjs";
import { NativeView } from "./native.mjs";
const editorOnlyIndex = new URLSearchParams(location.search).has("editView")
  ? Number(new URLSearchParams(location.search).get("editView"))
  : null;
let editorOnlyOpened = false;
let editorBootstrap = null;
if (editorOnlyIndex !== null) document.body.classList.add("editor-only");
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const sourceNames = {
  main: "Main",
  base: "Base",
  comparator: "Current build",
  target: "Userscript target",
  live: "Live working tree",
};
const devices = {
  portrait: "Phone · portrait",
  landscape: "Phone · landscape",
  compact: "Phone · compact",
  desktop: "Desktop",
};
const paneNames = {
  board: "Board",
  heroes: "Heroes",
  hand: "Hand",
  deck: "Deck",
  log: "Log",
  settings: "Settings",
};
let openDevice, reviewHistory, reportsPanel;
let catalog = {},
  state = {},
  configs = [],
  running = false,
  operation = "",
  initialized = false,
  checking = false,
  disconnected = false,
  stopped = false,
  draftSetup = false,
  customSetup = false;
let currentPage = "compare",
  expandedIndex = null;
let viewOrder = [];
let editing = null,
  editDraft,
  creating = false,
  draftIndex = null,
  inheritIndex = 0,
  focusedIndex = 0,
  editorCommitted = false,
  lastWindowKey = "",
  toastTimer,
  applyingWorkspace = false;
const viewWindows = new ViewWindows(() => {
  if (initialized) {
    render();
    controls();
  }
}, showError);
viewWindows.editorContext = () => ({ catalog, state });
const reviewSelection = new Set();
let filteredSituations = [];
const excluded = new Set(),
  liveViews = new Map();
const human = (value) =>
  value === "spectator"
    ? "Spectator"
    : String(value || "")
        .replace(/^hero_/, "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
const stableValue = (value) =>
  Array.isArray(value)
    ? value.map(stableValue)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stableValue(value[key])]),
        )
      : value;
const presentationKey = (value) => ({
  ...(Object.hasOwn(value || {}, "viewpoint")
    ? { viewpoint: value.viewpoint }
    : {}),
  sessionState: value?.sessionState || {},
  userState: value?.userState || {},
});
const configKey = (c) =>
  JSON.stringify(
    stableValue({
      source: c.source,
      profile: c.profile,
      render: c.render,
      uiMode: c.uiMode,
      label: c.label || "",
      autoSwitch: !!c.autoSwitch,
      autoSwitchManualOnly: !!c.autoSwitchManualOnly,
      bots: c.bots || {},
      defaults: presentationKey(
        c.presentationDefaults || { viewpoint: c.seat },
      ),
      overrides: presentationKey(c.overrides),
    }),
  );
const viewKey = (w) =>
  w
    ? (w.nativeId ? "native" : w.index) +
      ":" +
      w.gameId +
      configKey(w.config) +
      w.config.seat +
      !!w.closed +
      (w.nativeId || "")
    : "";
const active = (i) => state.windows?.[i];
const matching = (i) =>
  active(i) && configKey(active(i).config) === configKey(configs[i]);
function showError(error) {
  $("error").hidden = false;
  $("error").textContent = error.message || String(error);
  const dialog = $("tagsDialog").open
    ? $("tagsDialog")
    : document.querySelector("dialog[open]");
  if (dialog) {
    let alert = dialog.querySelector("[data-dialog-error]");
    if (!alert) {
      alert = el("div", "alert");
      alert.dataset.dialogError = "";
      alert.setAttribute("role", "alert");
      (
        dialog.querySelector(".dialog-heading") || dialog.firstElementChild
      ).after(alert);
    }
    alert.textContent = $("error").textContent;
    alert.hidden = false;
  }
}
function notify(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4000);
}
function navigate(name) {
  currentPage = name;
  for (const live of liveViews.values()) {
    if (name !== "compare") live.destroy();
  }
  if (name !== "compare") liveViews.clear();
  else if (initialized) render();
  for (const page of [
    "compare",
    "situations",
    "reviews",
    "reports",
    "settings",
  ])
    $(page + "Page").hidden = page !== name;
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === name);
    b.setAttribute("aria-current", b.dataset.page === name ? "page" : "false");
  });
  if (name === "reviews") void reviewHistory?.refresh();
  if (name === "reports") void reportsPanel?.refresh(true);
  window.scrollTo(0, 0);
}
document.querySelector(".brand").onclick = (event) => {
  event.preventDefault();
  navigate("compare");
};
document
  .querySelectorAll("[data-page]")
  .forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
function option(value, text) {
  const o = el("option", "", text);
  o.value = value;
  return o;
}
function fill(select, entries, selected = select.value) {
  select.replaceChildren(...entries.map(([v, t]) => option(v, t)));
  if (entries.some(([v]) => v === selected)) select.value = selected;
}
async function read(route) {
  const cached =
    route === "/api/catalog"
      ? "catalog"
      : route === "/api/status"
        ? "state"
        : null;
  if (cached && editorBootstrap?.[cached]) {
    const value = editorBootstrap[cached];
    delete editorBootstrap[cached];
    return value;
  }
  const r = await fetch(route, { signal: AbortSignal.timeout(15000) });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || `Request failed (${r.status})`);
  return v;
}
async function call(name, body = {}) {
  const r = await fetch("/api/" + name, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || "The action could not be completed.");
  return v;
}
function controls() {
  const busy = running || state.busy || disconnected;
  document.body.classList.toggle("busy", running || !!state.busy);
  document
    .querySelectorAll(
      "button:not(.nav-item):not([data-close]):not(#stop):not(#elementReportSend), select, input",
    )
    .forEach((b) => (b.disabled = !!busy));
  for (const live of liveViews.values()) live.pause(!!busy);
  const count = state.windows?.length || 0;
  for (const id of [
    "capture",
    "captureFromTools",
    "extract",
    "save",
    "reset",
    "clear",
  ])
    $(id).disabled = !!busy || count < (id === "extract" ? 2 : 1);
  if (!busy)
    document
      .querySelectorAll("[data-needs-window]")
      .forEach((b) => (b.disabled = !active(Number(b.dataset.needsWindow))));
  if (!busy)
    document
      .querySelectorAll("[data-unopened]")
      .forEach((b) => (b.disabled = true));
  $("liveUpdates").disabled =
    !!busy ||
    !(state.windows || []).some((w) =>
      ["live", "comparator"].includes(w.config.source),
    );
  const independent = count < 1;
  $("synchronize").disabled = !!busy || independent;
  $("synchronize").title = independent
    ? "Load a View before changing synchronization."
    : "";
  $("editor")
    .querySelectorAll("[data-close]")
    .forEach((b) => {
      b.disabled = !!busy;
    });
  $("reportElement").disabled = !!busy || count < 1;
  const captureCount = (state.windows || []).filter(
    (_, i) => !excluded.has(i),
  ).length;
  $("extract").disabled = !!busy || captureCount !== 2;
  $("extractSelectionNote").textContent =
    captureCount === 2
      ? "2 Views selected"
      : `${captureCount} selected · choose exactly 2 Views`;

  updateCropControls(busy);
  $("addView").disabled = !!busy || configs.length >= 3;
  $("addView").title = configs.length >= 3 ? "Up to three views" : "Add a view";
  $("load").disabled = !!busy || !configs.length || !$("situation").value;
  updateReviewControls();
  reviewHistory?.updateState();
  reportsPanel?.updateState();
  viewWindows.profiles = catalog.profiles;
  viewWindows.sync(state.windows || [], liveViews);
}
async function task(label, fn, { sync = true, refreshCatalog = true } = {}) {
  if (running || state.busy) return;
  running = true;
  operation = label;
  $("error").hidden = true;
  document
    .querySelectorAll("[data-dialog-error]")
    .forEach((e) => (e.hidden = true));
  updateStatus();
  controls();
  try {
    const result = await fn();
    if (refreshCatalog) await reloadCatalog();
    state = await read("/api/status");
    void reviewHistory?.refresh();
    lastWindowKey = (state.windows || []).map(viewKey).join("|");
    if (sync && state.windows?.length) syncViews();
    render();
    updateStatus();
    return result;
  } catch (error) {
    showError(error);
  } finally {
    running = false;
    operation = "";
    controls();
    updateStatus();
    if (!state.busy) void refreshPreviews();
  }
}
function selectedSituation() {
  return catalog.situations?.find((s) => s.id === $("situation").value);
}
async function reloadCatalog() {
  catalog = await read("/api/catalog");
  const selected = $("situation").value;
  $("situation").replaceChildren();
  const groups = new Map();
  for (const situation of catalog.situations) {
    const key =
      (situation.origin === "library" ? "Library" : "Local drafts") +
      " / " +
      (situation.group || "Unfiled");
    if (!groups.has(key)) {
      const group = el("optgroup");
      group.label = key;
      groups.set(key, group);
      $("situation").append(group);
    }
    const option = el("option", "", situation.name);
    option.value = situation.id;
    groups.get(key).append(option);
  }
  if (catalog.situations.some((s) => s.id === selected))
    $("situation").value = selected;
  const folders = [
    ...new Set(
      catalog.situations.flatMap((s) => {
        const parts = (s.group || "").split("/");
        return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
      }),
    ),
  ]
    .filter(Boolean)
    .sort();
  const selectedFolder = $("libraryGroup").value;
  fill($("libraryGroup"), [
    ["", "All folders"],
    ["__root", "Unfiled"],
    ...folders.map((g) => [g, g]),
  ]);
  if (folders.includes(selectedFolder) || selectedFolder === "__root")
    $("libraryGroup").value = selectedFolder;
  $("situationFolders").replaceChildren(
    ...folders.map((g) => {
      const o = el("option");
      o.value = g;
      return o;
    }),
  );
  fill($("preset"), [
    ...Object.keys(catalog.presets).map((k) => [k, k]),
    ["__custom", "Custom setup"],
  ]);
  $("preset").querySelector('[value="__custom"]').disabled = true;
  if (catalog.primaryLayouts?.length) {
    const other = el("optgroup");
    other.label = "Other layouts";
    for (const option of [...$("preset").options]) {
      if (
        option.value !== "__custom" &&
        !catalog.primaryLayouts.includes(option.value)
      )
        other.append(option);
      if (option.value === "Current")
        option.textContent = "Desktop · Working tree";
    }
    $("preset").insertBefore(
      other,
      $("preset").querySelector('[value="__custom"]'),
    );
  }
  const chosenPresentation = $("inspectionPresentation").value;
  fill($("inspectionPresentation"), [
    ["", "Default presentation"],
    ...(catalog.presentations || []).map((p) => [p.id, p.name]),
  ]);
  if ((catalog.presentations || []).some((p) => p.id === chosenPresentation))
    $("inspectionPresentation").value = chosenPresentation;
  const branch = catalog.settings?.comparatorRef || "mobile-migration";
  fill($("revision"), [
    [branch, "Newest configured build"],
    ...catalog.commits
      .filter((c) => c.sha !== branch)
      .map((c) => [c.sha, c.sha.slice(0, 8) + " · " + c.subject]),
  ]);
  $("savedCount").textContent = catalog.situations.length;
  if (editorOnlyIndex === null) {
    renderLibrary();
    renderSettings();
  }
}
function syncViews() {
  configs = state.windows.map((w) => ({ ...w.config }));
  $("count").value = configs.length;
  draftSetup = false;
  const preset = Object.entries(catalog.presets).find(
    ([, slots]) =>
      slots.length === configs.length &&
      slots.every((s, i) => configKey(s) === configKey(configs[i])),
  );
  $("preset").value = preset ? preset[0] : "__custom";
}
function setPreset() {
  if (!catalog.presets[$("preset").value]) return;
  configs = structuredClone(catalog.presets[$("preset").value]);
  $("count").value = configs.length;
  draftSetup = true;
  render();
  updateStatus();
}
function button(text, fn, cls = "") {
  const b = el("button", cls, text);
  b.type = "button";
  if (
    [
      "Edit view",
      "Remove",
      "Reopen",
      "Reset this view",
      "Rotate phone",
    ].includes(text)
  )
    b.dataset.reviewSetup = "";
  b.onclick = fn;
  return b;
}
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("close", () => {
    dialog.querySelector("[data-dialog-error]")?.remove();
  }),
);
function render() {
  $("startScreen").hidden = configs.length > 0;
  $("workspaceToolbar").hidden = !configs.length;
  $("startOver").hidden = !!state.windows?.length;
  $("slots").closest(".view-workspace").hidden =
    !state.windows?.length && !customSetup;

  while (configs.length < Number($("count").value))
    configs.push(structuredClone(configs.at(-1) || catalog.presets.Current[0]));
  configs.length = Number($("count").value);
  viewOrder = viewOrder.filter((index) => index < configs.length);
  for (let index = 0; index < configs.length; index++)
    if (!viewOrder.includes(index)) viewOrder.push(index);
  const preset = Object.entries(catalog.presets).find(
    ([, slots]) =>
      slots.length === configs.length &&
      slots.every((s, i) => configKey(s) === configKey(configs[i])),
  );
  $("preset").value = preset ? preset[0] : "__custom";
  const inlineCount = configs.filter(
    (_, index) => !viewWindows.detached.has(index),
  ).length;
  $("slots")
    .closest(".view-workspace")
    .classList.toggle("all-detached", inlineCount === 0 && configs.length > 0);
  $("slots").classList.toggle("one", inlineCount <= 1);
  $("slots").classList.toggle("two", inlineCount === 2);
  $("viewCount").textContent = $("navCount").textContent = configs.length;
  const keep = new Set();
  $("slots").replaceChildren(
    ...configs
      .map((s, i) => {
        const w = active(i),
          opened = matching(i) && !w.closed,
          letter = String.fromCharCode(65 + i),
          card = el("article", "slot");
        card.dataset.index = i;
        const detached = viewWindows.detached.has(i);
        card.classList.toggle("detached", detached);
        card.onpointerdown = () => {
          focusedIndex = i;
        };
        const header = el("div", "slot-header");
        header.append(el("span", "view-letter", letter));
        const heading = el("div");
        heading.append(
          el("h3", "", s.label || sourceNames[s.source]),
          el(
            "small",
            "",
            human(s.seat) +
              " / " +
              devices[s.profile] +
              " / " +
              s.render.toUpperCase() +
              (Object.keys(s.bots || {}).length
                ? " / Bots: " +
                  Object.entries(s.bots)
                    .map(
                      ([id, kind]) =>
                        human(id) +
                        " " +
                        (kind === "ismcts"
                          ? "ISMCTS"
                          : kind === "heuristic"
                            ? "Simple"
                            : "Random"),
                    )
                    .join(", ")
                : ""),
          ),
        );
        if (s.tags?.length) heading.append(tagList(normalizeTags(s.tags)));
        header.append(heading);
        card.append(header);
        let live;
        if (
          opened &&
          currentPage === "compare" &&
          !document.hidden &&
          editorOnlyIndex === null
        ) {
          const key = viewKey(w);
          keep.add(key);
          live = liveViews.get(key);
          if (!live) {
            const View =
              window.layoutLabDesktop && w.nativeId ? NativeView : LiveView;
            live = new View(i, w, catalog.profiles[s.profile].viewport);
            liveViews.set(key, live);
            if (viewWindows.fit.has(i)) live.zoom(viewWindows.fit.get(i));
          }
          card.append(live.host);
        } else {
          const empty = el(
            "div",
            "live-stage empty-view",
            w?.closed
              ? "View closed"
              : "Choose a situation and start this view",
          );
          const start = button("Start", () => openEditor(i));
          start.classList.add("primary");
          empty.append(start);
          card.append(empty);
        }
        if (detached) {
          const notice = el(
            "div",
            "separate-notice",
            "Shown in a separate window",
          );
          card.append(notice);
        }
        const actions = el("div", "slot-footer");
        actions.hidden = !w;
        const edit = button("Edit view", () => openEditor(i));
        edit.dataset.windowControl = "edit";
        actions.append(edit);
        const separate = button(
          detached ? "Return to lab" : "Open in window",
          () => {
            expandedIndex = null;
            void viewWindows.toggle(i, w);
          },
        );
        separate.dataset.windowControl = "window";
        separate.disabled = !opened;
        if (!opened) separate.dataset.unopened = "true";
        actions.append(separate);
        if (configs.length > 1) {
          const more = el("select");
          more.setAttribute("aria-label", `View ${letter} actions`);
          more.dataset.windowControl = "more";
          more.dataset.actionMenu = "";
          more.append(option("", "More…"));
          for (let other = 0; other < configs.length; other++)
            if (other !== i)
              more.append(
                option(
                  String(other),
                  `Swap with View ${String.fromCharCode(65 + other)}`,
                ),
              );
          more.onchange = () => {
            const other = Number(more.value);
            const chosen = more.value !== "";
            more.value = "";
            if (!chosen || other === i || !viewOrder.includes(other)) return;
            const from = viewOrder.indexOf(i),
              to = viewOrder.indexOf(other);
            [viewOrder[from], viewOrder[to]] = [viewOrder[to], viewOrder[from]];
            expandedIndex = null;
            render();
            controls();
          };
          actions.append(more);
        }
        card.classList.toggle("expanded", expandedIndex === i);
        const expand = button(
          w?.closed ? "Reopen" : expandedIndex === i ? "Collapse" : "Expand",
          () => {
            if (w?.closed)
              return task("Reopening view...", () =>
                call("configure", { index: i, update: {} }),
              );
            expandedIndex = expandedIndex === i ? null : i;
            render();
            if (expandedIndex !== null)
              live?.canvas.focus({ preventScroll: true });
          },
        );
        expand.disabled = !matching(i);
        if (!matching(i)) expand.dataset.unopened = "true";
        expand.dataset.inlineOnly = "";
        actions.append(expand);
        const scale = el("select");
        scale.setAttribute("aria-label", "Scale view " + letter);
        scale.append(option("fit", "Fit"), option("actual", "100%"));
        scale.value =
          (viewWindows.fit.get(i) ?? live?.fit) === false ? "actual" : "fit";
        scale.dataset.windowControl = "scale";
        scale.onchange = () => {
          live?.zoom(scale.value === "fit");
          viewWindows.setFit(i, scale.value === "fit");
        };
        actions.append(scale);
        const capture = el("label", "check"),
          check = el("input");
        check.type = "checkbox";
        check.checked = !excluded.has(i);
        check.setAttribute("aria-label", "Include in capture");
        check.dataset.captureIndex = i;
        check.dataset.windowControl = "capture";
        check.onchange = () => setCaptureSelection(i, check.checked);
        capture.append(check, document.createTextNode("Capture"));
        actions.append(capture);
        card.append(actions);
        const issues = [
          ...(w?.warnings || []),
          ...(w?.botError ? [w.botError] : []),
          ...(w?.errors || []),
          ...(w?.assets || []),
        ];
        if (issues.length)
          card.append(el("div", "view-warning", issues.join("\n")));
        return card;
      })
      .sort(
        (a, b) =>
          viewOrder.indexOf(Number(a.dataset.index)) -
          viewOrder.indexOf(Number(b.dataset.index)),
      ),
  );
  for (const [key, live] of liveViews)
    if (!keep.has(key)) {
      live.destroy();
      liveViews.delete(key);
    }
  fill(
    $("saveFrom"),
    (state.windows || []).map((w, i) => [
      String(i),
      String.fromCharCode(65 + i) +
        " / " +
        (w.config.label || sourceNames[w.config.source]) +
        " / " +
        human(w.config.seat),
    ]),
  );
  $("toolViewSelection").replaceChildren(
    ...(state.windows || []).map((win, i) => {
      const label = el("label", "check"),
        input = el("input");
      input.type = "checkbox";
      input.dataset.captureIndex = i;
      input.checked = !excluded.has(i);
      input.onchange = () => setCaptureSelection(i, input.checked);
      label.append(
        input,
        document.createTextNode(`View ${String.fromCharCode(65 + i)}`),
      );
      return label;
    }),
  );
  controls();
}
function setCaptureSelection(index, checked) {
  if (checked) excluded.delete(index);
  else excluded.add(index);
  for (const input of document.querySelectorAll(
    `[data-capture-index="${index}"]`,
  ))
    input.checked = checked;
  controls();
}
function refreshPreviews() {
  for (const live of liveViews.values()) live.resize();
}
function field(host, labelText, key, values) {
  const label = el("label", "", labelText),
    input = values ? el("select") : el("input");
  input.setAttribute("aria-label", labelText);
  label.dataset.field = key;
  if (values)
    fill(
      input,
      values,
      key === "viewpointOverride"
        ? (editDraft.overrides?.viewpoint ?? "__follow")
        : key === "interfacePreset"
          ? editDraft.uiMode === "mobile"
            ? "mobile"
            : editDraft.render
          : editDraft[key],
    );
  else {
    input.value =
      key === "tags" ? (editDraft.tags || []).join(", ") : editDraft[key] || "";
    input.maxLength = key === "tags" ? 1600 : 80;
    input.placeholder =
      key === "tags"
        ? "Comma-separated tags"
        : "Optional, e.g. Arien / close camera";
  }
  input.onchange = () => {
    if (key === "viewpointOverride") {
      editDraft.overrides = { ...editDraft.overrides };
      if (input.value === "__follow") delete editDraft.overrides.viewpoint;
      else {
        editDraft.overrides.viewpoint = input.value;
        editDraft.seat = input.value;
      }
      editorBots();
    } else if (key === "interfacePreset") {
      editDraft.render = input.value === "3d" ? "3d" : "2d";
      editDraft.uiMode = input.value === "mobile" ? "mobile" : "desktop";
    } else
      editDraft[key] =
        key === "tags"
          ? input.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : input.value;
    if (key === "seat") editorBots();
    if (["source", "render", "uiMode", "interfacePreset"].includes(key)) {
      normalizeDraft();
      editorFields();
      fill(
        $("viewPresentation"),
        [
          ["", "Keep current / inherit presentation"],
          ...(catalog.presentations || []).map((p) => [p.id, p.name]),
        ],
        "",
      );
    }
  };
  input.oninput = () => {
    if (!values)
      editDraft[key] =
        key === "tags"
          ? input.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : input.value;
  };
  label.append(input);
  host.append(label);
}
function normalizeDraft() {
  editDraft.uiMode ??= "desktop";
  if (editDraft.source === "base") editDraft.uiMode = "desktop";
  if (editDraft.source === "target") {
    editDraft.render = "2d";
    editDraft.uiMode = "desktop";
  }
  if (editDraft.render === "3d") editDraft.uiMode = "desktop";
}
function editorFields() {
  const host = $("editorFields");
  host.replaceChildren();
  const advanced = $("editorAdvancedFields");
  advanced.replaceChildren();
  field(advanced, "View name", "label");
  field(advanced, "View tags", "tags");
  field(host, "Source", "source", Object.entries(sourceNames));
  field(host, "Device", "profile", Object.entries(devices));
  field(host, "Interface preset", "interfacePreset", [
    ["2d", "Desktop · 2D"],
    ...(!["base", "target"].includes(editDraft.source)
      ? [["mobile", "Mobile · 2D"]]
      : []),
    ...(editDraft.source !== "target" ? [["3d", "Desktop · 3D"]] : []),
  ]);
  field(
    advanced,
    "Renderer",
    "render",
    editDraft.source === "target"
      ? [["2d", "2D"]]
      : [
          ["2d", "2D"],
          ["3d", "3D"],
        ],
  );
  field(
    advanced,
    "UI mode",
    "uiMode",
    ["base", "target"].includes(editDraft.source) || editDraft.render === "3d"
      ? [["desktop", "Desktop shell"]]
      : [
          ["desktop", "Desktop shell"],
          ["mobile", "Native mobile shell"],
        ],
  );
  field(host, "Viewpoint", "viewpointOverride", [
    ["__follow", "Follow Layout / inspection"],
    ...editorSeats.map((id) => [id, human(id)]),
    ["spectator", "Spectator"],
  ]);
}
let editorSeats = [],
  editorBotKinds = [];
let rosterEpoch = 0;
const rosterOptions = new Map();
function editorBots() {
  const enabled = editorBotKinds.length > 0 && editDraft.seat !== "spectator";
  $("viewBots").hidden = !enabled;
  $("viewBotsUnavailable").hidden = editorBotKinds.length > 0;
  $("viewBotRows").replaceChildren();
  if (!enabled) return;
  const others = editorSeats.filter((id) => id !== editDraft.seat);
  const choices = others.map((id) => editDraft.bots?.[id] || "manual");
  $("viewBotPreset").value =
    new Set(choices).size <= 1 ? choices[0] || "manual" : "custom";
  if (new Set(choices).size > 1) $("viewBotDetails").open = true;
  for (const id of others) {
    const label = el("label", "", human(id));
    const select = el("select");
    select.dataset.viewBotHero = id;
    select.setAttribute("aria-label", human(id) + " controller");
    fill(
      select,
      [
        ["manual", "Manual"],
        ...editorBotKinds.map((k) => [
          k,
          k === "ismcts" ? "ISMCTS" : k === "heuristic" ? "Simple" : "Random",
        ]),
      ],
      editDraft.bots?.[id] || "manual",
    );
    select.onchange = () => {
      editDraft.bots = { ...(editDraft.bots || {}) };
      if (select.value === "manual") delete editDraft.bots[id];
      else editDraft.bots[id] = select.value;
      editorBots();
    };
    label.append(select);
    $("viewBotRows").append(label);
  }
}
$("viewBotPreset").onchange = () => {
  const kind = $("viewBotPreset").value;
  editDraft.bots =
    kind === "manual"
      ? {}
      : Object.fromEntries(
          editorSeats
            .filter((id) => id !== editDraft.seat)
            .map((id) => [id, kind]),
        );
  editorBots();
};
async function openEditor(i) {
  editing = i;
  creating = !active(i);
  editorCommitted = false;
  editDraft = structuredClone(configs[i]);
  const parent = active(creating ? inheritIndex : i);
  const entries = catalog.situations.map((s) => [s.id, s.name]);
  if (parent)
    entries.unshift([
      "__current",
      creating
        ? `Current state of view ${String.fromCharCode(65 + inheritIndex)}`
        : "Keep current game state",
    ]);
  fill(
    $("viewSituation"),
    entries,
    parent ? "__current" : $("situation").value,
  );
  const selected = catalog.situations.find(
    (s) => s.id === $("viewSituation").value,
  );
  editorSeats =
    parent?.seats ||
    situationTags(selected || {})
      .filter((tag) => tag.startsWith("hero:"))
      .map((tag) => "hero_" + tag.slice(5).replaceAll("-", "_"));
  if (!editorSeats.length)
    editorSeats = [editDraft.seat || "hero_arien"].filter(
      (seat) => seat !== "spectator",
    );
  editing = i;
  if (editDraft.seat !== "spectator" && !editorSeats.includes(editDraft.seat))
    editDraft.seat = editorSeats[0];
  $("editorEyebrow").textContent = `VIEW ${String.fromCharCode(65 + i)}`;
  $("editorTitle").textContent =
    configs[i].label || sourceNames[configs[i].source];
  fill(
    $("viewPresentation"),
    [
      ["", "Keep current / inherit presentation"],
      ...(catalog.presentations || []).map((p) => [p.id, p.name]),
    ],
    "",
  );
  $("viewAdvanced").open = false;
  $("playOptions").open =
    !!editDraft.autoSwitch || Object.keys(editDraft.bots || {}).length > 0;
  $("viewBotDetails").open = false;
  editorFields();
  $("editorSubmit").textContent = creating ? "Start" : "Save";
  $("viewAutoSwitch").checked = !!editDraft.autoSwitch;
  editorBots();
  const tools = $("editorTools");
  tools.replaceChildren();
  const action = (text, label, fn) => {
    const b = button(text, () => task(label, fn));
    b.dataset.needsWindow = i;
    if (text === "Remove view") b.classList.add("danger");
    tools.append(b);
  };
  action("Remove view", "Removing view…", async () => {
    await call("views/remove", { index: i });
    configs.splice(i, 1);
    if (!configs.length) customSetup = false;
    $("count").value = configs.length;
    expandedIndex = null;
    excluded.clear();
    editorCommitted = true;
    $("editor").close();
  });
  action("Reset this view", "Resetting view…", () =>
    call("reset", { index: i }),
  );
  action("Rotate phone", "Rotating view…", () =>
    call("configure", {
      index: i,
      update: {
        profile:
          active(i).config.profile === "landscape" ? "portrait" : "landscape",
      },
    }),
  );
  action("Use device for all", "Updating devices…", () =>
    call("configure", { update: { profile: editDraft.profile } }),
  );
  action("Use viewpoint for all", "Updating viewpoints…", () =>
    call("configure", {
      update: { seat: editDraft.seat, overrides: editDraft.overrides },
    }),
  );
  action("Copy camera to matching views", "Copying camera…", () =>
    call("camera", {
      from: i,
      indexes: state.windows
        .filter((w) => w.config.render === active(i).config.render)
        .map((w) => w.index),
    }),
  );
  const row = el("div", "tool-row"),
    panes = el("select");
  panes.setAttribute("aria-label", "Panel");
  fill(panes, Object.entries(paneNames));
  row.append(
    panes,
    button("Open panel", () =>
      task("Opening panel…", () =>
        call("pane", { index: i, pane: panes.value }),
      ),
    ),
  );
  tools.append(row);
  const heroRow = el("div", "tool-row"),
    heroes = el("select");
  heroes.setAttribute("aria-label", "Hero to inspect");
  fill(
    heroes,
    (active(i)?.seats || ["hero_arien"]).map((id) => [id, human(id)]),
  );
  heroRow.append(
    heroes,
    button("Inspect hero", () =>
      task("Inspecting hero…", () =>
        call("hero", { index: i, heroId: heroes.value }),
      ),
    ),
  );
  tools.append(heroRow);
  tools.querySelectorAll("button").forEach((b) => (b.dataset.needsWindow = i));
  $("editor").showModal();
  positionViewEditor();
  controls();
  void updateEditorRoster().then((updated) => {
    if (updated) {
      if (!parent) editorFields();
      else editorBots();
    }
  });
}
function positionViewEditor() {
  const editor = $("editor");
  if (!editor.open) return;
  const card = document.querySelector(`.slot[data-index="${editing}"]`);
  const rect =
    editorOnlyIndex !== null
      ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
      : card?.getBoundingClientRect();
  if (!rect || !rect.width) return;
  editor.classList.add("view-overlay");
  Object.assign(editor.style, {
    left: Math.max(0, rect.left) + "px",
    top: Math.max(0, rect.top) + "px",
    right: "auto",
    bottom: "auto",
    width: Math.min(rect.width, innerWidth) + "px",
    height: Math.min(rect.height, innerHeight - Math.max(0, rect.top)) + "px",
  });
}
window.addEventListener("resize", positionViewEditor);
window.addEventListener("scroll", positionViewEditor, true);
async function openEmbeddedEditor() {
  if (editorOnlyIndex === null || editorOnlyOpened || !initialized) return;
  editorOnlyOpened = true;
  if (!Number.isInteger(editorOnlyIndex) || !active(editorOnlyIndex)) {
    window.parent.postMessage({ type: "lab-editor-closed" }, location.origin);
    return;
  }
  await openEditor(editorOnlyIndex);
}
async function updateEditorRoster() {
  const epoch = ++rosterEpoch,
    draft = editDraft,
    viewIndex = editing;
  try {
    const selected = $("viewSituation").value;
    const parent = active(creating ? inheritIndex : editing);
    const situationId =
      selected === "__current"
        ? parent?.situationId || state.situationId
        : selected;
    const key =
      selected === "__current" && parent
        ? "game:" + parent.gameId
        : "decision:" +
          (catalog.situations.find((s) => s.id === situationId)
            ?.decisionStateId || situationId);
    if (!rosterOptions.has(key)) {
      const pending = read(
        `/api/device/options?situationId=${encodeURIComponent(situationId || "")}`,
      ).catch((error) => {
        rosterOptions.delete(key);
        throw error;
      });
      rosterOptions.set(key, pending);
    }
    const options = await rosterOptions.get(key);
    if (
      epoch !== rosterEpoch ||
      draft !== editDraft ||
      editing !== viewIndex ||
      !$("editor").open ||
      selected !== $("viewSituation").value
    )
      return false;
    editorSeats =
      selected === "__current" && parent
        ? parent.seats
        : options.seats.filter((s) => s.id !== "spectator").map((s) => s.id);
    editorBotKinds = (options.botKinds || []).filter((k) =>
      ["random", "heuristic", "ismcts"].includes(k),
    );
    if (editDraft.seat !== "spectator" && !editorSeats.includes(editDraft.seat))
      editDraft.seat = editorSeats[0];
    editDraft.bots = Object.fromEntries(
      Object.entries(editDraft.bots || {}).filter(([id]) =>
        editorSeats.includes(id),
      ),
    );
    return true;
  } catch (error) {
    if (epoch === rosterEpoch && $("editor").open) showError(error);
    return false;
  }
}
$("viewSituation").onchange = async () => {
  if (await updateEditorRoster()) {
    editorFields();
    editorBots();
  }
};
$("addView").onclick = async () => {
  if (configs.length >= 3) return;
  inheritIndex = active(focusedIndex) ? focusedIndex : 0;
  draftIndex = configs.length;
  configs.push(
    structuredClone(configs[inheritIndex] || catalog.presets.Current[0]),
  );
  $("count").value = configs.length;
  expandedIndex = null;
  render();
  await openEditor(draftIndex);
  if (!$("editor").open) cancelViewDraft();
};
function cancelViewDraft() {
  if (draftIndex !== null) {
    configs.splice(draftIndex, 1);
    $("count").value = configs.length;
    draftIndex = null;
    render();
  }
}
$("editor").addEventListener("cancel", (event) => {
  if (running || state.busy) event.preventDefault();
});
$("editor").addEventListener("close", () => {
  if (editorOnlyIndex !== null)
    window.parent.postMessage({ type: "lab-editor-closed" }, location.origin);
  if (!editorCommitted) cancelViewDraft();
});
$("editorForm").onsubmit = (event) => {
  event.preventDefault();
  const i = editing;
  const update = { ...editDraft, autoSwitch: $("viewAutoSwitch").checked };
  const selected = $("viewSituation").value;
  void task(creating ? "Starting view..." : "Saving view...", async () => {
    if (Object.hasOwn(update, "tags")) update.tags = normalizeTags(update.tags);
    if (creating || selected !== "__current") {
      await call("views/add", {
        config: update,
        ...(selected === "__current"
          ? { fromIndex: inheritIndex }
          : { situationId: selected }),
        ...(!creating ? { index: i } : {}),
      });
    } else await call("configure", { index: i, update });
    if ($("viewPresentation").value)
      await call("presentation/apply", {
        index: i,
        id: $("viewPresentation").value,
      });
    editorCommitted = true;
    draftIndex = null;
    $("editor").close();
  });
};
let organizing = null;
function organizeSituation(situation, promote = false) {
  organizing = { situation, promote };
  $("organizeTitle").textContent = promote
    ? "Add to library"
    : "Move situation";
  $("organizeSubmit").textContent = promote ? "Add to library" : "Move";
  $("organizeNote").textContent = promote
    ? "Creates a repo-visible copy for Git review. Your local draft is kept."
    : situation.origin === "library"
      ? "Moves the shared JSON file within library/situations/."
      : "Moves the local draft within .layout-lab/situations/.";
  $("organizeGroup").value = situation.group || "";
  $("organizeDialog").showModal();
}
$("organizeForm").onsubmit = (event) => {
  event.preventDefault();
  const { situation, promote } = organizing;
  const group = $("organizeGroup").value.trim();
  $("organizeDialog").close();
  void task(
    promote ? "Adding to library..." : "Moving situation...",
    async () => {
      await call("organize", {
        id: situation.id,
        group,
        shared: promote || situation.origin === "library",
      });
      await reloadCatalog();
      notify(
        promote
          ? "Added to library. Ready for Git review."
          : "Situation moved.",
      );
    },
    { sync: false },
  );
};
$("libraryGroup").onchange = renderLibrary;
$("libraryOrigin").onchange = renderLibrary;
$("librarySearch").oninput = renderLibrary;
document.addEventListener(
  "toggle",
  (event) => {
    const menu = event.target;
    if (!menu.matches?.(".action-menu") || !menu.open) return;
    for (const other of document.querySelectorAll(".action-menu[open]"))
      if (other !== menu) other.open = false;
    const popup = menu.querySelector(".menu-items");
    menu.classList.toggle(
      "opens-up",
      popup.getBoundingClientRect().bottom > innerHeight - 8 &&
        menu.getBoundingClientRect().top > popup.offsetHeight,
    );
  },
  true,
);
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll(".action-menu[open]"))
    if (
      !menu.contains(event.target) ||
      event.target.closest(".menu-items button,.menu-items a")
    )
      menu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const menu of document.querySelectorAll(".action-menu[open]")) {
    menu.open = false;
    menu.querySelector("summary").focus();
    event.preventDefault();
  }
});
const selectedTags = new Set();
let tagTarget;
function editTags(kind, record) {
  if (!record) return;
  tagTarget = { kind, id: record.id, origin: record.origin };
  $("tagsRecordName").textContent = record.name;
  $("tagsInput").value = (record.tags || []).join(", ");
  $("tagsInheritedNote").textContent =
    kind === "situation" && record.decisionStateTags?.length
      ? "Inherited from Decision State: " +
        record.decisionStateTags.join(", ") +
        ". Edit that state to change these tags."
      : "";
  $("tagsInheritedNote").hidden = !$("tagsInheritedNote").textContent;
  $("tagsDialog").querySelector("[data-dialog-error]")?.remove();
  $("tagsDialog").showModal();
}
$("tagsForm").onsubmit = (event) => {
  event.preventDefault();
  void task(
    "Saving tags…",
    async () => {
      const tags = parseTags($("tagsInput").value);
      const saved = await call("tags", { ...tagTarget, tags });
      if (tagTarget.kind === "situation") {
        const record = catalog.situations.find((s) => s.id === tagTarget.id);
        if (record) record.tags = tags;
      } else if (tagTarget.kind === "decision-state") {
        const record = (catalog.decisionStates || []).find(
          (d) => d.id === tagTarget.id,
        );
        const origin = saved.origin || tagTarget.origin || record?.origin;
        for (const situation of catalog.situations) {
          if (situation.decisionStateId !== tagTarget.id) continue;
          const localCopy = record?.origin === "local";
          if (
            (origin === "local" && situation.origin === "local") ||
            (origin !== "local" &&
              (situation.origin === "library" || !localCopy))
          )
            situation.decisionStateTags = tags;
        }
        if (record && (!origin || record.origin === origin)) record.tags = tags;
      } else {
        const record = (catalog.layouts || []).find(
          (l) => l.id === tagTarget.id,
        );
        if (record) Object.assign(record, saved);
      }
      $("tagsDialog").close();
      if ($("composeSituationDialog").open) refreshDecisionTags();
      if ($("workspaceToolsDialog").open) refreshLayoutTags();
      renderLibrary();
      notify("Tags saved.");
    },
    { sync: false, refreshCatalog: false },
  );
};
function refreshDecisionTags() {
  const record = (catalog.decisionStates || []).find(
    (d) => d.id === $("composeDecisionState").value,
  );
  $("composeStateTags").replaceChildren(tagList(record?.tags || []));
  $("editDecisionTags").disabled = !record;
}
$("composeDecisionState").onchange = refreshDecisionTags;
$("editDecisionTags").onclick = () =>
  editTags(
    "decision-state",
    (catalog.decisionStates || []).find(
      (d) => d.id === $("composeDecisionState").value,
    ),
  );
$("libraryTag").onchange = () => {
  if ($("libraryTag").value) selectedTags.add($("libraryTag").value);
  renderLibrary();
};
function renderLibrary() {
  const folder = $("libraryGroup").value,
    origin = $("libraryOrigin").value,
    query = $("librarySearch").value.trim().toLowerCase();
  const tagCounts = new Map();
  for (const situation of catalog.situations)
    for (const tag of situationTags(situation))
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  $("libraryTag").replaceChildren(option("", "Add tag filter…"));
  const tagGroups = new Map();
  for (const [tag, count] of [...tagCounts].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (selectedTags.has(tag)) continue;
    const type = tagType(tag);
    if (!tagGroups.has(type)) {
      const group = document.createElement("optgroup");
      group.label = type.charAt(0).toUpperCase() + type.slice(1);
      tagGroups.set(type, group);
      $("libraryTag").append(group);
    }
    tagGroups.get(type).append(option(tag, tagLabel(tag) + " (" + count + ")"));
  }
  const filters = $("activeTagFilters");
  filters.replaceChildren();
  filters.hidden = !selectedTags.size;
  for (const tag of selectedTags) {
    const remove = button(tagLabel(tag) + " ×", () => {
      selectedTags.delete(tag);
      renderLibrary();
    });
    remove.className = "tag-chip";
    remove.dataset.tagType = tagType(tag);
    remove.title = tag;
    remove.setAttribute("aria-label", "Remove tag filter " + tag);
    filters.append(remove);
  }
  if (selectedTags.size)
    filters.append(
      button("Clear tags", () => {
        selectedTags.clear();
        renderLibrary();
      }),
    );
  const filtered = catalog.situations.filter(
    (s) =>
      [...selectedTags].every((tag) => situationTags(s).includes(tag)) &&
      (!query ||
        `${s.name} ${s.description || ""} ${s.group || ""} ${situationTags(s).join(" ")}`
          .toLowerCase()
          .includes(query)) &&
      (!origin || s.origin === origin) &&
      (!folder ||
        (folder === "__root"
          ? !s.group
          : s.group === folder || s.group?.startsWith(folder + "/"))),
  );
  filteredSituations = filtered;
  $("libraryResults").textContent =
    `${filtered.length} of ${catalog.situations.length}`;
  for (const id of reviewSelection)
    if (!catalog.situations.some((s) => s.id === id))
      reviewSelection.delete(id);
  $("library").replaceChildren();
  const groups = new Map();
  for (const s of filtered) {
    const key =
      (s.origin === "library" ? "Library" : "Local drafts") +
      " / " +
      (s.group || "Unfiled");
    if (!groups.has(key)) {
      const section = el("section", "situation-group");
      section.append(el("h2", "folder-heading", key));
      groups.set(key, section);
      $("library").append(section);
    }
    const card = el("article", "situation-card"),
      text = el("div", "situation-info");
    const heading = el("div", "situation-heading");
    const name = el("h3", "", s.name);
    name.title = s.name;
    heading.append(
      name,
      tagList(situationTags(s), (tag) => {
        selectedTags.add(tag);
        renderLibrary();
      }),
    );
    const description = el("details", "situation-description");
    const descriptionSummary = el("summary");
    descriptionSummary.setAttribute("aria-label", "Description for " + s.name);
    descriptionSummary.append(
      el(
        "span",
        "",
        s.description ||
          `${human(s.summary.phase)}, round ${s.summary.round}. ${s.summary.decision ? human(s.summary.decision) + "." : "Saved game moment."}`,
      ),
    );
    description.append(
      descriptionSummary,
      el(
        "p",
        "situation-context",
        human(s.summary.phase) +
          " · Round " +
          s.summary.round +
          (s.summary.decision ? " · " + human(s.summary.decision) : ""),
      ),
    );
    text.append(heading, description);
    const selection = el("input");
    selection.type = "checkbox";
    selection.checked = reviewSelection.has(s.id);
    selection.setAttribute("aria-label", `Select situation ${s.name}`);
    selection.dataset.situationId = s.id;
    selection.onchange = () => {
      if (selection.checked) reviewSelection.add(s.id);
      else reviewSelection.delete(s.id);
      updateReviewControls();
    };
    const selectLabel = el("label", "situation-select");
    selectLabel.append(selection);
    card.append(selectLabel);
    const menu = el("details", "action-menu situation-menu");
    const summary = el("summary", "", "More");
    summary.setAttribute("aria-label", `Actions for ${s.name}`);
    const secondary = el("div", "menu-items");
    menu.append(summary, secondary);
    const exportLink = el("a", "", "Export");
    exportLink.href = "/export/" + s.id;
    if (
      /^(?:(?:reviews\/[a-f0-9]{24}\/reports\/)?(?:device\/[a-f0-9]{12}|element-[a-f0-9-]{36}))$/.test(
        s.provenance?.report || "",
      )
    ) {
      const reportLink = el("a", "", "View report");
      reportLink.href = "/reports/" + s.provenance.report + "/index.html";
      reportLink.target = "_blank";
      reportLink.rel = "noreferrer";
      secondary.append(reportLink);
    }
    card.append(text);
    secondary.append(
      exportLink,
      button("Move", () => organizeSituation(s)),
      button("Edit tags", () => editTags("situation", s)),
      button("Edit Decision State tags", () =>
        editTags("decision-state", {
          id: s.decisionStateId,
          name: "Decision State for " + s.name,
          origin:
            s.origin === "library"
              ? "library"
              : (catalog.decisionStates || []).find(
                  (d) => d.id === s.decisionStateId,
                )?.origin,
          tags: s.decisionStateTags || [],
        }),
      ),
      button("Open on device", () => void openDevice(s.id)),
    );
    if (s.origin !== "library")
      secondary.append(
        button("Add to library", () => organizeSituation(s, true)),
      );
    card.append(
      button("Open situation", () => {
        $("situation").value = s.id;
        navigate("compare");
        void loadComparison();
      }),
    );
    card.append(menu);
    groups.get(key).append(card);
  }
  if (!filtered.length)
    $("library").append(
      el(
        "p",
        "library-note",
        "No matching situations. Try another search or filter.",
      ),
    );
  updateReviewControls();
}

function updateReviewControls() {
  const busy = running || state.busy || disconnected,
    review = state.reviewRun;
  const chosen = filteredSituations.filter((s) =>
    reviewSelection.has(s.id),
  ).length;
  $("reviewSelectFiltered").checked =
    filteredSituations.length > 0 && chosen === filteredSituations.length;
  $("reviewSelectFiltered").indeterminate =
    chosen > 0 && chosen < filteredSituations.length;
  $("reviewSelectFiltered").disabled = !!busy || !filteredSituations.length;
  $("reviewSelectedCount").textContent =
    `${reviewSelection.size} selected (${chosen} in filter)`;
  $("reviewStart").disabled =
    !!busy || !reviewSelection.size || !!review?.active;
  $("reviewClearSelection").disabled = !!busy || !reviewSelection.size;
  $("reviewClearSelection").hidden = reviewSelection.size === 0;
  $("reviewNameField").hidden = reviewSelection.size === 0;
  $("reviewBar").hidden = !review;
  if (review) {
    $("reviewTitle").textContent = `${review.performedBy === "agent" ? "Agentic review · " : ""}${review.name}`;
    $("reviewProgress").textContent =
      `${review.index + 1} / ${review.total} · ${review.situationName}${review.active ? "" : " · Finished"}`;
    $("reviewPrevious").disabled = !!busy || !review.previous;
    $("reviewNext").disabled = !!busy || !review.next;
    $("reviewEnd").disabled = !!busy || !review.active;
    $("reviewEnd").hidden = !review.active;
    $("reviewCollection").href = review.url;
  }
  if (review?.active)
    document.querySelectorAll("[data-review-setup]").forEach((b) => {
      b.disabled = true;
      b.title = "End the review before changing view setup.";
    });
  if (review?.active)
    for (const id of [
      "load",
      "reset",
      "clear",
      "addView",
      "preset",
      "count",
      "situation",
      "synchronize",
      "liveUpdates",
      "revision",
      "refresh",
    ])
      $(id).disabled = true;
}
$("reviewSelectFiltered").onchange = () => {
  for (const s of filteredSituations)
    if ($("reviewSelectFiltered").checked) reviewSelection.add(s.id);
    else reviewSelection.delete(s.id);
  renderLibrary();
};
$("reviewClearSelection").onclick = () => {
  reviewSelection.clear();
  renderLibrary();
};
let reviewDraft = [];
function renderReviewDraft() {
  $("reviewSetupEntries").replaceChildren(
    ...reviewDraft.map((entry, index) => {
      const row = el("div", "review-entry-setup");
      row.append(el("strong", "", entry.name));
      const select = el("select");
      select.setAttribute("aria-label", "Presentation for " + entry.name);
      fill(select, [
        ["", "Default presentation"],
        ...(catalog.presentations || []).map((p) => [p.id, p.name]),
      ]);
      select.value = entry.presetId;
      select.onchange = () => (entry.presetId = select.value);
      const actions = el("div", "entry-actions");
      actions.append(
        button("Add another inspection", () => {
          reviewDraft.splice(index + 1, 0, { ...entry });
          renderReviewDraft();
        }),
        button("Remove", () => {
          reviewDraft.splice(index, 1);
          renderReviewDraft();
        }),
      );
      const details = el("details");
      details.append(el("summary", "", "Specific card (this inspection only)"));
      const card = el("input");
      card.placeholder = "Card ID, e.g. noble_blade";
      card.setAttribute("aria-label", "Specific card for " + entry.name);
      card.value = entry.cardId || "";
      card.oninput = () => (entry.cardId = card.value.trim());
      const mode = el("select");
      mode.setAttribute("aria-label", "Card action for " + entry.name);
      fill(mode, [
        ["inspectedCard", "Inspect card"],
        ["selectedCard", "Select planning card"],
      ]);
      mode.value = entry.cardAction || "inspectedCard";
      mode.onchange = () => (entry.cardAction = mode.value);
      details.append(card, mode);
      row.append(select, details, actions);
      return row;
    }),
  );
  $("reviewSetupForm").querySelector('[type="submit"]').disabled =
    !reviewDraft.length;
}
$("reviewStart").onclick = () => {
  reviewDraft = catalog.situations
    .filter((s) => reviewSelection.has(s.id))
    .map((s) => ({
      situationId: s.id,
      name: s.name,
      presetId: $("inspectionPresentation").value,
    }));
  renderReviewDraft();
  $("reviewSetupDialog").showModal();
};
$("reviewSetupForm").onsubmit = (event) => {
  event.preventDefault();
  void task("Starting review…", async () => {
    const entries = reviewDraft.map(
      ({ situationId, presetId, cardId, cardAction }) => {
        const template = (catalog.presentations || []).find(
          (p) => p.id === presetId,
        );
        return {
          situationId,
          ...(template || cardId
            ? {
                presentation: {
                  schema: 2,
                  sessionState: {
                    ...template?.state?.sessionState,
                    ...(cardId
                      ? { [cardAction || "inspectedCard"]: cardId }
                      : {}),
                  },
                },
              }
            : {}),
        };
      },
    );
    const result = await call("review-runs/start", {
      entries,
      name: $("reviewName").value,
      performedBy: "human",
      slots: configs.length ? configs : catalog.presets.Current,
    });
    $("reviewSetupDialog").close();
    navigate("compare");
    return result;
  });
};

for (const [id, direction] of [
  ["reviewPrevious", -1],
  ["reviewNext", 1],
])
  $(id).onclick = () =>
    void task("Loading review situation…", () =>
      call("review-runs/step", {
        id: state.reviewRun.id,
        index: state.reviewRun.index,
        direction,
      }),
    );
$("reviewEnd").onclick = () =>
  void task("Ending review…", () => call("review-runs/end"));

function definitionList(host, entries) {
  host.replaceChildren();
  for (const [key, value] of entries) {
    host.append(el("dt", "", key), el("dd", "", String(value ?? "—")));
  }
}
function renderSettings() {
  definitionList($("refs"), [
    ["Base frontend", state.references?.base || catalog.settings?.baseRef],
    [
      "Userscript target",
      state.references?.script || catalog.settings?.scriptRef,
    ],
  ]);
  definitionList($("runtimeSettings"), [
    [
      "Runtime",
      state.runtime
        ? `${state.runtime.mode} · ${state.runtime.platform} / ${state.runtime.arch}`
        : "Connecting",
    ],
    ["Display", state.display || catalog.settings?.display || "embedded"],
    ["Default comparison", catalog.settings?.preset || "Mobile migration"],
    [
      "Comparator branch / revision",
      catalog.settings?.comparatorRef || "mobile-migration",
    ],
    ["Frontend checkout", catalog.settings?.frontend],
    ["Game backend checkout", catalog.settings?.backend],
    ["Bot decision checkout", catalog.settings?.botBackend],
    ["Userscript checkout", catalog.settings?.patch],
    [
      "Ports",
      catalog.settings?.ports
        ? Object.entries(catalog.settings.ports)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")
        : "Using launcher defaults",
    ],
  ]);
}
function updateStatus() {
  if (disconnected) return;
  const count = state.windows?.length || 0;
  const preparing = state.services?.some((s) => s.name.startsWith("prepare-"));
  $("status").textContent =
    operation ||
    (preparing
      ? "Installing dependencies for a source version. First use can take a few minutes."
      : state.busy
        ? `Opening comparison views… ${count} ready so far.`
        : draftSetup
          ? "Setup changed. Load to apply."
          : count
            ? `${count} ${count === 1 ? "view" : "views"} / clocks frozen`
            : "Choose a quickstart or a comparison Layout.");
  $("connection").textContent =
    running || state.busy ? "Working locally" : "Connected";
  $("connectionDot").classList.remove("offline");
  $("buildSha").textContent = state.comparator?.slice(0, 8) || "…";
  const liveBuild = (state.windows || []).some(
    (w) => w.config.source === "live",
  );
  $("buildKind").textContent = liveBuild ? "Live working tree" : "Build ";
  $("buildSha").hidden = liveBuild;
  if (!running) $("synchronize").value = state.synchronization?.mode || "none";
  if (!running) $("showCheats").checked = !!state.synchronization?.cheats;
  if (!running)
    $("liveUpdates").checked = (state.windows || []).some(
      (w) => w.config.source === "live",
    );
  $("liveUpdates").disabled =
    running ||
    state.busy ||
    !(state.windows || []).some((w) =>
      ["live", "comparator"].includes(w.config.source),
    );
  if (state.synchronization?.pending)
    $("status").textContent += " / synchronizing";
  if (state.synchronization?.skipped)
    $("status").textContent +=
      " / " + state.synchronization.skipped + " unmatched UI controls skipped";
  if (state.synchronization?.error) showError(state.synchronization.error);
  $("browserNote").hidden =
    !!window.layoutLabDesktop || state.display !== "native";
}
async function poll() {
  state = await read("/api/status");
  const key = (state.windows || []).map(viewKey).join("|");
  if (
    initialized &&
    key !== lastWindowKey &&
    !state.busy &&
    !running &&
    !draftSetup &&
    draftIndex === null &&
    !$("editor").open
  ) {
    if (
      state.situationId &&
      !catalog.situations.some((s) => s.id === state.situationId)
    )
      await reloadCatalog();
    if (state.windows?.length) {
      syncViews();
      if (state.situationId) $("situation").value = state.situationId;
    }
    render();
    void refreshPreviews();
  }
  if (!state.busy && !running && draftIndex === null && !$("editor").open)
    lastWindowKey = key;
  updateStatus();
  controls();
  renderSettings();
  $("processes").textContent = JSON.stringify(state.services, null, 2);
  if (state.lastError && !running) showError(state.lastError);
}
async function refreshConnection() {
  if (checking || stopped) return;
  checking = true;
  try {
    if (!initialized) await reloadCatalog();
    if (disconnected) $("error").hidden = true;
    disconnected = false;
    await poll();
    if (!initialized) {
      if (state.windows?.length && !state.busy) syncViews();
      else {
        configs = [];
        $("count").value = "0";
        draftSetup = false;
      }
      if (state.situationId) $("situation").value = state.situationId;
      render();
      initialized = true;
      updateStatus();
      void refreshPreviews();
    }
  } catch (error) {
    disconnected = true;
    initialized = false;
    $("status").textContent =
      "Disconnected from the desk. Keep its launch terminal running; reconnecting automatically…";
    $("connection").textContent = "Disconnected";
    $("connectionDot").classList.add("offline");
    showError(error);
    controls();
  } finally {
    checking = false;
  }
}
function inspectionInstruction() {
  const preset = (catalog.presentations || []).find(
    (p) => p.id === $("inspectionPresentation").value,
  );
  return preset ? { presentation: preset.state } : {};
}
async function loadComparison() {
  // Opening a Situation from the library also works before choosing a Layout.
  if (!configs.length) {
    $("preset").value = "Current";
    setPreset();
  }
  $("workspaceToolsDialog").close();
  return task("Loading comparison…", async () => {
    state = await call("load", {
      situationId: $("situation").value,
      ...inspectionInstruction(),
      slots: configs,
      ...($("preset").value !== "__custom"
        ? {
            layoutId: (catalog.layouts || []).find(
              (l) => l.name === $("preset").value,
            )?.id,
          }
        : {}),
    });
    syncViews();
    $("workspaceToolsDialog").close();
    notify("Comparison loaded.");
  });
}
for (const option of document.querySelectorAll("[data-start-layout]")) {
  option.onclick = () => {
    customSetup = false;
    $("preset").value = option.dataset.startLayout;
    setPreset();
    const placeholder = el("option", "", "Choose a Situation…");
    placeholder.value = "";
    $("situation").prepend(placeholder);
    $("situation").value = "";
    controls();
    $("situation").focus();
  };
}
$("startOver").onclick = () => {
  customSetup = false;
  configs = [];
  $("count").value = "0";
  draftSetup = false;
  render();
  controls();
};
$("customStart").onclick = () => {
  customSetup = true;
  $("preset").value = "Current";
  setPreset();
  controls();
};
for (const option of document.querySelectorAll("[data-quickstart]")) {
  option.onclick = () =>
    void task("Starting 2v2 against bots…", async () => {
      const result = await call("quickstart", {
        id: option.dataset.quickstart,
      });
      if (result.device) {
        await openDevice.showPrepared(result.device);
        notify("Device ready. Scan the QR code to play your team.");
      } else {
        state = result.comparison;
        syncViews();
        $("situation").value = state.situationId;
        notify("2v2 ready. Autoswitch follows your team's decisions.");
      }
    });
}
$("preset").onchange = () => {
  setPreset();
  refreshLayoutTags();
};
$("count").onchange = () => {
  draftSetup = true;
  render();
  updateStatus();
};
$("situation").onchange = () => {
  draftSetup = $("situation").value !== state.situationId;
  updateStatus();
  controls();
};
function refreshLayoutTags() {
  const record = (catalog.layouts || []).find(
    (l) => l.name === $("preset").value,
  );
  $("layoutTags").replaceChildren(tagList(record?.tags || []));
  $("editLayoutTags").disabled = !record;
}
$("editLayoutTags").onclick = () =>
  editTags(
    "layout",
    (catalog.layouts || []).find((l) => l.name === $("preset").value),
  );
let toolsDraft = null;
$("workspaceTools").onclick = () => {
  toolsDraft = {
    configs: structuredClone(configs),
    draftSetup,
    situation: $("situation").value,
  };
  refreshLayoutTags();
  $("workspaceToolsDialog").showModal();
};

$("workspaceToolsDialog").addEventListener("close", () => {
  if (toolsDraft && !running) {
    configs = toolsDraft.configs;
    $("count").value = configs.length;
    draftSetup = toolsDraft.draftSetup;
    $("situation").value = toolsDraft.situation;
    render();
    updateStatus();
  }
  toolsDraft = null;
});
$("load").onclick = loadComparison;
$("reset").onclick = () => task("Resetting views…", () => call("reset"));
$("clear").onclick = () =>
  task(
    "Closing comparison…",
    async () => {
      await call("clear");
      state.windows = [];
      configs = [];
      $("count").value = "0";
      draftSetup = false;
      customSetup = false;
      for (const live of liveViews.values()) live.destroy();
      liveViews.clear();
    },
    { sync: false },
  );

$("composeSituation").onclick = () => {
  fill(
    $("composeDecisionState"),
    (catalog.decisionStates || []).map((d) => [d.id, d.name]),
  );

  $("composeSituationName").value = "";
  refreshDecisionTags();
  $("composeSituationDialog").showModal();
};
$("composeSituationForm").onsubmit = (event) => {
  event.preventDefault();
  void task("Creating Situation…", async () => {
    const s = await call("situation/compose", {
      name: $("composeSituationName").value,
      decisionStateId: $("composeDecisionState").value,
    });
    $("composeSituationDialog").close();
    await reloadCatalog();
    $("situation").value = s.id;
    notify("Situation created.");
  });
};
function saveTagDefaults() {
  const kind = $("saveKind").value;
  const view = state.windows?.[Number($("saveFrom").value)];
  const situation =
    catalog.situations.find((s) => s.id === view?.situationId) ||
    selectedSituation();
  const tags =
    kind === "setup"
      ? (catalog.layouts || []).find((l) => l.name === $("preset").value)?.tags
      : kind === "decision-state"
        ? situation?.decisionStateTags
        : situation?.tags;
  $("saveTags").value = (tags || []).join(", ");
}
$("saveFrom").onchange = saveTagDefaults;
$("saveKind").onchange = () => {
  $("saveFrom").closest("label").hidden = $("saveKind").value === "setup";
  $("saveTagsField").hidden = $("saveKind").value === "presentation";
  $("presentationChangeField").hidden = $("saveKind").value !== "presentation";
  saveTagDefaults();
};
$("save").onclick = () => {
  $("name").value = "";
  $("saveTags").value = (selectedSituation()?.tags || []).join(", ");
  $("saveKind").onchange();
  $("saveDialog").showModal();
};
$("saveForm").onsubmit = (event) => {
  event.preventDefault();
  const name = $("name").value.trim();
  if (!name) return;
  const index = Number($("saveFrom").value);
  $("saveDialog").close();
  void task("Saving situation…", async () => {
    if ($("saveKind").value === "presentation") {
      await call("presentation/save", {
        name,
        index,
        field: $("presentationChange").value,
      });
      notify("Presentation saved separately.");
      return;
    }
    if ($("saveKind").value === "setup") {
      await call("layout/save", {
        name,
        slots: configs,
        tags: parseTags($("saveTags").value),
      });
      notify("Layout saved in Workspace tools.");
      return;
    }
    const s = await call("save", {
      name,
      index,
      kind: $("saveKind").value,
      tags: parseTags($("saveTags").value),
    });
    if ($("saveKind").value === "decision-state") {
      await reloadCatalog();
      notify(
        "Decision State saved. It can be reused when creating a Situation.",
      );
      return;
    }
    await reloadCatalog();
    $("situation").value = s.id;
    notify("Situation saved.");
  });
};
function updateCropControls(busy = running || state.busy || disconnected) {
  $("cropOccurrence").closest("label").hidden = $("cropMatch").value !== "nth";
  for (const id of ["cropSelector", "cropMatch", "cropOccurrence"])
    $(id).disabled = !!busy || !$("cropEnabled").checked;
  $("capture").textContent = $("cropEnabled").checked
    ? "Capture crop"
    : "Capture";
}
$("cropMatch").onchange = () => updateCropControls();
$("cropEnabled").onchange = () => updateCropControls();
$("captureFromTools").onclick = () => {
  $("workspaceToolsDialog").close();
  $("capture").click();
};
$("capture").onclick = () =>
  task("Capturing settled views…", async () => {
    const indexes = state.windows
      .map((w) => w.index)
      .filter((i) => !excluded.has(i));
    if (indexes.length < 1)
      throw new Error("Select Capture on at least one view.");
    const crop = $("cropEnabled").checked
      ? {
          selector: $("cropSelector").value,
          match: $("cropMatch").value,
          ...($("cropMatch").value === "nth"
            ? { occurrence: Number($("cropOccurrence").value) }
            : {}),
        }
      : null;
    const result = await call("capture", {
      indexes,
      ...(crop ? { crop } : {}),
    });
    const text = el("div");
    text.append(
      el("h3", "", "Capture saved"),
      el(
        "p",
        "",
        result.diverged
          ? "These views have different game states. The report marks the differences."
          : "Screenshots, overlay and pixel differences.",
      ),
    );
    const a = el("a", "", "Open report ↗");
    a.href = result.url;
    a.target = "_blank";
    a.rel = "noopener";
    $("report").replaceChildren(text, a);
    $("report").hidden = false;
    $("workspaceToolsDialog").close();
    notify("Comparison captured.");
  });
$("extractMode").onchange = () => {
  $("extractSelector").placeholder =
    $("extractMode").value === "element"
      ? "Required CSS selector"
      : "Used only for element extraction";
};
$("extract").onclick = () =>
  task("Extracting HTML and CSS…", async () => {
    const indexes = state.windows
      .map((w) => w.index)
      .filter((i) => !excluded.has(i));
    if (indexes.length !== 2)
      throw Error("Select Capture on exactly two views.");
    const result = await call("extract", {
      indexes,
      mode: $("extractMode").value,
      selector: $("extractSelector").value,
    });
    const title = el("h3", "", "HTML and CSS saved");
    const link = el("a", "", "Open source comparison ↗");
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noopener";
    const note = el(
      "p",
      "",
      result.diverged
        ? "These views have different game states; interpret differences accordingly."
        : "Rendered HTML, stylesheet sources, computed values and matched rules.",
    );
    $("report").replaceChildren(title, note, link);
    $("report").hidden = false;
    $("workspaceToolsDialog").close();
    notify("Source comparison exported.");
  });
$("synchronize").onchange = () => {
  const mode = $("synchronize").value;
  return task(
    "Changing synchronization...",
    () => call("synchronize", { mode }),
    { sync: false },
  );
};
$("showCheats").onchange = () => {
  const show = $("showCheats").checked;
  return task("Updating Cheats visibility...", () => call("cheats", { show }), {
    sync: false,
  });
};
$("liveUpdates").onchange = () => {
  const enabled = $("liveUpdates").checked;
  return task("Switching current build...", () => call("live", { enabled }));
};
$("latest").onclick = () =>
  task("Refreshing the current build…", () => call("refresh"));
$("refresh").onclick = () =>
  task("Switching comparator revision…", () =>
    call("refresh", { ref: $("revision").value }),
  );
$("openImport").onclick = () => $("importDialog").showModal();
$("kind").onchange = () =>
  ($("decisionField").hidden = $("kind").value !== "replay");
$("importForm").onsubmit = (event) => {
  event.preventDefault();
  const file = $("file").files[0];
  if (!file) return;
  const kind = $("kind").value,
    decision = Number($("decision").value);
  $("importDialog").close();
  void task(
    "Importing situation…",
    async () => {
      const s = await call("import", {
        content: await file.text(),
        name: file.name,
        kind,
        decision,
        captured_at_ms: file.lastModified,
      });
      await reloadCatalog();
      $("situation").value = s.id;
      notify("Situation imported.");
    },
    { sync: false },
  );
};
for (const [id, timed] of [
  ["starter", false],
  ["timed", true],
])
  $(id).onclick = () =>
    task(
      "Creating a planning situation…",
      async () => {
        const s = await call(
          "starter",
          timed
            ? { timed: true, ready_all: true, name: "Timed planning situation" }
            : {},
        );
        await reloadCatalog();
        $("situation").value = s.id;
        notify("Planning situation created.");
      },
      { sync: false },
    );
$("stop").onclick = async () => {
  try {
    await call("shutdown");
    stopped = true;
    $("status").textContent =
      "Desk stopped. Run npm run compare to start again.";
    $("connection").textContent = "Stopped";
    $("connectionDot").classList.add("offline");
    document
      .querySelectorAll("button,input,select")
      .forEach((b) => (b.disabled = true));
  } catch (error) {
    showError(error);
  }
};
if (editorOnlyIndex !== null) {
  editorBootstrap = await new Promise((resolve) => {
    const ready = (event) => {
      if (
        event.origin !== location.origin ||
        event.source !== window.parent ||
        event.data?.type !== "lab-editor-context"
      )
        return;
      window.removeEventListener("message", ready);
      resolve(event.data.context);
    };
    window.addEventListener("message", ready);
    window.parent.postMessage({ type: "lab-editor-ready" }, location.origin);
  });
}
await refreshConnection();
void openEmbeddedEditor();
setInterval(async () => {
  await refreshConnection();
  void openEmbeddedEditor();
}, 1500);

document.addEventListener("visibilitychange", () => {
  if (initialized) render();
});

document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Escape" &&
      expandedIndex !== null &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      event.stopPropagation();
      expandedIndex = null;
      render();
    }
  },
  true,
);

openDevice = initDevicePanel({
  selectedSituation,
  inspection: inspectionInstruction,
  task,
  call,
  read,
  notify,
});

initElementReportPanel({ read, call, notify, onSaved: reloadCatalog });

reviewHistory = initReviewsPanel({
  read,
  call,
  task,
  navigate,
  getCatalog: () => catalog,
  canManage: () => !running && !state.busy && !disconnected,
  onChanged: () => reportsPanel?.refresh(true),
  canRun: () =>
    !running && !state.busy && !state.reviewRun?.active && !disconnected,
  showError,
});
void reviewHistory.refresh();
reportsPanel = initReportsPanel({
  read,
  call,
  onChanged: () => reviewHistory?.refresh(),
  canManage: () => !running && !state.busy && !disconnected,
});
if (editorOnlyIndex === null) void reportsPanel.refresh();
setInterval(() => {
  if (currentPage === "reports" && !document.hidden)
    void reportsPanel.refresh();
}, 5000);
