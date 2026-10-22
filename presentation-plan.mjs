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
