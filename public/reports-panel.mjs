const names = {
  device: "Device report",
  element: "Element report",
  capture: "Capture",
  "html-css": "HTML & CSS",
};
export function initReportsPanel({
  read,
  call,
  onChanged = () => {},
  canManage = () => true,
}) {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text, cls) => {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (cls) value.className = cls;
    return value;
  };
  const link = (text, url) => {
    const value = node("a", text);
    value.href = url;
    value.target = "_blank";
    value.rel = "noreferrer";
    return value;
  };
  const date = (value) =>
    Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString()
      : "Date unavailable";
  let reports = [],
    refreshing = false,
    mutating = false,
    lastRefresh = 0;
  function actionButton(text, action, id) {
    const value = node("button", text);
    value.type = "button";
    value.dataset.reportAction = "";
    value.onclick = () => void manage(action, id);
    if (action === "delete") value.className = "danger";
    return value;
  }
  async function manage(action, id) {
    if (mutating || !canManage()) return;
    const report = reports.find((report) => report.id === id);
    if (
      action === "delete" &&
      !confirm(
        `Delete “${report?.title}”? This permanently removes this report and its evidence.`,
      )
    )
      return;
    if (
      action === "delete-archive" &&
      !confirm(
        `Delete all ${reports.filter((report) => report.archived).length} archived reports? This permanently removes their evidence, including reports inside Reviews.`,
      )
    )
      return;
    mutating = true;
    updateState();
    try {
      await call("reports/manage", { action, ...(id ? { id } : {}) });
      await refresh(true);
      await onChanged();
    } catch (error) {
      $("reportsWarning").textContent = error.message;
    } finally {
      mutating = false;
      updateState();
    }
  }
  function render() {
    const query = $("reportSearch").value.trim().toLowerCase(),
      kind = $("reportKind").value,
      context = $("reportReview").value,
      scope = $("reportStatus").value;
    const selected = reports.filter(
      (report) =>
        (scope === "all" ||
          (scope === "archived" ? report.archived : !report.archived)) &&
        (!kind || report.kind === kind) &&
        (!context ||
          `${report.context.kind}:${report.context.id}` === context) &&
        (!query ||
          [
            report.title,
            report.comment,
            report.situationName,
            report.situationId,
            report.context.name,
            ...report.views.map(
              (view) => `${view.label || ""} ${view.revision || ""}`,
            ),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
    $("reportResults").textContent = `${selected.length} of ${reports.length}`;
    $("reportsList").replaceChildren();
    $("reportsEmpty").hidden = selected.length > 0;
    $("reportsEmpty").textContent = reports.length
      ? "No matching reports. Try another search or archive filter."
      : "No reports yet. Use device reporting, Report an element, or Capture to collect evidence.";
    const groups = new Map();
    for (const report of selected) {
      const key = `${report.context.kind}:${report.context.id}`;
      if (!groups.has(key)) {
        const group = node("section", undefined, "report-group"),
          heading = node(
            "h2",
            `${report.context.name} · ${report.context.kind === "review" ? "Review Run · " : ""}${report.context.kind === "date" ? new Date(report.context.startedAt).toLocaleDateString() : date(report.context.startedAt)}`,
          ),
          list = node("div", undefined, "report-group-list");
        group.append(heading, list);
        $("reportsList").append(group);
        groups.set(key, list);
      }
      const card = node("article", undefined, "report-card");
      card.dataset.reportId = report.id;
      const heading = node("div", undefined, "report-heading");
      heading.append(node("h3", report.title), link("Open report", report.url));
      const menu = node("details", undefined, "action-menu"),
        summary = node("summary", "More");
      summary.setAttribute("aria-label", "Actions for report " + report.title);
      const actions = node("div", undefined, "menu-items");
      actions.append(
        actionButton(
          report.archived ? "Restore" : "Archive",
          report.archived ? "restore" : "archive",
          report.id,
        ),
        actionButton("Delete", "delete", report.id),
      );
      menu.append(summary, actions);
      heading.append(menu);
      card.append(heading);
      const meta = node("p", undefined, "report-meta"),
        timestamp = node("time", date(report.createdAt));
      timestamp.dateTime = report.createdAt;
      meta.append(
        node("span", names[report.kind] || report.kind),
        document.createTextNode(" · "),
        timestamp,
      );
      if (report.views.length)
        meta.append(
          document.createTextNode(
            ` · ${report.views.length} View${report.views.length === 1 ? "" : "s"}`,
          ),
        );
      if (report.archived) meta.append(document.createTextNode(" · Archived"));
      card.append(meta);
      if (report.situationName || report.situationId)
        card.append(
          node(
            "p",
            report.situationName || String(report.situationId),
            "report-situation",
          ),
        );
      if (report.review) card.append(link("Review reports", report.review.url));
      if (report.comment && report.comment !== report.title) {
        const details = node("details", undefined, "report-comment");
        details.append(
          node("summary", "Full comment"),
          node("p", report.comment),
        );
        card.append(details);
      }
      if (report.views.length) {
        const details = node("details", undefined, "report-views");
        details.append(node("summary", "Captured Views"));
        for (const view of report.views)
          details.append(
            node(
              "p",
              `${Number.isInteger(view.index) ? "View " + String.fromCharCode(65 + view.index) : "View"} · ${view.label || "Source unavailable"}${view.revision ? " · " + view.revision : ""}`,
            ),
          );
        card.append(details);
      }
      groups.get(key).append(card);
    }
    updateState();
  }
  function updateState() {
    const blocked = mutating || !canManage();
    document
      .querySelectorAll("[data-report-action]")
      .forEach((button) => (button.disabled = blocked));
    $("reportsArchiveAll").disabled =
      blocked || !reports.some((report) => !report.archived);
    $("reportsDeleteArchive").disabled =
      blocked || !reports.some((report) => report.archived);
  }
  async function refresh(force = false) {
    if (refreshing || (!force && Date.now() - lastRefresh < 5000)) return;
    refreshing = true;
    $("reportsRefresh").disabled = true;
    try {
      const result = await read("/api/reports");
      reports = Array.isArray(result.reports) ? result.reports : [];
      $("reportsCount").textContent = String(
        reports.filter((report) => !report.archived).length,
      );
      $("reportsWarning").textContent = (result.warnings || []).join(" ");
      const selected = $("reportReview").value;
      $("reportReview").replaceChildren(new Option("All activities", ""));
      const contexts = new Map(
        reports.map((report) => [
          `${report.context.kind}:${report.context.id}`,
          report.context,
        ]),
      );
      for (const [id, context] of contexts)
        $("reportReview").append(
          new Option(`${context.name} · ${date(context.startedAt)}`, id),
        );
      if (contexts.has(selected)) $("reportReview").value = selected;
      if (result.currentSession)
        $("reportSessionCurrent").textContent =
          `${result.currentSession.name} · ${date(result.currentSession.startedAt)}`;
      render();
      lastRefresh = Date.now();
    } catch (error) {
      $("reportsWarning").textContent = error.message;
    } finally {
      refreshing = false;
      $("reportsRefresh").disabled = false;
    }
  }
  $("reportSearch").oninput = render;
  $("reportKind").onchange = render;
  $("reportReview").onchange = render;
  $("reportStatus").onchange = render;
  $("reportsRefresh").onclick = () => void refresh(true);
  $("reportsArchiveAll").onclick = () => void manage("archive-all");
  $("reportsDeleteArchive").onclick = () => void manage("delete-archive");
  $("reportSessionStart").onclick = async () => {
    try {
      const session = await call("report-sessions/start", {
        name: $("reportSessionName").value,
      });
      $("reportSessionCurrent").textContent =
        `${session.name} · ${date(session.startedAt)}`;
      await refresh(true);
    } catch (error) {
      $("reportSessionCurrent").textContent = error.message;
    }
  };
  return { refresh, updateState };
}
