export function initReviewsPanel({
  read,
  call,
  task,
  navigate,
  getCatalog,
  canRun,
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
      `Position ${r.position}/${r.total}`,
      count(r.reports, "report"),
      count(r.reportedSituations, "situation reported", "situations reported"),
      count(r.views, "view"),
    ].join(" · ");
  }
  async function run(r, entries, name) {
    const result = await task("Starting review run…", async () => {
      const value = await call("review/rerun", {
        id: r.id,
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
    $("reviewHistoryCount").textContent = String(history.length);
    for (const review of history) {
      const card = node("article", undefined, "review-history-card");
      card.dataset.reviewId = review.id;
      card.append(
        node("h2", review.name),
        node(
          "p",
          `${formatDate(review.createdAt)} · ${review.status === "active" ? "In progress" : review.status === "interrupted" ? "Interrupted" : "Ended"}`,
          "muted",
        ),
        node("p", stats(review), "review-history-stats"),
      );
      const kinds = Object.entries(review.reportKinds)
        .map(([kind, count]) => `${kind}: ${count}`)
        .join(" · ");
      if (kinds) card.append(node("p", kinds, "muted"));
      if (review.parentReviewId)
        card.append(
          node("p", "Rerun of " + review.parentReviewId.slice(0, 8), "muted"),
        );
      const actions = node("div", undefined, "review-history-actions");
      const reports = node("a", "Open reports");
      reports.href = review.url;
      reports.target = "_blank";
      reports.rel = "noreferrer";
      actions.append(reports);
      const rerun = button("Run again", () => void run(review));
      rerun.dataset.reviewRun = "";
      const edit = button("Edit and run", () => void editReview(review.id));
      edit.dataset.reviewRun = "";
      actions.append(rerun, edit);
      if (review.status === "active")
        actions.append(button("Continue review", () => navigate("compare")));
      card.append(actions);
      $("reviewsList").append(card);
    }
    $("reviewsEmpty").hidden = history.length > 0;
    updateState();
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const value = await read("/api/reviews");
      history = value.reviews;
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
        return label;
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
        return label;
      }),
    );
    $("reviewEditNoMatches").hidden = options.length > 0;
  }
  async function editReview(id) {
    try {
      editing = await read("/api/reviews/" + encodeURIComponent(id));
      kept = new Set(editing.entries.map((e) => e.index));
      added = new Set();
      $("reviewEditName").value = (editing.name + " (edited)").slice(0, 100);
      $("reviewEditSearch").value = "";
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
  $("reviewHistoryRefresh").onclick = () => void refresh();
  $("reviewEditForm").onsubmit = (event) => {
    event.preventDefault();
    if (!editing || !canRun() || kept.size + added.size === 0) return;
    const entries = [
      ...editing.entries
        .filter((e) => kept.has(e.index))
        .map((e) => ({ fromIndex: e.index })),
      ...(getCatalog().situations || [])
        .filter((s) => added.has(s.id))
        .map((s) => ({ situationId: s.id })),
    ];
    void run(editing, entries, $("reviewEditName").value);
  };
  dialog.addEventListener("close", () => {
    editing = null;
  });
  return { refresh, updateState };
}
