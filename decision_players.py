"""Lab-only selection of seats currently allowed to answer a decision."""


def decision_players(game):
    from goa2.domain.models import GamePhase
    from goa2.engine.phases import planning_open_for_second_card

    state = game.session.state
    heroes = [h for team in state.teams.values() for h in team.heroes]
    ids = [str(h.id) for h in heroes]
    if game.removed or state.phase == GamePhase.GAME_OVER:
        return []
    clock = state.clock
    if clock and clock.status.value == "WAITING_FOR_PLAYERS":
        return [hid for hid in ids if hid not in clock.ready_hero_ids]
    if clock and clock.status.value in ("SUSPENDED_FOR_INACTIVITY", "PAUSED", "FINISHED"):
        return []
    request = game.last_result.input_request if game.last_result else None
    if request:
        owner = request.player_id or ""
        if owner in ids:
            candidates = [owner]
        elif owner.startswith("team:"):
            color = owner.split(":", 1)[1]
            candidates = [str(h.id) for team in state.teams.values()
                          if color in (team.color.value, team.color.name) for h in team.heroes]
        elif owner == "simultaneous":
            players = request.context.get("players") or {}
            candidates = [hid for hid in ids if hid in players and
                          (request.request_type.value != "UPGRADE_PHASE" or players[hid].get("remaining", 0) > 0)]
        else:
            candidates = []
    elif state.phase == GamePhase.PLANNING:
        candidates = [str(h.id) for h in heroes if h.id not in state.pending_inputs
                      or planning_open_for_second_card(state, h.id)]
    else:
        # Use the server's responder, which accounts for delegated control.
        candidates = [game.current_responder] if game.current_responder in ids else []
    return candidates
