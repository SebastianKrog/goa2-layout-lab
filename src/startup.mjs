// An empty desk is the default. Neither a preset nor the order of the saved
// library opts into source preparation or cloning a game.
export async function loadStartupSituation({
  situationId,
  disabled,
  situations,
  comparison,
  presets,
  preset,
}) {
  if (!situationId || disabled) return;
  const situation = situations.find((s) => s.id === situationId);
  if (!situation)
    throw new Error(`Saved situation "${situationId}" was not found.`);
  return comparison.load(situation.id, presets[preset], {}, situation);
}
