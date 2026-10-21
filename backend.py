"""Isolated layout-lab app. Never imported by the production backend entrypoint."""

from __future__ import annotations

import copy
from contextlib import asynccontextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

from device_bots import bot_kinds, clone_bot_specs, start_clone_bots, stop_clone_bots, cancel_bot_tasks, update_clone_bots

FROZEN_MS = 1792238400000
SCHEMA = 1


@asynccontextmanager
async def lab_lifespan(app):
    """Fresh comparison clones; keep disk saves available for manual recovery."""
    from goa2.server.registry import GameRegistry
    from goa2.server.draft_registry import DraftRegistry
    from goa2.server.time_control import stop_timers
    from goa2.server.workers import shutdown_heavy_pool

    # The desk never reconnects to old clones after restart. Restoring them
    # validates every old checkpoint and resumes timers for invisible games.
    # Situations remain the durable source; do not delete old recovery files.
    registry = GameRegistry(save_dir=os.environ.get("GOA2_SAVE_DIR"))
    app.state.registry = registry
    app.state.draft_registry = DraftRegistry()
    try:
        yield
    finally:
        await cancel_bot_tasks(registry)
        await stop_timers(registry)
        shutdown_heavy_pool()


def stable_state(value):
    """Zone.hexes is a set; preserve ordered hands, stacks and decision lists."""
    if isinstance(value, dict):
        result = {k: stable_state(v) for k, v in value.items()}
        if isinstance(result.get("hexes"), list):
            result["hexes"] = sorted(
                result["hexes"], key=lambda h: json.dumps(h, sort_keys=True)
            )
        return result
    if isinstance(value, list):
        return [stable_state(v) for v in value]
    return value


def revision() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True,
        cwd=os.environ.get("GOA2_LAB_BACKEND_CHECKOUT"),
    ).strip()


def canonical_hash(state: dict) -> str:
    """Exclude transient correlation UUIDs, preserving all gameplay information."""

    def clean(value):
        if isinstance(value, dict):
            return {
                k: clean(v)
                for k, v in value.items()
                if k
                not in {
                    "request_id",
                    "active_request_id",
                    "pending_request_id",
                    "step_id",
                    "credited_response_request_ids",
                    "last_settled_at_ms",
                    "paused_at_ms",
                }
            }
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value

    return hashlib.sha256(
        json.dumps(stable_state(clean(state)), sort_keys=True).encode()
    ).hexdigest()


def checkpoint(session, *, names=None, replay=None) -> dict:
    return {
        "state": stable_state(session.state.model_dump(mode="json")),
        "rollback_snapshot": stable_state(copy.deepcopy(session._rollback_snapshot)),
        "rollback_actor_id": session._rollback_actor_id,
        "hero_names": names or {},
        "replay_log": replay or [],
    }


def restore(saved: dict):
    from goa2.domain.state import GameState
    from goa2.engine.session import GameSession
    from goa2.engine.handler import process_stack
    from goa2.domain.models import GamePhase

    state = GameState.model_validate(saved["state"])
    # Remaining time was settled at capture. Downtime never spends it.
    if state.clock is not None:
        state.clock.last_settled_at_ms = FROZEN_MS
        if state.clock.paused_at_ms is not None:
            state.clock.paused_at_ms = FROZEN_MS
    session = GameSession(state)
    session._rollback_snapshot = copy.deepcopy(saved.get("rollback_snapshot"))
    session._rollback_actor_id = saved.get("rollback_actor_id")
    result = None
    if state.execution_stack:
        stack = process_stack(state)
        if stack.input_request:
            session.reapply_rollback_flag(stack.input_request)
        result = session._build_result(stack.input_request, events=stack.events)
    elif state.phase == GamePhase.GAME_OVER:
        result = session._build_result()
    return session, result


