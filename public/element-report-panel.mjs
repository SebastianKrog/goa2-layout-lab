export function initElementReportPanel({
  read,
  call,
  notify,
  onSaved = async () => {},
}) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("elementReportDialog"),
    textarea = $("elementReportComment"),
    send = $("elementReportSend"),
    toggle = $("reportElement");
  let state = {},
    currentId,
    openedId,
    submitting = false,
    polling = false,
    debounce,
    lastReportId;
  const storageKey = (id) => "goa2-lab-element-comment:" + id;
  function error(message) {
    $("elementReportError").hidden = !message;
    $("elementReportError").textContent = message || "";
  }
  function update() {
    const draft = state.draft;
    document.body.classList.toggle("report-selecting", !!state.active);
    toggle.setAttribute("aria-pressed", String(!!state.active));
    toggle.textContent = state.active
      ? "Stop selecting"
      : draft
        ? "Resume report"
        : "Report an element";
    toggle.title = state.active
      ? "Click a glowing div in any view. Escape cancels."
      : "Select a div and report it across all views.";
    send.disabled = submitting || !textarea.value.trim();
    send.textContent = submitting ? "Saving report..." : "Send report";
    $("elementReportDiscard").disabled =
      submitting || draft?.stage === "capturing";
    if (draft) {
      if (draft.id !== currentId) {
        currentId = draft.id;
        textarea.value =
          localStorage.getItem(storageKey(draft.id)) ?? draft.comment ?? "";
        error("");
      }
      const missing = (draft.views || []).filter((v) => v.error);
      $("elementReportProgress").textContent =
        draft.stage === "capturing"
          ? `Capturing all views from view ${draft.selectedIndex + 1}. You can write now.`
          : `Capture ready: ${(draft.views || []).length} view(s).` +
            (missing.length
              ? " " +
                missing.map((v) => `View ${v.index + 1}: ${v.error}`).join(" ")
              : "") +
            (draft.error ? " " + draft.error : "");
      if (openedId !== draft.id) {
        openedId = draft.id;
        if (!dialog.open) dialog.showModal();
        textarea.focus();
      }
    }
    if (state.lastReport && state.lastReport.id !== lastReportId) {
      lastReportId = state.lastReport.id;
      const title = document.createElement("h3");
      title.textContent = "Element report saved";
      const link = document.createElement("a");
      link.textContent = "Open element report";
      link.href = state.lastReport.url;
      link.target = "_blank";
      link.rel = "noopener";
      $("report").replaceChildren(title, link);
      $("report").hidden = false;
    }
    send.disabled = submitting || !textarea.value.trim();
  }
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      state = await read("/api/element-report/status");
      update();
    } catch {
      /* The normal desk connection indicator handles disconnects. */
    } finally {
      polling = false;
    }
  }
  toggle.addEventListener("click", async () => {
    try {
      error("");
      if (state.draft) {
        if (!dialog.open) dialog.showModal();
        textarea.focus();
        return;
      }
      state = await call("element-report/mode", { enabled: !state.active });
      update();
      if (state.active)
        notify("Report mode: click a glowing div in any view. Escape cancels.");
    } catch (e) {
      notify(e.message);
    }
  });
  textarea.addEventListener("input", () => {
    if (!currentId) return;
    localStorage.setItem(storageKey(currentId), textarea.value);
    clearTimeout(debounce);
    debounce = setTimeout(
      () =>
        void call("element-report/comment", {
          id: currentId,
          comment: textarea.value,
        }).catch(() => {}),
      250,
    );
    update();
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) $("elementReportForm").requestSubmit();
    }
  });
  $("elementReportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || !currentId || !textarea.value.trim()) return;
    submitting = true;
    clearTimeout(debounce);
    error("");
    update();
    const id = currentId;
    try {
      const result = await call("element-report/send", {
        id,
        comment: textarea.value,
      });
      localStorage.removeItem(storageKey(id));
      state = { active: false, draft: null, lastReport: result };
      currentId = null;
      dialog.close();
      update();
      notify("Element report saved.");
      await onSaved();
    } catch (e) {
      error(e.message);
    } finally {
      submitting = false;
      update();
      void poll();
    }
  });
  $("elementReportDiscard").addEventListener("click", async () => {
    try {
      const id = currentId;
      state = await call("element-report/discard", { id });
      localStorage.removeItem(storageKey(id));
      currentId = null;
      textarea.value = "";
      dialog.close();
      update();
    } catch (e) {
      error(e.message);
    }
  });
  void poll();
  setInterval(() => void poll(), 500);
}
