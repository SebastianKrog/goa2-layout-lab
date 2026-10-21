"""Lab-only wiring for the backend fork's existing simple bot runtime."""
from contextlib import suppress
from importlib.util import find_spec
import asyncio

KINDS = ("random", "heuristic")


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
    from goa2.server.bot_models import BotSpec

    specs = {}
    for hero_id, kind in values.items():
        if hero_id not in heroes or hero_id == human or kind not in KINDS:
            raise HTTPException(422, "Choose Random or Simple for other heroes only")
        specs[hero_id] = BotSpec(kind=kind)
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
