// Quickstarts clone the shared opening; they never create local Situation drafts.
export const QUICKSTART_SITUATION = "a00000000001";
export function quickstartConfig(id, situation, capabilities) {
  if (!["desktop", "portrait", "device"].includes(id))
    throw Error("Choose Desktop, Mobile portrait or Device quickstart.");
  if (!(capabilities.botKinds || []).includes("ismcts"))
    throw Error(
      "ISMCTS bots are unavailable. Configure the separate bot decision checkout.",
    );
  const teams = situation.checkpoint.state.teams;
  const human = teams.RED?.heroes || [];
  const opponents = teams.BLUE?.heroes || [];
  if (
    human.length !== 2 ||
    opponents.length !== 2 ||
    Object.keys(teams).length !== 2
  )
    throw Error("The quickstart opening must have two teams of two heroes.");
  return {
    source: "live",
    profile: id === "desktop" ? "desktop" : "portrait",
    render: "2d",
    uiMode: id === "desktop" ? "desktop" : "mobile",
    seat: human[0].id,
    autoSwitch: true,
    autoSwitchManualOnly: true,
    bots: Object.fromEntries(opponents.map((hero) => [hero.id, "ismcts"])),
  };
}
export function respondingSeat(
  players,
  config,
  seats,
  bots = config.bots || {},
) {
  const eligible = players.filter(
    (id) => seats[id] && (!config.autoSwitchManualOnly || !bots[id]),
  );
  return eligible.length && !eligible.includes(config.seat)
    ? eligible[0]
    : null;
}
