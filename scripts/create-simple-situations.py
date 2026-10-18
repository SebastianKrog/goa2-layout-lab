"""Fabricate the five basic card UI moments; no gameplay outcomes are tested.

Run with the sibling backend's Python environment. Outputs are local import
bundles; add verified copies to the shared library through the desk.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

LAB = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--backend",
    type=Path,
    default=Path(os.environ.get("GOA2_LAB_BACKEND", LAB.parent / "goa2-backend")),
)
parser.add_argument(
    "--output", type=Path, default=LAB / ".layout-lab/situation-recipes/simple"
)
args = parser.parse_args()
sys.path.insert(0, str(args.backend.resolve() / "src"))

from goa2.bootstrap import register_all_effects
from goa2.domain.input import InputRequestType
from goa2.domain.models import ActionType, CardState, GamePhase
from goa2.engine.handler import push_steps
from goa2.engine.session import GameSession
from goa2.engine.setup import GameSetup
from goa2.engine.steps import (
    AttackSequenceStep,
    ForceDiscardStep,
    ResolveCardStep,
    ResolveUpgradesStep,
)
from goa2.server.map_paths import resolve_map_path

spec = importlib.util.spec_from_file_location("fixture_lab_backend", LAB / "backend.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
register_all_effects()
SEED = 20261017


def fresh():
    return GameSetup.create_game(
        str(resolve_map_path("forgotten_island")),
        ["Arien", "Hanu"],
        ["Brogan", "Tigerclaw"],
        False,
        "LONG",
        seed=SEED,
    )


def played(state):
    hero = state.get_hero("hero_arien")
    card = next(c for c in hero.hand if c.id == "noble_blade")
    hero.hand.remove(card)
    card.state = CardState.UNRESOLVED
    card.is_facedown = False
    hero.current_turn_card = card
    state.phase = GamePhase.RESOLUTION
    state.current_actor_id = hero.id
    state.unresolved_hero_ids = []
    return hero


def make(case):
    state = fresh()
    if case == "select-card":
        return GameSession(state), None, "hero_arien", "noble_blade"
    if case == "upgrade-tier-2":
        hero = state.get_hero("hero_arien")
        hero.level = 2
        state.phase = GamePhase.LEVEL_UP
        state.pending_upgrades = {hero.id: 1}
        push_steps(state, [ResolveUpgradesStep()])
        expected, seat = InputRequestType.UPGRADE_PHASE, hero.id
    else:
        hero = played(state)
        seat = hero.id
        if case == "choose-action":
            steps = [ResolveCardStep(hero_id=hero.id)]
            expected = InputRequestType.CHOOSE_ACTION
        elif case == "defense-card":
            # Put attacker and defender on adjacent free floor hexes on the real map.
            occupied = set(state.entity_locations.values())
            floor = sorted(
                (
                    h
                    for h, t in state.board.tiles.items()
                    if not t.is_terrain and h not in occupied
                ),
                key=lambda h: (abs(h.q) + abs(h.r) + abs(h.s), h.q, h.r),
            )
            a, b = next(
                (h, n)
                for h in floor
                for n in h.neighbors()
                if n in state.board.tiles
                and not state.board.tiles[n].is_terrain
                and n not in occupied
            )
            state.entity_locations[hero.id] = a
            state.entity_locations["hero_brogan"] = b
            state.execution_context.update(
                current_action_type=ActionType.ATTACK,
                action_type_stack=[],
                victim_id="hero_brogan",
            )
            steps = [
                AttackSequenceStep(damage=4, range_val=1, target_id_key="victim_id")
            ]
            expected, seat = InputRequestType.SELECT_CARD_OR_PASS, "hero_brogan"
        elif case == "discard-card":
            steps = [ForceDiscardStep(victim_id="hero_brogan")]
            expected, seat = InputRequestType.SELECT_CARD, "hero_brogan"
        else:
            raise ValueError(case)
        push_steps(state, steps)
    session = GameSession(state)
    result = session.advance()
    request = result.input_request
    assert request is not None and request.request_type == expected, (case, request)
    assert request.player_id == ("simultaneous" if case == "upgrade-tier-2" else seat)
    if case == "upgrade-tier-2":
        assert request.context["players"][seat]["remaining"] == 1
        options = request.context["players"][seat]["options"]
        assert options and all(o["tier"].value == "II" for o in options)
    else:
        assert len(request.options) >= 2, (case, request)
    return session, expected, seat, None


CASES = [
    ("select-card", "Arien - select a card before committing", "cards/selection"),
    ("choose-action", "Arien - choose an action for Noble Blade", "cards/actions"),
    ("upgrade-tier-2", "Arien - choose one tier II upgrade", "cards/upgrades"),
    ("defense-card", "Brogan - choose a defense card", "cards/defense"),
    ("discard-card", "Brogan - choose a card to discard", "cards/discard"),
]
args.output.mkdir(parents=True, exist_ok=True)
manifest = []
for case, name, group in CASES:
    session, expected, seat, selection = make(case)
    saved = lab.checkpoint(session)
    restored, result = lab.restore(saved)
    assert restored.state.phase == session.state.phase
    assert (
        result.input_request.request_type if result and result.input_request else None
    ) == expected
    # Restoring a waiting step may initialize transient context defaults. Normalize
    # once, then require the same visual decision and an idempotent checkpoint.
    normalized = lab.checkpoint(restored)
    again, again_result = lab.restore(normalized)
    assert lab.canonical_hash(normalized["state"]) == lab.canonical_hash(
        lab.checkpoint(again)["state"]
    ), case
    saved = normalized
    slots = [
        {
            "source": "base",
            "profile": "portrait",
            "render": "2d",
            "layout": "desktop",
            "seat": seat,
        },
        {
            "source": "comparator",
            "profile": "portrait",
            "render": "2d",
            "layout": "mobile",
            "seat": seat,
        },
        {
            "source": "target",
            "profile": "portrait",
            "render": "2d",
            "layout": "desktop",
            "seat": seat,
        },
    ]
    payload = {
        "schema": lab.SCHEMA,
        "name": name,
        "checkpoint": saved,
        "provenance": {"kind": "ui-fabrication", "slots": slots},
        "presentations": {
            str(i): {
                "render": "2d",
                "pane": "hand" if selection else "board",
                **({"selectedCard": selection} if selection else {}),
            }
            for i in range(len(slots))
        },
    }
    destination = args.output / (case + ".json")
    destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    manifest.append(
        {
            "case": case,
            "name": name,
            "group": group,
            "seat": seat,
            "phase": session.state.phase.value,
            "decision": expected.value if expected else None,
            "selectedCard": selection,
            "file": destination.name,
        }
    )
    print(
        case,
        session.state.phase.value,
        expected.value if expected else "local selection",
        seat,
    )
(args.output / "manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
)
