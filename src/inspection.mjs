import { randomBytes } from "node:crypto";
import { sessionChange } from "./session-changes.mjs";

export function inspectionOptions(value = {}) {
  const result = {};
  if (Object.hasOwn(value, "viewpoint")) {
    if (value.viewpoint !== null && typeof value.viewpoint !== "string")
      throw Error("Viewpoint must be a player or spectator.");
    result.viewpoint = value.viewpoint;
  }
  if (value.presentation !== undefined)
    result.presentation = sessionChange(value.presentation);
  for (const [key, valid] of [
    ["presentationsByInterface", (k) => ["desktop", "mobile"].includes(k)],
    ["viewPresentations", (k) => /^[0-2]$/.test(k)],
  ]) {
    if (value[key] === undefined) continue;
    if (
      !value[key] ||
      typeof value[key] !== "object" ||
      Array.isArray(value[key])
    )
      throw Error("Invalid " + key);
    result[key] = Object.fromEntries(
      Object.entries(value[key]).map(([k, p]) => {
        if (!valid(k)) throw Error("Invalid Presentation target: " + k);
        return [k, sessionChange(p)];
      }),
    );
  }
  return result;
}
export function presentationFor(options, config, index) {
  const result = {
    schema: 2,
    sessionState: {},
    userState: {},
    ...(Object.hasOwn(options, "viewpoint")
      ? { viewpoint: options.viewpoint }
      : {}),
  };
  for (const p of [
    options.presentation,
    options.presentationsByInterface?.[config.uiMode || "desktop"],
    options.viewPresentations?.[index],
  ]) {
    if (!p) continue;
    if (Object.hasOwn(p, "viewpoint")) result.viewpoint = p.viewpoint;
    Object.assign(result.sessionState, p.sessionState || {});
    Object.assign(result.userState, p.userState || {});
    if (p.adapter) result.adapter = structuredClone(p.adapter);
    if (p.warnings?.length)
      result.warnings = [
        ...new Set([...(result.warnings || []), ...p.warnings]),
      ];
  }
  return result;
}
export function reviewEntry(value) {
  if (
    !value ||
    typeof value.situationId !== "string" ||
    !/^[A-Za-z0-9]{1,40}$/.test(value.situationId)
  )
    throw Error("Review entry requires a Situation ID.");
  const id = value.id || value.entryId || randomBytes(12).toString("hex");
  if (!/^[a-f0-9]{24}$/.test(id)) throw Error("Invalid Review entry ID.");
  return {
    schema: 1,
    kind: "review-entry",
    id,
    situationId: value.situationId,
    ...inspectionOptions(value),
  };
}