def create_app():
    # Only this dedicated process uses virtual wall time. asyncio's monotonic
    # clock remains real, keeping sockets and ordinary UI work responsive.
    from device_transport import install_reconnect_compatibility

    install_reconnect_compatibility()
    real_time = time.time
    time.time = lambda: FROZEN_MS / 1000
    time.time_ns = lambda: FROZEN_MS * 1_000_000
    from goa2.server import time_control

    time_control.schedule_deadline = lambda game, registry: None
    from goa2.server.app import create_app as normal_app
    from fastapi import HTTPException, Request
    from fastapi.responses import JSONResponse
    from goa2.engine.setup import GameSetup
    from goa2.engine.session import GameSession
    from goa2.server.map_paths import resolve_map_path
    from goa2.server.replay import load_replay, replay_game
    from goa2.domain.time_control import settle_clock, TimeControlConfig

    root = Path(os.environ["GOA2_LAB_DATA"]).resolve()
    from situations import SituationStore

    library = SituationStore(Path(__file__).parent / "situations", root)
    app = normal_app()
    app.router.lifespan_context = lab_lifespan
    token = os.environ["GOA2_LAB_TOKEN"]

    @app.middleware("http")
    async def protect_lab(request: Request, call_next):
        if request.url.path.startswith("/__lab/"):
            if request.headers.get("x-lab-token") != token:
                return JSONResponse(
                    {"detail": "Layout lab credential required"}, status_code=403
                )
        return await call_next(request)

    def read(situation_id):
        try:
            return library.read(situation_id)
        except KeyError as error:
            raise HTTPException(404, "Situation not found") from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    def write(saved, name, *, provenance=None, presentations=None, situation_id=None, group=""):
        session, result = restore(saved)  # Fail before writing incompatible saves.
        ir = result.input_request if result else None
        situation = {
            "schema": SCHEMA,
            "id": situation_id or uuid.uuid4().hex[:12],
            "name": str(name or "Saved situation")[:160],
            "backend_revision": revision(),
            "saved_at": real_time(),
            "checkpoint": checkpoint(
                session, names=saved.get("hero_names"), replay=saved.get("replay_log")
            ),
            "provenance": provenance or {},
            "presentations": presentations or {},
            "summary": {
                "phase": session.state.phase.value,
                "round": session.state.round,
                "decision": ir.request_type.value if ir else None,
                "responder": ir.player_id if ir else None,
            },
        }
        return library.save(situation, group=group)

    from device_reports import install_device_reports
    install_device_reports(app, checkpoint=checkpoint, write=write, root=root, now=real_time)

    @app.get("/__lab/health")
    def health():
        return {
            "ok": True,
            "frozen_ms": FROZEN_MS,
            "schema": SCHEMA,
            "backend_revision": revision(),
            "bot_kinds": bot_kinds(),
        }

    @app.get("/__lab/scenarios", include_in_schema=False)
    @app.get("/__lab/situations")
    def situations(metadata: bool = False):
        return library.entries(metadata=metadata)

    @app.get("/__lab/situations/{situation_id}")
    def situation(situation_id: str):
        return read(situation_id)

    @app.post("/__lab/organize")
    def organize(body: dict):
        try:
            return library.organize(
                body["id"], body.get("group", ""), body.get("shared", False)
            )
        except KeyError as error:
            raise HTTPException(404, "Situation not found") from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    @app.post("/__lab/starter")
    def starter(body: dict):
        timing = None
        if body.get("timed"):
            timing = TimeControlConfig(
                planning_allowance_seconds=120,
                resolution_allowance_seconds=90,
                response_grant_seconds=20,
                initial_time_bank_seconds=300,
                time_bank_increment_seconds=30,
                max_time_bank_seconds=600,
                upgrade_allowance_seconds=60,
            )
        state = GameSetup.create_game(
            str(resolve_map_path("forgotten_island")),
            ["Arien", "Hanu"],
            ["Brogan", "Tigerclaw"],
            True,
            "LONG",
            seed=20261017,
            time_control=timing,
        )
        session = GameSession(state)
        from goa2.server.replay import create_replay_recorder

        recorder = create_replay_recorder(uuid.uuid4().hex[:12])
        recorder.record_setup(
            map_name="forgotten_island",
            red_heroes=["Arien", "Hanu"],
            blue_heroes=["Brogan", "Tigerclaw"],
            game_type="LONG",
            cheats=True,
            seed=20261017,
            time_control=timing,
            rules_version=state.rules_version,
        )
        if timing and body.get("ready_all"):
            from goa2.server.registry import ManagedGame
            from goa2.server.time_control import set_player_ready

            temporary = ManagedGame(
                game_id=recorder.game_id,
                session=session,
                player_tokens={},
                spectator_token="",
                hero_to_token={},
                replay_recorder=recorder,
            )
            for hero_id in state.clock.players:
                set_player_ready(temporary, hero_id, True, FROZEN_MS)
        return write(
            checkpoint(session, replay=recorder.records),
            body.get("name", "Planning — Arien / Hanu vs Brogan / Tigerclaw"),
            provenance={"kind": "starter", "timed": bool(timing)},
        )

    @app.post("/__lab/import")
    def import_situation(body: dict):
        try:
            if body.get("kind") == "replay":
                content = body["content"]
                with tempfile.TemporaryDirectory(dir=root) as temp:
                    path = Path(temp) / "replay.jsonl"
                    path.write_text(content, encoding="utf-8")
                    setup, decisions = load_replay(str(path))
                    index = body.get("decision", 0)
                    if not isinstance(index, int) or not 0 <= index <= len(decisions):
                        raise ValueError(
                            f"Decision must be between 0 and {len(decisions)}"
                        )
                    session = replay_game(str(path), until_decision=index)
                    records = [{"type": "setup", **setup}, *decisions[:index]]
                    return write(
                        checkpoint(
                            session, names=setup.get("player_names"), replay=records
                        ),
                        body.get("name", "Replay moment"),
                        provenance={
                            "kind": "replay",
                            "decision": index,
                            "clock_fidelity": "reconstructed",
                        },
                    )
            value = body["content"]
            value = json.loads(value) if isinstance(value, str) else value
            if "checkpoint" in value:
                if value.get("schema") != SCHEMA:
                    raise ValueError("Unsupported layout-lab situation schema")
                return write(
                    value["checkpoint"],
                    body.get("name") or value["name"],
                    provenance=value.get("provenance"),
                    presentations=value.get("presentations"),
                )
            # A normal backend save includes credentials. Whitelist checkpoint
            # fields instead of preserving any of the outer save envelope.
            from goa2.engine.persistence import SAVE_VERSION

            if value.get("version", SAVE_VERSION) != SAVE_VERSION:
                raise ValueError("Unsupported backend save version")
            saved = {
                k: value[k]
                for k in [
                    "state",
                    "rollback_snapshot",
                    "rollback_actor_id",
                    "hero_names",
                    "replay_log",
                ]
                if k in value
            }
            from goa2.domain.state import GameState

            state = GameState.model_validate(saved["state"])
            if state.clock is not None:
                settle_clock(
                    state.clock,
                    int(
                        body.get("captured_at_ms")
                        or state.clock.last_settled_at_ms
                        or FROZEN_MS
                    ),
                )
                saved["state"] = state.model_dump(mode="json")
            return write(
                saved, body.get("name", "Imported game"), provenance={"kind": "save"}
            )
        except (ValueError, KeyError, TypeError, RuntimeError) as error:
            raise HTTPException(
                422, f"Cannot import this situation: {error}"
            ) from error

    @app.post("/__lab/capture")
    async def capture(body: dict):
        game = app.state.registry.get(body["game_id"])
        async with game.lock:
            if game.session.state.clock is not None:
                settle_clock(game.session.state.clock, FROZEN_MS)
            return write(
                checkpoint(
                    game.session,
                    names=game.hero_names,
                    replay=game.replay_recorder.records if game.replay_recorder else [],
                ),
                body.get("name"),
                provenance=body.get("provenance"),
                presentations=body.get("presentations"),
            )

    @app.post("/__lab/clone")
    async def clone(body: dict):
        try:
            situation = read(body.get("situation_id") or body.get("scenario_id"))
            session, result = restore(situation["checkpoint"])
        except (ValueError, KeyError, TypeError) as error:
            raise HTTPException(
                422, f"Situation incompatible with this engine: {error}"
            ) from error
        heroes = [h.id for team in session.state.teams.values() for h in team.heroes]
        specs = clone_bot_specs(body, session.state)
        options = {"bot_specs": specs} if specs else {}
        game = app.state.registry.create_game(
            session, heroes, hero_names=situation["checkpoint"].get("hero_names"), **options
        )
        game.last_result = result
        records = situation["checkpoint"].get("replay_log")
        if records:
            records = [
                {**r, "game_id": game.game_id} if r.get("type") == "setup" else dict(r)
                for r in records
            ]
            game.replay_recorder.restore_from_save(records)
        app.state.registry.save_game(game.game_id)
        await start_clone_bots(game, app.state.registry)
        return {
            "game_id": game.game_id,
            "seats": game.hero_to_token,
            "spectator_token": game.spectator_token,
            "hash": canonical_hash(session.state.model_dump(mode="json")),
            "presentations": situation.get("presentations", {}),
            "summary": situation["summary"],
        }

    @app.post("/__lab/bots")
    async def configure_bots(body: dict):
        game = app.state.registry.get(body["game_id"])
        await update_clone_bots(game, app.state.registry, body)
        return {"ok": True}

    @app.post("/__lab/device/stop")
    async def stop_device(body: dict):
        game = app.state.registry.get(body["game_id"])
        await stop_clone_bots(game)
        return {"ok": True}

    @app.get("/__lab/games/{game_id}/responders")
    async def responders(game_id: str):
        from decision_players import decision_players

        game = app.state.registry.get(game_id)
        async with game.lock:
            return {"players": decision_players(game)}

    @app.get("/__lab/games/{game_id}")
    async def inspect(game_id: str):
        game = app.state.registry.get(game_id)
        async with game.lock:
            ir = game.last_result.input_request if game.last_result else None
            return {
                "hash": canonical_hash(game.session.state.model_dump(mode="json")),
                "decision": (
                    {"type": ir.request_type.value, "player_id": ir.player_id}
                    if ir
                    else None
                ),
                "phase": game.session.state.phase.value,
            }

    @app.post("/__lab/synchronize")
    async def synchronize(body: dict):
        # Reuse the actual game handlers without opening replacement player sockets.
        from contextlib import AsyncExitStack
        from goa2.server import ws as protocol

        ids = body.get("games", [])
        if (
            not isinstance(ids, list)
            or len(ids) not in (2, 3)
            or len(set(ids)) != len(ids)
        ):
            raise HTTPException(422, "Choose two or three distinct lab games")
        actor = body.get("actor")
        data = copy.deepcopy(body.get("message", {}))
        kind = data.get("type")
        handlers = {
            "SUBMIT_INPUT": (protocol._handle_submit_input, True),
            "COMMIT_CARD": (protocol._handle_commit_card, True),
            "UNCOMMIT_CARD": (protocol._handle_uncommit_card, False),
            "PASS_TURN": (protocol._handle_pass_turn, False),
            "FINISH_PLANNING": (protocol._handle_finish_planning, False),
            "ROLLBACK": (protocol._handle_rollback, False),
            "CHEATS_GOLD": (protocol._handle_cheats_gold, True),
            "STARTING_POSITION": (protocol._handle_starting_position, True),
            "SET_READY": (protocol._handle_set_ready, True),
        }
        overrides = {"PROPOSE_OVERRIDE", "VOTE_OVERRIDE", "CANCEL_OVERRIDE"}
        if kind not in handlers and kind not in overrides:
            raise HTTPException(422, "Unsupported synchronized game action")
        games = [app.state.registry.get(i) for i in ids]
        if body.get("source") not in ids or any(
            actor not in g.hero_to_token for g in games
        ):
            raise HTTPException(422, "Choose a player viewpoint to drive game actions")
        async with AsyncExitStack() as stack:
            for game in sorted(games, key=lambda g: g.game_id):
                await stack.enter_async_context(game.outbound_lock)
                await stack.enter_async_context(game.lock)
            hashes = [
                canonical_hash(g.session.state.model_dump(mode="json")) for g in games
            ]
            if len(set(hashes)) != 1:
                raise HTTPException(
                    409,
                    "Games have diverged. Reset all to the same situation before synchronizing.",
                )
            source = games[ids.index(body["source"])]
            if kind == "SUBMIT_INPUT" and data.get("request_id"):
                ir = source.last_result.input_request if source.last_result else None
                if ir is None or str(ir.id) != str(data["request_id"]):
                    raise HTTPException(
                        409,
                        "The source input prompt changed. Reset all or retry the current prompt.",
                    )
            if kind in overrides:
                rosters = [
                    (
                        set(protocol.connected_hero_ids(g))
                        if hasattr(protocol, "connected_hero_ids")
                        else set(protocol.ov.connected_hero_ids(g))
                    )
                    for g in games
                ]
                if any(
                    actor not in roster or roster != rosters[0] for roster in rosters
                ):
                    raise HTTPException(
                        409,
                        "Consensus actions require matching connected-player viewpoints in every view.",
                    )
                if kind in {"VOTE_OVERRIDE", "CANCEL_OVERRIDE"}:
                    proposal = source.pending_override
                    if proposal is None or proposal.id != data.get("proposal_id"):
                        raise HTTPException(409, "The source proposal changed")
            for game in games:
                message = copy.deepcopy(data)
                if kind == "SUBMIT_INPUT":
                    ir = game.last_result.input_request if game.last_result else None
                    message["request_id"] = ir.id if ir else ""
                if kind in {"VOTE_OVERRIDE", "CANCEL_OVERRIDE"}:
                    proposal = game.pending_override
                    if proposal is None:
                        raise HTTPException(
                            409, "A comparison has no matching open proposal"
                        )
                    message["proposal_id"] = proposal.id
                try:
                    if kind in overrides:
                        messages = await protocol._handle_override_message(
                            game, app.state.registry, actor, kind, message
                        )
                    else:
                        handler, with_data = handlers[kind]
                        reply = (
                            await handler(game, actor, message)
                            if with_data
                            else await handler(game, actor)
                        )
                        if reply.get("type") == "ERROR":
                            raise ValueError(
                                reply.get("detail", "Game action rejected")
                            )
                        protocol.finalize_timed_mutation(game, app.state.registry)
                        token = game.hero_to_token[actor]
                        messages = protocol._capture_broadcast(
                            game,
                            reply.get("events", []),
                            priority_token=token,
                            client_action_id=(
                                message.get("client_action_id")
                                if game.game_id == body["source"]
                                else None
                            ),
                        )
                    await protocol._send_captured_broadcast(game, messages)
                except Exception as error:
                    raise HTTPException(
                        409,
                        f"Synchronization stopped at {game.game_id}: {error}. Reset all before retrying.",
                    ) from error
            hashes = [
                canonical_hash(g.session.state.model_dump(mode="json")) for g in games
            ]
            if len(set(hashes)) != 1:
                raise HTTPException(
                    409,
                    "Synchronized action produced different games. Reset all before retrying.",
                )
            return {"ok": True, "hash": hashes[0]}

    @app.delete("/__lab/games/{game_id}")
    async def remove(game_id: str):
        game = app.state.registry.get(game_id)
        for ws in [
            *game.ws_connections.values(),
            *game.spectator_ws_connections.values(),
        ]:
            await ws.close(code=4004)
        app.state.registry.remove(game_id)
        return {"ok": True}

    return app
