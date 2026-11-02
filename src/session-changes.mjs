// Small session changes. Full UI snapshots remain an internal evidence format.
export function sessionChange(value = {}, { reusable = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Presentation must be an object.");
  const source = value.sessionState ?? value;
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error("Presentation changes must be an object.");
  const sessionState = {},
    warnings = [...(value.warnings || [])];
  if (value.viewpoint !== undefined)
    warnings.push(
      "Viewpoint is configured separately and was skipped in this Presentation.",
    );
  if (Object.keys(value.userState || {}).length)
    warnings.push("Preferences are not Presentation changes and were skipped.");
  const allowed = new Set([
    "pane",
    "selectedCard",
    "inspectedCard",
    "inspectedHero",
    "publicSpells",
    "inspectionMobile",
    "inspectionMobileParent",
    "inspectionMobileContext",
    "spellBrowserMobile",
  ]);
  for (const [key, target] of Object.entries(source)) {
    if (!allowed.has(key)) {
      if (target != null && !["schema", "userState", "viewpoint"].includes(key))
        warnings.push(
          `Presentation change ${key} is unsupported and was skipped.`,
        );
      continue;
    }
    if (["selectedCard", "inspectedCard"].includes(key)) {
      if (
        target !== null &&
        typeof target !== "string" &&
        (!target || typeof target !== "object" || Array.isArray(target))
      )
        throw Error("Use a card role or exact card ID.");
      if (reusable && typeof target === "string")
        throw Error(
          "Reusable Presentations use card roles. Put exact card IDs on Review entries.",
        );
    }
    sessionState[key] = structuredClone(target);
  }
  return {
    schema: 2,
    sessionState,
    ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
  };
}

// Uses only the player-scoped game view. Never fetches hidden cards or submits a choice.
export function resolveCardTarget(target, view, seat, visibleIds = null) {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object")
    throw Error("Missing card target.");
  const heroes = Object.values(view?.teams || {}).flatMap(
    (t) => t.heroes || [],
  );
  const own = heroes.find((h) => h.id === (target.hero || seat));
  const selectedHeroes = own ? [own] : target.hero ? [] : heroes;
  const tiers = { 1: "I", 2: "II", 3: "III", 4: "IV" };
  const cards = selectedHeroes.flatMap((h) =>
    [
      "hand",
      "deck",
      "discard_pile",
      "played_cards",
      "cast_spells",
      "spellbook",
      "ultimate_card",
      "current_turn_card",
      "extra_turn_card",
    ].flatMap((key) =>
      Array.isArray(h[key]) ? h[key] : h[key]?.id ? [h[key]] : [],
    ),
  );
  const matched = cards.filter((card) => {
    if (visibleIds && !visibleIds.includes(card.id)) return false;
    if (target.role === "gold" && card.color !== "GOLD") return false;
    if (target.role === "upgrade" && !["II", "III"].includes(card.tier))
      return false;
    if (!["gold", "upgrade", "color"].includes(target.role))
      throw Error("Unknown card role.");
    if (target.color && card.color !== String(target.color).toUpperCase())
      return false;
    if (target.tier && card.tier !== (tiers[target.tier] || target.tier))
      return false;
    if (
      target.branch &&
      !String(card.image_id || "").endsWith(String(target.branch).toUpperCase())
    )
      return false;
    return true;
  });
  const ids = [...new Set(matched.map((c) => c.id))];
  if (!ids.length)
    throw Error(
      "No available card matches this role in the current Viewpoint.",
    );
  if (ids.length !== 1)
    throw Error(
      "Card role is ambiguous; specify color or hero, or use an exact card in the Review entry.",
    );
  return ids[0];
}
export function publicSpellHero(view, seat, target = true) {
  const heroes = Object.values(view?.teams || {}).flatMap(
    (t) => t.heroes || [],
  );
  const candidates = heroes.filter(
    (h) => h.spellbook != null || h.cast_spells?.length,
  );
  const explicit = typeof target === "string" ? target : target?.hero;
  if (explicit) {
    const hero = candidates.find((h) => h.id === explicit);
    if (!hero) throw Error("This hero has no public-spell display.");
    return hero.id;
  }
  const own = candidates.find((h) => h.id === seat);
  if (own) return own.id;
  if (candidates.length !== 1)
    throw Error(
      candidates.length
        ? "Choose a hero for public spells."
        : "No spellcaster is available in this Situation.",
    );
  return candidates[0].id;
}
