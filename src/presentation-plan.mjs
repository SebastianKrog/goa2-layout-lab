// Ordered semantic UI restoration shared by Playwright views and real devices.
export function mobileRestorationPlan(value, config) {
  if (config.uiMode !== "mobile") return [];
  const steps = [];
  const attr = (key, id) => `[${key}=${JSON.stringify(id)}]`;
  const spells = value.spellBrowserMobile;
  if (spells) {
    steps.push({
      label: "Public spell browser",
      click: attr("data-lab-open-spells", spells.heroId),
      wait: "[data-lab-mobile-spells]",
    });
    if (spells.selectedId)
      steps.push({
        label: "Selected spell",
        click: attr("data-lab-preview-spell", spells.selectedId),
      });
  }
  if (value.inspectionMobile) {
    const decision = value.inspectionMobileContext === "decision";
    const ids = decision
      ? [value.inspectionMobile]
      : [
          ...new Set(
            [value.inspectionMobileParent, value.inspectionMobile].filter(
              Boolean,
            ),
          ),
        ];
    for (const id of ids)
      steps.push({
        label: "Mobile inspection",
        click:
          (decision
            ? attr("data-decision-parent", value.inspectionMobileParent) + " "
            : "") + attr("data-lab-inspect-card", id),
        wait: attr("data-lab-mobile-inspection", id) + ":not([inert])",
      });
  }
  return steps;
}

// Older live gateways may have normalized resolved defaults as requested changes.
// Drop only proven no-op warnings; preserve unsupported targets and real failures.
export function devicePresentationWarnings(intended, presentation, config) {
  return (intended?.warnings || []).filter(warning => {
    if (warning === "Viewpoint is configured separately and was skipped in this Presentation.")
      return intended.viewpoint !== config.seat;
    if (warning === "Presentation change scroll is unsupported and was skipped.")
      return !Array.isArray(presentation.scroll) || presentation.scroll.length !== 0;
    if (warning === "Presentation change windowScroll is unsupported and was skipped.")
      return presentation.windowScroll?.x !== 0 || presentation.windowScroll?.y !== 0;
    return true;
  });
}

export async function restoreMobilePane(name, { until, visible, root = document }) {
  const current = () => root.querySelector('[aria-label="Mobile game"]')?.dataset.mobilePane
    || root.querySelector('[data-pane][aria-pressed="true"]')?.dataset.pane || "board";
  const active = current();
  if (active === name) return;
  const target = name === "board" ? active === "choice" ? "board-choice" : active
    : name === "choice" ? "board-choice" : name;
  const control = await until(() => visible(`button[data-pane="${target}"]`)
    || name === "choice" && visible('button[data-pane="choice"]'));
  if (name === "choice" && control.dataset.pane === "board-choice" && control.textContent.trim() !== "Choice")
    throw Error("Choice is unavailable for this viewpoint.");
  control.click();
  await until(() => current() === name);
}
