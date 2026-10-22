import { toPresentation } from "./presentation-model.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envFile = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--env-file="))
  ?.slice(11);
if (envFile) process.loadEnvFile(path.resolve(envFile));

export const TOOL = path.dirname(fileURLToPath(import.meta.url));
// ROOT is the frontend checkout; TOOL and all local data belong to this repo.
export const ROOT = path.resolve(
  process.env.GOA2_LAB_FRONTEND || path.join(TOOL, "../goa2-frontend"),
);
export const DATA = path.join(TOOL, ".layout-lab");
export const BACKEND = path.resolve(
  process.env.GOA2_LAB_BACKEND || path.join(TOOL, "../goa2-backend"),
);
export const PATCH = path.resolve(
  process.env.GOA2_LAB_PATCH || path.join(TOOL, "../goa2-mobile-2d-patch"),
);
export const REFERENCES = {
  base: "a3c5e0a46b35a42cd6e054512ce3dbc6a61a579c",
  script: "ad1eed5427b91b8daaebb56c4ceafda01db5f7de",
};
export function launchSettings(
  args = process.argv.slice(2),
  env = process.env,
) {
  const value = (flag, key, fallback) =>
    args.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3) ||
    env[key] ||
    fallback;
  const ports = {};
  for (const [name, fallback] of Object.entries({
    comparator: 3100,
    base: 3101,
    live: 3102,
    backend: 8100,
    desk: 3200,
  })) {
    const port = Number(env[`GOA2_LAB_${name.toUpperCase()}_PORT`] || fallback);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error(`Invalid ${name} port.`);
    ports[name] = port;
  }
  if (new Set(Object.values(ports)).size !== Object.keys(ports).length)
    throw new Error("Comparison service ports must be different.");
  const preset = value("preset", "GOA2_LAB_PRESET", "current");
  const situationArg = args.find((arg) => arg.startsWith("--situation="));
  const situationId =
    situationArg === undefined
      ? null
      : situationArg.slice("--situation=".length);
  if (situationId !== null && !/^[A-Za-z0-9]{1,40}$/.test(situationId))
    throw new Error("Use --situation=<saved-situation-id>.");
  return {
    baseRef: value("base-ref", "GOA2_LAB_BASE_REF", REFERENCES.base),
    scriptRef: value("script-ref", "GOA2_LAB_SCRIPT_REF", REFERENCES.script),
    comparatorRef: value(
      "comparator-ref",
      "GOA2_LAB_COMPARATOR_REF",
      "mobile-migration",
    ),
    preset:
      {
        current: "Current",
        mobile: "Mobile migration",
        "desktop-2d": "Layout regression",
        "desktop-3d": "3D regression",
      }[preset] || preset,
    situationId,
    display: value("display", "GOA2_LAB_DISPLAY", "embedded"),
    ports,
  };
}
export const STARTUP = launchSettings();
export const PORTS = STARTUP.ports;
export const PROFILES = {
  portrait: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  },
  landscape: {
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  },
  compact: {
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  },
};
const slot = (source, profile, render, uiMode = "desktop") => ({
  source,
  profile,
  render,
  uiMode,
  seat: "hero_arien",
});
export const PRESETS = {
  Current: [slot("live", "desktop", "2d")],
  "Play solo": [slot("live", "portrait", "2d", "mobile")],
  "Mobile migration": [
    slot("base", "portrait", "2d"),
    slot("comparator", "portrait", "2d", "mobile"),
    slot("target", "portrait", "2d"),
  ],
  "Layout regression": [
    slot("base", "desktop", "2d"),
    slot("comparator", "desktop", "2d"),
  ],
  "3D regression": [
    slot("base", "desktop", "3d"),
    slot("comparator", "desktop", "3d"),
  ],
};
export function validateSlots(slots) {
  if (!Array.isArray(slots) || ![1, 2, 3].includes(slots.length))
    throw new Error("Choose one, two or three windows.");
  return slots.map((value) => {
    if (Object.hasOwn(value, "layout"))
      throw Error(
        "Use uiMode in View settings; port old saved Layouts offline.",
      );
    if (
      ["checkpoint", "decisionStateId", "situation", "presentation"].some(
        (key) => Object.hasOwn(value, key),
      )
    )
      throw Error(
        "View settings cannot contain a Situation or Decision State.",
      );
    const s = { ...value, uiMode: value.uiMode ?? "desktop" };
    if (s.overrides !== undefined) s.overrides = toPresentation(s.overrides);
    if (s.presentationDefaults !== undefined)
      s.presentationDefaults = toPresentation(s.presentationDefaults);
    if (
      s.label !== undefined &&
      (typeof s.label !== "string" || s.label.length > 80)
    )
      throw new Error("View names must be at most 80 characters.");
    if (!["base", "comparator", "target", "live"].includes(s.source))
      throw new Error("Unknown frontend source.");
    if (!PROFILES[s.profile]) throw new Error("Unknown device profile.");
    if (!["2d", "3d"].includes(s.render)) throw new Error("Choose 2D or 3D.");
    if (!["desktop", "mobile"].includes(s.uiMode))
      throw new Error("Unknown UI layout.");
    if (s.source === "target" && (s.render !== "2d" || s.uiMode !== "desktop"))
      throw new Error("Target uses the base 2D UI with the userscript.");
    if (s.source === "base" && s.uiMode !== "desktop")
      throw new Error("The pinned Base has no native mobile shell.");
    if (s.uiMode === "mobile" && s.render !== "2d")
      throw new Error("The native mobile shell uses 2D.");
    if (typeof s.seat !== "string" || !s.seat)
      throw new Error("Choose a player seat or spectator.");
    if (s.autoSwitch !== undefined && typeof s.autoSwitch !== "boolean")
      throw new Error("Auto switch must be on or off.");
    if (s.bots !== undefined) {
      if (!s.bots || typeof s.bots !== "object" || Array.isArray(s.bots))
        throw new Error("Bot choices must be an object.");
      if (
        Object.values(s.bots).some(
          (kind) => !["random", "heuristic", "ismcts"].includes(kind),
        )
      )
        throw new Error("Choose Random, Simple or ISMCTS bot policies.");
    }
    return s;
  });
}
// Keep chosen viewpoints when valid; a new roster cannot retain an absent seat.
export function slotsForSituation(configs, situation) {
  const slots = validateSlots(configs);
  const heroes = Object.values(
    situation.checkpoint?.state?.teams || {},
  ).flatMap((t) => t.heroes || []);
  const seats = new Set(heroes.map((h) => h.id));
  if (!seats.size) throw new Error("Situation has no player seats.");
  for (const s of slots)
    if (Object.keys(s.bots || {}).some((id) => !seats.has(id)))
      throw new Error(
        "Bot hero is absent from this situation. Edit the view controllers.",
      );
  for (const s of slots)
    if (Object.keys(s.bots || {}).length >= seats.size)
      throw new Error(
        "Leave at least one hero manual when playing against bots.",
      );
  const preferred = [
    situation.presentation?.viewpoint,
    situation.summary?.responder,
    heroes.find((h) => situation.summary?.responder === "team:" + h.team)?.id,
    heroes[0].id,
  ].find((seat) => seats.has(seat));
  return validateSlots(
    slots.map((slot) =>
      slot.seat === "spectator" || seats.has(slot.seat)
        ? slot
        : { ...slot, seat: preferred },
    ),
  );
}
export function gameURL(port, clone, s) {
  const token =
    s.seat === "spectator" ? clone.spectator_token : clone.seats[s.seat];
  if (!token) throw new Error(`Seat ${s.seat} is absent from this situation.`);
  const query = new URLSearchParams({
    token,
    "3d": s.render === "3d" ? "1" : "0",
  });
  if (s.source === "comparator" || s.source === "live")
    query.set("ui", s.uiMode);
  return `http://localhost:${port}/game/${clone.game_id}?${query}`;
}
export function linuxPath(value) {
  if (process.platform !== "win32") return value;
  if (!/^[a-z]:[\\/]/i.test(value))
    throw new Error(`Expected a Windows drive path: ${value}`);
  return `/mnt/${value[0].toLowerCase()}/${value.slice(3).replaceAll("\\", "/")}`;
}
