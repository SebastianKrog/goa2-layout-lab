// Canonical Presentation resolution; raw DOM adapter captures are normalized here.
import contract from "./state-contract.json" with { type: "json" };
export const USER_STATE_KEYS = new Set(contract.userStateKeys);
export const SESSION_STORAGE_PREFIXES = contract.sessionStoragePrefixes;
const clone = (value) => structuredClone(value);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

export function toPresentation(value = {}, viewpoint) {
  if (!object(value)) throw Error("Presentation must be an object.");
  let result;
  if (
    value.schema === 2 ||
    Object.hasOwn(value, "viewpoint") ||
    Object.hasOwn(value, "sessionState") ||
    Object.hasOwn(value, "userState")
  ) {
    if (!object(value.sessionState ?? {}) || !object(value.userState ?? {}))
      throw Error("Presentation states must be objects.");
    result = { schema: 2, sessionState: {}, userState: {}, ...clone(value) };
  } else {
    const { storage = {}, ...sessionState } = clone(value);
    const userState = {},
      scoped = {},
      warnings = [];
    for (const [key, val] of Object.entries(storage)) {
      if (USER_STATE_KEYS.has(key)) userState[key] = val;
      else if (
        SESSION_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
      )
        scoped[key] = val;
      else warnings.push(`Unsupported saved storage key: ${key}`);
    }
    if (Object.keys(scoped).length) sessionState.storage = scoped;
    result = {
      schema: 2,
      sessionState,
      userState,
      ...(warnings.length ? { warnings } : {}),
    };
  }
  for (const [key, val] of Object.entries(result.userState ?? {}))
    if (!USER_STATE_KEYS.has(key) || !(val === null || typeof val === "string"))
      throw Error(`Unsupported User State setting: ${key}`);
  if (viewpoint !== undefined) result.viewpoint = viewpoint;
  return result;
}
const SESSION_DEFAULTS = {
  pane: "board",
  selectedCard: null,
  inspectedCard: null,
  inspectedHero: null,
  camera: null,
  scroll: [],
  windowScroll: { x: 0, y: 0 },
};

export function resolvePresentation(...layers) {
  const result = {
    schema: 2,
    viewpoint: null,
    sessionState: clone(SESSION_DEFAULTS),
    userState: {},
  };
  const warnings = [];
  for (const layer of layers) {
    if (!layer) continue;
    const p = toPresentation(layer);
    if (Object.hasOwn(p, "viewpoint")) result.viewpoint = p.viewpoint;
    for (const [key, value] of Object.entries(p.sessionState ?? {}))
      result.sessionState[key] =
        value === null && Object.hasOwn(SESSION_DEFAULTS, key)
          ? clone(SESSION_DEFAULTS[key])
          : clone(value);
    Object.assign(result.userState, p.userState || {});
    if (p.adapter) result.adapter = clone(p.adapter);
    warnings.push(...(p.warnings || []));
  }
  if (warnings.length) result.warnings = [...new Set(warnings)];
  return result;
}

export function adapterPresentation(value, render) {
  if (!value) return value;
  const p = toPresentation(value);
  let session = p.sessionState || {};
  if (session.render && render && session.render !== render)
    session = session.modes?.[render] || { pane: "board" };
  return {
    ...clone(session),
    storage: { ...clone(p.userState || {}), ...clone(session.storage || {}) },
  };
}

export function resolveView(config, situation, explicit) {
  const defaults = {
    schema: 2,
    viewpoint: config.seat || null,
    sessionState: {},
    userState: {},
  };
  const intended = resolvePresentation(
    defaults,
    config.presentationDefaults,
    situation?.presentation,
    explicit,
    config.overrides,
  );
  if (
    intended.sessionState.render &&
    intended.sessionState.render !== config.render &&
    !intended.sessionState.modes?.[config.render]
  )
    intended.warnings = [
      ...(intended.warnings || []),
      `Saved ${intended.sessionState.render} Session State has no ${config.render} adapter; opening Board.`,
    ];
  const resolved = {
    ...config,
    presentationDefaults: config.presentationDefaults || defaults,
    seat:
      intended.viewpoint === null
        ? "spectator"
        : intended.viewpoint || config.seat || "spectator",
  };
  return {
    config: resolved,
    intended,
    presentation: adapterPresentation(intended, config.render),
  };
}
