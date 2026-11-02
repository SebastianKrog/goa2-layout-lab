export function initReviewsPanel({
  read,
  call,
  task,
  navigate,
  getCatalog,
  canRun,
  canManage = () => true,
  onChanged = () => {},
  showError,
}) {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  let history = [],
    editing = null,
    kept = new Set(),
    added = new Set(),
    refreshing = false,
    lastSignature = "";
  const dialog = $("reviewEditDialog");
  const formatDate = (value) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString()
      : "Date unavailable";
  function button(label, action) {
    const b = node("button", label);
    b.type = "button";
    b.onclick = action;
    return b;
  }
  function stats(r) {
    const count = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
    return [
      count(r.total, "situation"),
      ...(r.visited === null ? [] : [`${r.visited} visited`]),
      count(r.reports, "report"),
    ].join(" · ");
  }
  let mutating = false;
  async function manage(action, groupId) {
    if (mutating || !canManage()) return;
    const group = history.filter((run) => run.reviewId === groupId),
      archived = history.filter((run) => run.archived);
    if (
      action === "delete" &&
      !confirm(
        `Delete “${group[0]?.name}”, its ${group.length} Runs and ${group.reduce((n, run) => n + run.reports, 0)} collected reports? This permanently removes their evidence.`,
      )
    )
      return;
    if (
      action === "delete-archive" &&
      !confirm(
        `Delete all ${new Set(archived.map((run) => run.reviewId)).size} archived Reviews, their ${archived.length} Runs and ${archived.reduce((n, run) => n + run.reports, 0)} collected reports? This permanently removes their evidence.`,
      )
    )
      return;
    mutating = true;
    updateState();
    try {
      await call("reviews/manage", {
        action,
        ...(groupId ? { id: groupId } : {}),
      });
      lastSignature = "";
      await refresh();
      await onChanged();
    } catch (error) {
      $("reviewHistoryWarnings").textContent = error.message;
    } finally {
      mutating = false;
      updateState();
    }
  }
  async function run(r, entries, name, inputs = "frozen") {
    const result = await task("Starting review run…", async () => {
      const value = await call("review-runs/rerun", {
        id: r.id,
        inputs,
        performedBy: "human",
        ...(entries ? { entries } : {}),
        ...(name ? { name } : {}),
      });
      dialog.close();
      editing = null;
      navigate("compare");
      return value;
    });
    if (result) await refresh();
  }
  function render() {
    $("reviewsList").replaceChildren();
    $("reviewHistoryCount").textContent = String(
      new Set(history.filter((r) =>
        !r.archived && (r.performedBy !== "agent" || $("reviewShowAgentic").checked),
      ).map((r) => r.reviewId)).size,
    );
    const groups = new Map();
    const scope = $("reviewHistoryStatus").value;
    const visible = history.filter(
      (run) =>
        (run.performedBy !== "agent" || $("reviewShowAgentic").checked) &&
        (scope === "all" || (scope === "archived" ? run.archived : !run.archived)),
    );
    for (const review of visible) {
      const groupId = review.reviewId;
      if (!groups.has(groupId)) {
        const group = node("section", undefined, "review-history-group");
        group.dataset.reviewDefinitionId = groupId;
        const runs = visible.filter((r) => r.reviewId === groupId);
        const heading = node("div", undefined, "review-group-heading");
        heading.append(
          node(
            "h2",
            `${review.name} · ${runs.length} ${runs.length === 1 ? "run" : "runs"}${review.archived ? " · Archived" : ""}`,
          ),
        );
        for (const [label, action] of [
          [
            review.archived ? "Restore" : "Archive",
            review.archived ? "restore" : "archive",
          ],
          ["Delete", "delete"],
        ]) {
          const control = button(label, () => void manage(action, groupId));
          control.dataset.reviewManage = groupId;
          if (action === "delete") control.classList.add("danger");
          heading.append(control);
        }
        group.append(heading);
        const list = node("div", undefined, "review-history-list");
        group.append(list);
        $("reviewsList").append(group);
        const previous = node("details", undefined, "review-older-runs");
        previous.append(node("summary", `Earlier runs (${runs.length - 1})`));
        const older = node("div", undefined, "review-history-list");
        previous.append(older);
        if (runs.length > 1) group.append(previous);
        groups.set(groupId, { list, older, count: 0 });
      }
      const card = node("article", undefined, "review-history-card");
      card.dataset.reviewId = review.id;
      card.dataset.performedBy = review.performedBy || "human";
      card.append(
        node("h3", `${review.performedBy === "agent" ? "Agentic review" : "Run"} · ${formatDate(review.createdAt)}`),
        node(
          "p",
          `Revision ${review.reviewRevision || 1} · ${review.status === "active" ? "In progress" : review.status === "interrupted" ? "Interrupted" : "Ended"} · ${stats(review)}`,
          "muted",
        ),
      );
      const kinds = Object.entries(review.reportKinds)
        .map(([kind, count]) => `${kind}: ${count}`)
        .join(" · ");
      const options = node("details", undefined, "review-run-options");
      options.append(node("summary", "Run details and options"));
      options.append(
        node(
          "p",
          `Position ${review.position}/${review.total} · ${review.reportedSituations} situations reported · ${review.views} views`,
          "muted",
        ),
      );
      if (kinds) options.append(node("p", kinds, "muted"));
      if (review.parentRunId)
        options.append(
          node("p", "Rerun of " + review.parentRunId.slice(0, 8), "muted"),
        );
      const actions = node("div", undefined, "review-history-actions");
      const reports = node("a", "Open reports");
      reports.href = review.url;
      reports.target = "_blank";
      reports.rel = "noreferrer";
      actions.append(reports);
      const inputs = node("select");
      inputs.setAttribute("aria-label", "Rerun inputs");
      for (const [value, text] of [
        ["frozen", "Original saved snapshots"],
        ["library", "Current library Situations"],
      ]) {
        const option = node("option", text);
        option.value = value;
        inputs.append(option);
      }
      const inputLabel = node("label", "Rerun inputs");
      inputLabel.append(inputs);
      options.append(inputLabel);
      const rerun = button(
        "Run again",
        () => void run(review, undefined, undefined, inputs.value),
      );
      inputs.onchange = () => {
        options.querySelector("summary").textContent =
          inputs.value === "library"
            ? "Run options · current library"
            : "Run details and options";
        rerun.title =
          inputs.value === "library"
            ? "Run current library Situations"
            : "Run original saved snapshots";
      };
      inputs.onchange();
      rerun.dataset.reviewRun = "";
      const edit = button("Edit and run", () => void editReview(review.id));
      edit.dataset.reviewRun = "";
      actions.append(rerun, edit);
      if (review.status === "active")
        actions.append(button("Continue review", () => navigate("compare")));
      card.append(actions, options);
      const target = groups.get(groupId);
      (target.count++ === 0 ? target.list : target.older).append(card);
    }
    $("reviewsEmpty").hidden = visible.length > 0;
    $("reviewsEmpty").textContent = history.length
      ? "No Reviews match these filters."
      : "No saved Reviews yet. Select Situations and start a Review to create one.";
    updateState();
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const value = await read("/api/reviews");
      history = value.reviews.flatMap((review) =>
        review.runs.map((run) => ({ ...run, archived: !!review.archived })),
      );
      $("reviewHistoryWarnings").textContent = (value.warnings || []).join(" ");
      const signature = JSON.stringify(value);
      if (signature !== lastSignature) {
        lastSignature = signature;
        render();
      } else updateState();
    } catch (error) {
      $("reviewHistoryWarnings").textContent = error.message;
    } finally {
      refreshing = false;
    }
  }
  function updateState() {
    const allowed = canRun();
    document
      .querySelectorAll("[data-review-manage]")
      .forEach(
        (control) =>
          (control.disabled =
            mutating ||
            !canManage() ||
            history.some(
              (run) =>
                run.reviewId === control.dataset.reviewManage &&
                run.status === "active",
            )),
      );
    $("reviewArchiveAll").disabled =
      mutating ||
      !canManage() ||
      !history.some(
        (run) =>
          !run.archived &&
          !history.some(
            (other) =>
              other.reviewId === run.reviewId && other.status === "active",
          ),
      );
    $("reviewDeleteArchive").disabled =
      mutating || !canManage() || !history.some((run) => run.archived);
    document
      .querySelectorAll("[data-review-run]")
      .forEach((b) => (b.disabled = !allowed));
    $("reviewHistoryActiveNote").hidden = allowed;
    $("reviewEditSubmit").disabled =
      !allowed || !editing || kept.size + added.size === 0;
    if (editing)
      $("reviewEditCount").textContent =
        `${kept.size} kept + ${added.size} added = ${kept.size + added.size} situations`;
  }
  function updateKeepAll() {
    const all = $("reviewEditKeepAll");
    all.checked = !!editing && kept.size === editing.entries.length;
    all.indeterminate = kept.size > 0 && kept.size < editing.entries.length;
    updateState();
  }
  function entryCheckbox(entry, checked, onchange) {
    const label = node("label", undefined, "review-queue-entry");
    const input = node("input");
    input.type = "checkbox";
    input.checked = checked;
    input.onchange = () => onchange(input.checked);
    label.append(input, node("span", entry.name));
    return label;
  }
  const entryInstructions = new Map();
  const specificCards = new Map();
  const savedInstructions = new Map();
  function presentationSelector(key, entry = {}) {
    const select = node("select");
    select.setAttribute(
      "aria-label",
      "Presentation for " + (entry.name || "new Situation"),
    );
    const presets = getCatalog().presentations || [];
    for (const [value, text] of [
      ["__keep", "Keep inspection instructions"],
      ["", "Default presentation"],
      ...presets.map((p) => [p.id, p.name]),
    ]) {
      const option = node("option", text);
      option.value = value;
      select.append(option);
    }
    select.value = entryInstructions.get(key) ?? "__keep";
    select.onchange = () => entryInstructions.set(key, select.value);
    savedInstructions.set(key, entry.presentation || {});
    const details = node("details");
    details.append(node("summary", "Specific card (this inspection only)"));
    const card = node("input");
    card.placeholder = "Card ID";
    card.setAttribute(
      "aria-label",
      "Specific card for " + (entry.name || "Situation"),
    );
    card.oninput = () => specificCards.set(key, card.value.trim());
    details.append(card);
    const wrapper = node("div");
    wrapper.append(select, details);
    return wrapper;
  }
  function chosenInstructions(key) {
    const selected = entryInstructions.get(key);
    if (specificCards.get(key)) {
      const preset = (getCatalog().presentations || []).find(
        (p) => p.id === selected,
      );
      const base =
        selected === undefined || selected === "__keep"
          ? savedInstructions.get(key)
          : preset?.state;
      return {
        presentation: {
          schema: 2,
          sessionState: {
            ...base?.sessionState,
            inspectedCard: specificCards.get(key),
          },
        },
      };
    }
    if (selected === undefined || selected === "__keep") return {};
    const preset = (getCatalog().presentations || []).find(
      (p) => p.id === selected,
    );
    return {
      presentation: preset?.state || {
        schema: 2,
        sessionState: {},
        userState: {},
      },
      presentationsByInterface: {},
      viewPresentations: {},
    };
  }
  function renderKept() {
    $("reviewEditKept").replaceChildren(
      ...editing.entries.map((entry) => {
        const label = entryCheckbox(entry, kept.has(entry.index), (checked) => {
          if (checked) kept.add(entry.index);
          else kept.delete(entry.index);
          updateKeepAll();
        });
        label.querySelector("input").dataset.reviewEntry = entry.index;
        label
          .querySelector("input")
          .setAttribute("aria-label", "Keep " + entry.name);
        const row = node("div", undefined, "review-entry-setup");
        row.append(label, presentationSelector("saved:" + entry.index, entry));
        return row;
      }),
    );
    updateKeepAll();
  }
  function candidates() {
    const original = new Set(editing.entries.map((e) => e.situationId));
    const query = $("reviewEditSearch").value.trim().toLowerCase();
    return (getCatalog().situations || []).filter(
      (s) =>
        !original.has(s.id) &&
        (!query || `${s.name} ${s.group || ""}`.toLowerCase().includes(query)),
    );
  }
  function renderAdded() {
    if (!editing) return;
    const options = candidates();
    $("reviewEditAvailable").replaceChildren(
      ...options.map((s) => {
        const label = entryCheckbox(s, added.has(s.id), (checked) => {
          if (checked) added.add(s.id);
          else added.delete(s.id);
          updateState();
        });
        label.querySelector("input").dataset.addSituation = s.id;
        label
          .querySelector("input")
          .setAttribute("aria-label", "Add " + s.name);
        const row = node("div", undefined, "review-entry-setup");
        row.append(label, presentationSelector("new:" + s.id, s));
        return row;
      }),
    );
    $("reviewEditNoMatches").hidden = options.length > 0;
  }
  async function editReview(id) {
    try {
      editing = await read("/api/review-runs/" + encodeURIComponent(id));
      entryInstructions.clear();
      specificCards.clear();
      savedInstructions.clear();
      kept = new Set(editing.entries.map((e) => e.index));
      added = new Set();
      $("reviewEditName").value = (editing.name + " (edited)").slice(0, 100);
      $("reviewEditSearch").value = "";
      $("reviewEditInputs").value = "frozen";
      renderKept();
      renderAdded();
      dialog.showModal();
    } catch (error) {
      showError(error);
    }
  }
  $("reviewEditKeepAll").onchange = () => {
    kept = $("reviewEditKeepAll").checked
      ? new Set(editing.entries.map((e) => e.index))
      : new Set();
    renderKept();
  };
  $("reviewEditSearch").oninput = renderAdded;
  $("reviewHistoryStatus").onchange = render;
  $("reviewShowAgentic").onchange = render;
  $("reviewArchiveAll").onclick = () => void manage("archive-all");
  $("reviewDeleteArchive").onclick = () => void manage("delete-archive");
  $("reviewHistoryRefresh").onclick = () => void refresh();
  $("reviewEditForm").onsubmit = (event) => {
    event.preventDefault();
    if (!editing || !canRun() || kept.size + added.size === 0) return;
    const entries = [
      ...editing.entries
        .filter((e) => kept.has(e.index))
        .map((e) => ({
          fromIndex: e.index,
          ...chosenInstructions("saved:" + e.index),
        })),
      ...(getCatalog().situations || [])
        .filter((s) => added.has(s.id))
        .map((s) => ({
          situationId: s.id,
          ...chosenInstructions("new:" + s.id),
        })),
    ];
    void run(
      editing,
      entries,
      $("reviewEditName").value,
      $("reviewEditInputs").value,
    );
  };
  dialog.addEventListener("close", () => {
    editing = null;
  });
  return { refresh, updateState };
}
