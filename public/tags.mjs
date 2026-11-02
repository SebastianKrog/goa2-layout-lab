// Shared tag rules for View settings, filtering and the metadata editor.
export function normalizeTags(value = []) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((t) => typeof t !== "string"))
    throw Error("Tags must be a list of names.");
  const tags = [
    ...new Set(
      value
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean),
    ),
  ].sort();
  if (
    tags.length > 32 ||
    tags.some((t) => t.length > 48 || !/^[a-z0-9][a-z0-9:_-]*$/.test(t))
  )
    throw Error(
      "Use up to 32 tags, each up to 48 letters, numbers, colons, dashes or underscores.",
    );
  return tags;
}
export const parseTags = (text) => normalizeTags(text.split(","));
export const situationTags = (s) =>
  [
    ...new Set([
      ...normalizeTags(s.tags),
      ...normalizeTags(s.decisionStateTags),
    ]),
  ].sort();

export const tagType = (tag) =>
  tag.includes(":") ? tag.slice(0, tag.indexOf(":")) : "label";
export const tagLabel = (tag) => {
  const value = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
  const words = value.replaceAll("-", " ").replaceAll("_", " ");
  return /^(2d|3d)$/i.test(words)
    ? words.toUpperCase()
    : words.charAt(0).toUpperCase() + words.slice(1);
};
