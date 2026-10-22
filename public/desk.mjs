import { initReviewsPanel } from "./reviews-panel.mjs";
import { initElementReportPanel } from "./element-report-panel.mjs";
import { initDevicePanel } from "./device-panel.mjs";
import { LiveView } from "./live.mjs";
import { NativeView } from "./native.mjs";
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const sourceNames = {
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
let openDevice, reviewHistory;
let catalog = {},
  state = {},
  configs = [],
  running = false,
  operation = "",
  initialized = false,
  checking = false,
  disconnected = false,
  stopped = false,
  draftSetup = false;
let currentPage = "compare",
  expandedIndex = null;
let editing = null,
  editDraft,
  creating = false,
  draftIndex = null,
  inheritIndex = 0,
  focusedIndex = 0,
  editorCommitted = false,
  lastWindowKey = "",
  toastTimer;
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
  for (const page of ["compare", "situations", "reviews", "settings"])
    $(page + "Page").hidden = page !== name;
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === name);
    b.setAttribute("aria-current", b.dataset.page === name ? "page" : "false");
  });
  if (name === "reviews") void reviewHistory?.refresh();
  window.scrollTo(0, 0);
}
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
  for (const id of ["capture", "extract", "save", "reset", "clear"])
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
  const independent =
    count < 2 ||
    (state.windows || []).some((w) => Object.keys(w.config.bots || {}).length);
  $("synchronize").disabled = !!busy || independent;
  $("synchronize").title = independent
    ? "Synchronization requires at least two manual views."
    : "";
  $("editor")
    .querySelectorAll("[data-close]")
    .forEach((b) => {
      b.disabled = !!busy;
    });
  $("addView").disabled = !!busy || configs.length >= 3;
  $("addView").title = configs.length >= 3 ? "Up to three views" : "Add a view";
  updateReviewControls();
  reviewHistory?.updateState();
}
async function task(label, fn, { sync = true } = {}) {
  if (running || state.busy) return;
  running = true;
  operation = label;
  $("error").hidden = true;
  updateStatus();
  controls();
  try {
    const result = await fn();
    await reloadCatalog();
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
  const branch = catalog.settings?.comparatorRef || "mobile-migration";
  fill($("revision"), [
    [branch, "Newest configured build"],
    ...catalog.commits
      .filter((c) => c.sha !== branch)
      .map((c) => [c.sha, c.sha.slice(0, 8) + " · " + c.subject]),
  ]);
  $("savedCount").textContent = catalog.situations.length;
  renderLibrary();
  renderSettings();
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
function render() {
  while (configs.length < Number($("count").value))
    configs.push(structuredClone(configs.at(-1) || catalog.presets.Current[0]));
  configs.length = Number($("count").value);
  const preset = Object.entries(catalog.presets).find(
    ([, slots]) =>
      slots.length === configs.length &&
      slots.every((s, i) => configKey(s) === configKey(configs[i])),
  );
  $("preset").value = preset ? preset[0] : "__custom";
  $("slots").classList.toggle("one", configs.length === 1);
  $("slots").classList.toggle("two", configs.length === 2);
  $("viewCount").textContent = $("navCount").textContent = configs.length;
  const keep = new Set();
  $("slots").replaceChildren(
    ...configs.map((s, i) => {
      const w = active(i),
        opened = matching(i) && !w.closed,
        letter = String.fromCharCode(65 + i),
        card = el("article", "slot");
      card.dataset.index = i;
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
      header.append(heading);
      card.append(header);
      let live;
      if (opened && currentPage === "compare" && !document.hidden) {
        const key = viewKey(w);
        keep.add(key);
        live = liveViews.get(key);
        if (!live) {
          const View =
            window.layoutLabDesktop && w.nativeId ? NativeView : LiveView;
          live = new View(i, w, catalog.profiles[s.profile].viewport);
          liveViews.set(key, live);
        }
        card.append(live.host);
      } else {
        const empty = el(
          "div",
          "live-stage empty-view",
          w?.closed ? "View closed" : "Choose a situation and start this view",
        );
        empty.append(button("Start", () => openEditor(i)));
        card.append(empty);
      }
      const actions = el("div", "slot-footer");
      actions.append(button("Edit view", () => openEditor(i)));
      if (w)
        actions.append(
          button("Remove", () =>
            task("Removing view...", async () => {
              await call("views/remove", { index: i });
              configs.splice(i, 1);
              if (!configs.length)
                configs = structuredClone(catalog.presets.Current);
              $("count").value = configs.length;
              expandedIndex = null;
              excluded.clear();
            }),
          ),
        );
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
      actions.append(expand);
      const scale = el("select");
      scale.setAttribute("aria-label", "Scale view " + letter);
      scale.append(option("fit", "Fit"), option("actual", "100%"));
      scale.value = live?.fit === false ? "actual" : "fit";
      scale.onchange = () => live?.zoom(scale.value === "fit");
      actions.append(scale);
      const capture = el("label", "check"),
        check = el("input");
      check.type = "checkbox";
      check.checked = !excluded.has(i);
      check.setAttribute("aria-label", "Include in capture");
      check.onchange = () =>
        check.checked ? excluded.delete(i) : excluded.add(i);
      capture.append(check, document.createTextNode("Capture"));
      actions.append(capture);
      card.append(actions);
      const issues = [
        ...(w?.warnings || []),
        ...(w?.errors || []),
        ...(w?.assets || []),
      ];
      if (issues.length)
        card.append(el("div", "view-warning", issues.join("\n")));
      return card;
    }),
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
  controls();
}
function refreshPreviews() {
  for (const live of liveViews.values()) live.resize();
}
function field(host, labelText, key, values) {
  const label = el("label", "", labelText),
    input = values ? el("select") : el("input");
  input.setAttribute("aria-label", labelText);
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
    input.value = editDraft[key] || "";
    input.maxLength = 80;
    input.placeholder = "Optional, e.g. Arien / close camera";
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
    } else editDraft[key] = input.value;
    if (key === "seat") editorBots();
    if (["source", "render", "uiMode", "interfacePreset"].includes(key)) {
      normalizeDraft();
      editorFields();
      fill(
        $("viewPresentation"),
        [
          ["", "Keep current / inherit presentation"],
          ...(catalog.presentations || [])
            .filter((p) => p.render === editDraft.render)
            .map((p) => [p.id, p.name]),
        ],
        "",
      );
    }
  };
  input.oninput = () => {
    if (!values) editDraft[key] = input.value;
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
  field(host, "View name", "label");
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
    host,
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
    host,
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
    ["__follow", "Follow situation"],
    ...editorSeats.map((id) => [id, human(id)]),
    ["spectator", "Spectator"],
  ]);
}
let editorSeats = [],
  editorBotKinds = [];
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
  if (!(await updateEditorRoster())) return;
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
      ...(catalog.presentations || [])
        .filter((p) => p.render === editDraft.render)
        .map((p) => [p.id, p.name]),
    ],
    "",
  );
  editorFields();
  $("editorSubmit").textContent = creating ? "Start" : "Save";
  $("viewAutoSwitch").checked = !!editDraft.autoSwitch;
  editorBots();
  const tools = $("editorTools");
  tools.replaceChildren();
  const action = (text, label, fn) => {
    const b = button(text, () => task(label, fn));
    b.dataset.needsWindow = i;
    tools.append(b);
  };
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
  controls();
}
async function updateEditorRoster() {
  try {
    const selected = $("viewSituation").value;
    const parent = active(creating ? inheritIndex : editing);
    const situationId =
      selected === "__current"
        ? parent?.situationId || state.situationId
        : selected;
    const options = await read(
      `/api/device/options?situationId=${encodeURIComponent(situationId || "")}`,
    );
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
    showError(error);
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
  if (!editorCommitted) cancelViewDraft();
});
$("editorForm").onsubmit = (event) => {
  event.preventDefault();
  const i = editing;
  const update = { ...editDraft, autoSwitch: $("viewAutoSwitch").checked };
  const selected = $("viewSituation").value;
  void task(creating ? "Starting view..." : "Saving view...", async () => {
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
      ? "Moves the shared JSON file within situations/."
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
function renderLibrary() {
  const folder = $("libraryGroup").value,
    origin = $("libraryOrigin").value;
  const filtered = catalog.situations.filter(
    (s) =>
      (!origin || s.origin === origin) &&
      (!folder ||
        (folder === "__root"
          ? !s.group
          : s.group === folder || s.group?.startsWith(folder + "/"))),
  );
  filteredSituations = filtered;
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
      text = el("div");
    text.append(
      el("h3", "", s.name),
      el(
        "p",
        "",
        human(s.summary.phase) +
          " - Round " +
          s.summary.round +
          (s.summary.decision ? " - " + human(s.summary.decision) : ""),
      ),
    );
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
      card.append(reportLink);
    }
    card.append(
      text,
      exportLink,
      button("Move", () => organizeSituation(s)),
      button("Open on device", () => void openDevice(s.id)),
    );
    if (s.origin !== "library")
      card.append(button("Add to library", () => organizeSituation(s, true)));
    card.append(
      button("Open situation", () => {
        $("situation").value = s.id;
        navigate("compare");
        void loadComparison();
      }),
    );
    groups.get(key).append(card);
  }
  if (!filtered.length)
    $("library").append(
      el("p", "library-note", "No situations in this folder."),
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
  $("reviewBar").hidden = !review;
  if (review) {
    $("reviewTitle").textContent = review.name;
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
$("reviewStart").onclick = () =>
  void task("Starting review…", async () => {
    const ids = catalog.situations
      .filter((s) => reviewSelection.has(s.id))
      .map((s) => s.id);
    const result = await call("review-runs/start", {
      ids,
      name: $("reviewName").value,
      slots: configs,
    });
    navigate("compare");
    return result;
  });
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
    ["Backend checkout", catalog.settings?.backend],
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
            : "Select a situation and load it.");
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
  if (!state.busy && !running) lastWindowKey = key;
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
        $("preset").value = "Current";
        setPreset();
        draftSetup = false;
      }
      if (state.situationId) $("situation").value = state.situationId;
      render();
      initialized = true;
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
async function loadComparison() {
  return task("Loading comparison…", async () => {
    state = await call("load", {
      situationId: $("situation").value,
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
    notify("Comparison loaded.");
  });
}
$("preset").onchange = setPreset;
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
$("load").onclick = loadComparison;
$("reset").onclick = () => task("Resetting views…", () => call("reset"));
$("clear").onclick = () =>
  task(
    "Closing comparison…",
    async () => {
      await call("clear");
      state.windows = [];
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
  fill($("composePresentation"), [
    ["", "Default Board / Follow view"],
    ...(catalog.presentations || []).map((p) => [p.id, p.name]),
  ]);
  $("composeSituationName").value = "";
  $("composeSituationDialog").showModal();
};
$("composeSituationForm").onsubmit = (event) => {
  event.preventDefault();
  void task("Creating Situation…", async () => {
    const template = (catalog.presentations || []).find(
      (p) => p.id === $("composePresentation").value,
    );
    const s = await call("situation/compose", {
      name: $("composeSituationName").value,
      decisionStateId: $("composeDecisionState").value,
      ...(template ? { presentation: template.state } : {}),
    });
    $("composeSituationDialog").close();
    await reloadCatalog();
    $("situation").value = s.id;
    notify("Situation created.");
  });
};
$("save").onclick = () => {
  $("name").value = "";
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
      await call("presentation/save", { name, index });
      notify("Presentation saved separately.");
      return;
    }
    if ($("saveKind").value === "setup") {
      await call("layout/save", { name, slots: configs });
      notify("Layout saved in comparison tools.");
      return;
    }
    const s = await call("save", { name, index, kind: $("saveKind").value });
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
$("savePreset").onclick = () => {
  const name = $("name").value.trim();
  if (!name) {
    $("name").reportValidity();
    return;
  }
  $("saveDialog").close();
  void task(
    "Saving view setup…",
    async () => {
      await call("layout/save", { name, slots: configs });
      notify("View setup saved in the Comparison menu.");
    },
    { sync: false },
  );
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
await refreshConnection();
setInterval(() => void refreshConnection(), 1500);

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

openDevice = initDevicePanel({ selectedSituation, task, call, read, notify });

initElementReportPanel({ read, call, notify, onSaved: reloadCatalog });

reviewHistory = initReviewsPanel({
  read,
  call,
  task,
  navigate,
  getCatalog: () => catalog,
  canRun: () =>
    !running && !state.busy && !state.reviewRun?.active && !disconnected,
  showError,
});
void reviewHistory.refresh();
