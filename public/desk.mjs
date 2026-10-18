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
  lastWindowKey = "",
  toastTimer;
const excluded = new Set(),
  liveViews = new Map();
const human = (value) =>
  value === "spectator"
    ? "Spectator"
    : String(value || "")
        .replace(/^hero_/, "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
const configKey = (c) =>
  JSON.stringify([c.source, c.profile, c.render, c.layout, c.seat]);
const viewKey = (w) =>
  w ? w.gameId + configKey(w.config) + !!w.closed + (w.nativeId || "") : "";
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
  for (const page of ["compare", "situations", "settings"])
    $(page + "Page").hidden = page !== name;
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === name);
    b.setAttribute("aria-current", b.dataset.page === name ? "page" : "false");
  });
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
      "button:not(.nav-item):not([data-close]):not(#stop), select, input",
    )
    .forEach((b) => (b.disabled = !!busy));
  for (const live of liveViews.values()) live.pause(!!busy);
  const count = state.windows?.length || 0;
  for (const id of ["capture", "save", "reset", "clear"])
    $(id).disabled = !!busy || count < (id === "capture" ? 2 : 1);
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
  $("restore").disabled =
    !!busy || !Object.keys(selectedSituation()?.presentations || {}).length;
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
  $("restore").checked = false;
  draftSetup = true;
  render();
  updateStatus();
}
function button(text, fn, cls = "") {
  const b = el("button", cls, text);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function render() {
  while (configs.length < Number($("count").value))
    configs.push(
      structuredClone(
        configs.at(-1) || catalog.presets["Layout regression"][0],
      ),
    );
  configs.length = Number($("count").value);
  const preset = Object.entries(catalog.presets).find(
    ([, slots]) =>
      slots.length === configs.length &&
      slots.every((s, i) => configKey(s) === configKey(configs[i])),
  );
  $("preset").value = preset ? preset[0] : "__custom";
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
            s.render.toUpperCase(),
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
          w?.closed ? "View closed" : "Load comparison to open this view",
        );
        card.append(empty);
      }
      const actions = el("div", "slot-footer");
      actions.append(button("Edit view", () => openEditor(i)));
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
  if (values) fill(input, values, editDraft[key]);
  else {
    input.value = editDraft[key] || "";
    input.maxLength = 80;
    input.placeholder = "Optional, e.g. Arien / close camera";
  }
  input.onchange = () => {
    editDraft[key] = input.value;
    if (["source", "render", "layout"].includes(key)) {
      normalizeDraft();
      editorFields();
    }
  };
  input.oninput = () => {
    if (!values) editDraft[key] = input.value;
  };
  label.append(input);
  host.append(label);
}
function normalizeDraft() {
  if (editDraft.source === "base") editDraft.layout = "desktop";
  if (editDraft.source === "target") {
    editDraft.render = "2d";
    editDraft.layout = "desktop";
  }
  if (editDraft.render === "3d") editDraft.layout = "desktop";
}
function editorFields() {
  const host = $("editorFields");
  host.replaceChildren();
  field(host, "View name", "label");
  field(host, "Source", "source", Object.entries(sourceNames));
  field(host, "Device", "profile", Object.entries(devices));
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
    "Layout",
    "layout",
    ["base", "target"].includes(editDraft.source) || editDraft.render === "3d"
      ? [["desktop", "Desktop shell"]]
      : [
          ["desktop", "Desktop shell"],
          ["mobile", "Native mobile shell"],
        ],
  );
  field(host, "Viewpoint", "seat", [
    ...(
      active(editing)?.seats || [
        "hero_arien",
        "hero_hanu",
        "hero_brogan",
        "hero_tigerclaw",
      ]
    ).map((id) => [id, human(id)]),
    ["spectator", "Spectator"],
  ]);
}
function openEditor(i) {
  editing = i;
  editDraft = { ...configs[i] };
  $("editorEyebrow").textContent = `VIEW ${String.fromCharCode(65 + i)}`;
  $("editorTitle").textContent =
    configs[i].label || sourceNames[configs[i].source];
  editorFields();
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
    call("configure", { update: { seat: editDraft.seat } }),
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
$("editorForm").onsubmit = (event) => {
  event.preventDefault();
  const i = editing,
    update = { ...editDraft };
  $("editor").close();
  if (active(i) && !draftSetup)
    void task("Updating view…", () => call("configure", { index: i, update }));
  else {
    configs[i] = update;
    draftSetup = true;
    render();
    notify("Setup changed. Load to apply.");
  }
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
    const exportLink = el("a", "", "Export");
    exportLink.href = "/export/" + s.id;
    card.append(
      text,
      exportLink,
      button("Move", () => organizeSituation(s)),
    );
    if (s.origin !== "library")
      card.append(button("Add to library", () => organizeSituation(s, true)));
    card.append(
      button("Open situation", () => {
        $("situation").value = s.id;
        $("restore").checked = !!Object.keys(s.presentations || {}).length;
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
}
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
            ? `${count} views / clocks frozen`
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
        $("preset").value = catalog.settings?.preset || "Mobile migration";
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
      restoreViews: $("restore").checked,
    });
    syncViews();
    notify("Comparison loaded.");
  });
}
$("preset").onchange = setPreset;
$("count").onchange = () => {
  draftSetup = true;
  $("restore").checked = false;
  render();
  updateStatus();
};
$("situation").onchange = () => {
  draftSetup = $("situation").value !== state.situationId;
  updateStatus();
  $("restore").checked = !!Object.keys(selectedSituation()?.presentations || {})
    .length;
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
    const s = await call("save", { name, index });
    await reloadCatalog();
    $("situation").value = s.id;
    $("restore").checked = true;
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
      await call("preset", { name, slots: configs });
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
    if (indexes.length < 2)
      throw new Error("Select Capture on at least two views.");
    const result = await call("capture", { indexes });
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
