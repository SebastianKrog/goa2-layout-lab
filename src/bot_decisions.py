"""Lab-only, stateless one-decision service using the separate bots checkout.

No game registry, persistent clone, autonomous worker, learned model or frontend.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os

KINDS = ("random", "heuristic", "ismcts")
ISMCTS_DECISION_SECONDS = 10.0


def choose(body):
    from automata.runtime.driver import (
        DecisionKind,
        IllegalBotDecisionError,
        inspect_next_decision,
        inspect_next_owner,
    )
    from automata.agents.contracts import PlanningKind
    from automata.search.contracts import CutoffUnit
    from automata.search.ismcts.engine import SearchDeadlineExceeded
    from goa2.domain.state import GameState
    from goa2.engine.session import SessionResult
    from goa2.server.bot_factory import agent_for_spec
    from goa2.server.bot_models import BotSpec, SearchSettings
    from pydantic import Field
    from bot_evaluation import LabLeafEvaluator

    # The isolated lab service may spend longer than the production API's
    # five-second cap. Keep that override here, without changing backend limits.
    class LabSearchSettings(SearchSettings):
        decision_timeout_seconds: float = Field(
            default=ISMCTS_DECISION_SECONDS, ge=0.05, le=ISMCTS_DECISION_SECONDS
        )

    # Search simulations need the same effect registry as the game server.
    from goa2.bootstrap import register_all_effects
    register_all_effects()

    checkpoint = json.loads(body["checkpoint_json"]) if "checkpoint_json" in body else body["checkpoint"]
    raw_result = json.loads(body["result_json"]) if "result_json" in body else body.get("result")
    state = GameState.model_validate(checkpoint["state"])
    result = SessionResult.model_validate(raw_result) if raw_result else None
    bots = body.get("bots", {})
    heroes = {str(h.id) for team in state.teams.values() for h in team.heroes}
    if (
        not isinstance(bots, dict)
        or any(hero not in heroes or kind not in KINDS for hero, kind in bots.items())
        or len(bots) >= len(heroes)
    ):
        raise ValueError("Choose classic bot policies and leave at least one hero manual")
    if not bots or state.phase.value == "GAME_OVER":
        return {"decision": None}
    if state.clock and state.clock.status.value == "WAITING_FOR_PLAYERS":
        for hero in bots:
            if hero not in state.clock.ready_hero_ids:
                return {
                    "decision": {
                        "actor": hero,
                        "message": {"type": "SET_READY", "ready": True},
                    }
                }
        return {"decision": None}
    if state.clock and state.clock.status.value != "RUNNING":
        return {"decision": None}

    agents = {}
    for hero, kind in bots.items():
        entropy = f"{body.get('seed', '')}:{body['hash']}:{hero}:{kind}"
        seed = int.from_bytes(hashlib.sha256(entropy.encode()).digest()[:8], "big")
        spec = BotSpec(
            kind=kind,
            search=LabSearchSettings(policy_source="heuristic", value_source="heuristic", leaf_mode="bounded_continuation", horizon=2)
            if kind == "ismcts" else None,
        )
        agents[hero] = agent_for_spec(spec, seed=seed, state=state,
                                      **({"leaf_evaluator": LabLeafEvaluator(), "cutoff_unit": CutoffUnit.TURNS} if kind == "ismcts" else {}))

    warning = None
    try:
        decision = inspect_next_decision(state, agents, result)
    except (SearchDeadlineExceeded, IllegalBotDecisionError, TimeoutError) as error:
        owner = inspect_next_owner(state, agents, result)
        if owner is None or bots.get(owner) != "ismcts":
            raise
        agents[owner] = agent_for_spec(BotSpec(kind="heuristic"), state=state)
        decision = inspect_next_decision(state, agents, result)
        warning = "ISMCTS used Simple fallback: " + str(error)

    if decision is None:
        if state.phase.value != "PLANNING" and not (result and result.input_request):
            return {
                "decision": {
                    "actor": next(iter(bots)),
                    "message": {"type": "ADVANCE"},
                }
            }
        return {"decision": None}
    if decision.kind == DecisionKind.INPUT:
        message = {"type": "SUBMIT_INPUT", "selection": decision.selection}
    elif decision.planning.kind == PlanningKind.COMMIT:
        message = {"type": "COMMIT_CARD", "card_id": decision.planning.card.id}
    else:
        message = {
            "type": "FINISH_PLANNING"
            if decision.planning.kind == PlanningKind.FINISH else "PASS_TURN"
        }
    return {
        "decision": {"actor": str(decision.hero_id), "message": message},
        "warning": warning,
    }


def create_app():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    app = FastAPI()
    lock = asyncio.Lock()
    token = os.environ["GOA2_LAB_TOKEN"]

    @app.middleware("http")
    async def auth(request: Request, call_next):
        if request.headers.get("x-lab-token") != token:
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
        return await call_next(request)

    @app.get("/health")
    def health():
        # Check classic imports at startup, without importing optional learned runtimes.
        from goa2.server.bot_factory import agent_for_spec

        return {"botKinds": list(KINDS)}

    @app.post("/decision")
    async def decision(body: dict):
        if not isinstance(body.get("checkpoint_json"), str) or not isinstance(body.get("result_json"), str):
            return JSONResponse({"detail": "Send opaque checkpoint_json and result_json strings"}, status_code=422)
        async with lock:
            try:
                return await asyncio.to_thread(choose, body)
            except (ValueError, KeyError, TypeError) as error:
                return JSONResponse({"detail": str(error)}, status_code=422)

    return app
