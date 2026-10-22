"""Lab-only wiring for the backend fork's existing non-neural bot runtime."""
from contextlib import suppress
from importlib.util import find_spec
import asyncio

KINDS = ("random", "heuristic", "ismcts")


def bot_kinds():
    return list(KINDS) if find_spec("goa2.server.bots") is not None else []


def clone_bot_specs(body, state):
    from fastapi import HTTPException

    values = body.get("bots", {})
    if not isinstance(values, dict):
        raise HTTPException(422, "Bot choices must be an object")
    if not values:
        return {}
    if not bot_kinds():
        raise HTTPException(422, "This backend has no bots. Configure the bots backend checkout.")
    heroes = {str(h.id) for team in state.teams.values() for h in team.heroes}
    human = body.get("human_seat")
    if human not in heroes:
        raise HTTPException(422, "Choose your human hero before enabling bots")
    from goa2.server.bot_models import BotSpec, SearchSettings

    specs = {}
    for hero_id, kind in values.items():
        if hero_id not in heroes or hero_id == human or kind not in KINDS:
            raise HTTPException(422, "Choose Random, Simple or ISMCTS for other heroes only")
        # Keep numerical search settings at backend defaults. The lab exposes
        # no learned/artifact input; explicitly pin both components to heuristics.
        specs[hero_id] = BotSpec(
            kind=kind,
            search=SearchSettings(policy_source="heuristic", value_source="heuristic")
            if kind == "ismcts" else None,
        )
    return specs


async def start_clone_bots(game, registry):
    if getattr(game, "bot_specs", None):
        from goa2.server.bots import start_bot_lifecycle

        await start_bot_lifecycle(game, registry)


async def stop_clone_bots(game):
    # Keep the recovery save; retire just this private device clone's workers.
    async with game.lock:
        game.removed = True
        task = getattr(game, "bot_task", None)
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


async def cancel_bot_tasks(registry):
    if bot_kinds():
        from goa2.server.bots import cancel_all_bot_tasks

        await cancel_all_bot_tasks(registry)


async def update_clone_bots(game, registry, body):
    """Switch controllers on a lab clone without resetting its game moment."""
    specs = clone_bot_specs(body, game.session.state)
    if not bot_kinds():
        return  # Ordinary manual backends have no bot runtime fields.
    # Block normal mutation scheduling while retiring the old worker. Computed
    # results from its executor thread cannot apply after task cancellation.
    async with game.outbound_lock:
        task = game.bot_task
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        async with game.lock:
            game.bot_task = None
            game.bot_specs = specs
            game._bot_agents = None
            game._bot_fallback_agents = None
            registry.save_game(game.game_id)
    await start_clone_bots(game, registry)
