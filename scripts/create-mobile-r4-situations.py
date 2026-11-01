"""Reproducible R4 setup and empty-Hand moments; no production changes."""
import importlib.util
import json
import os
from pathlib import Path
import sys

LAB = Path(__file__).resolve().parents[1]
BACKEND = Path(os.environ.get("GOA2_LAB_BACKEND", LAB.parent / "goa2-backend"))
sys.path[:0] = [str(BACKEND / "src"), str(LAB / "src")]
from goa2.bootstrap import register_all_effects
from goa2.engine.setup import GameSetup
from goa2.engine.session import GameSession
from goa2.engine.phases import pass_turn
from goa2.engine.starting_positions import request_swap, position_view
from goa2.server.map_paths import resolve_map_path

spec = importlib.util.spec_from_file_location("r4_fixture_lab", LAB / "src/backend.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
register_all_effects()
output = LAB / ".layout-lab/situation-recipes/mobile-r4"
output.mkdir(parents=True, exist_ok=True)

def setup():
    return GameSetup.create_game(str(resolve_map_path("forgotten_island")), ["Arien", "Hanu"], ["Brogan", "Tigerclaw"], False, "LONG", seed=20261101)

def write(slug, name, state, condition):
    restored, _ = lab.restore(lab.checkpoint(GameSession(state)))
    checkpoint = lab.checkpoint(restored)
    again, _ = lab.restore(checkpoint)
    assert lab.canonical_hash(checkpoint["state"]) == lab.canonical_hash(lab.checkpoint(again)["state"])
    payload = lab.portable_situation({"schema": lab.SCHEMA, "name": name, "checkpoint": checkpoint,
        "provenance": {"kind": "ui-fabrication", "seed": 20261101, "fixture": {"factory": "scripts/create-mobile-r4-situations.py", "condition": condition}}})
    target = output / (slug + ".json")
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(target)

state = setup()
state.round = 2
state.turn = 4
for team in state.teams.values():
    for hero in team.heroes:
        for turn in range(1, 4):
            card = hero.hand[0]
            hero.play_card(card)
            card.is_facedown = False
            hero.resolve_current_card(turn_number=turn)
hero = state.get_hero("hero_arien")
for card in list(hero.hand):
    hero.discard_card(card)
pass_turn(state, hero.id)
assert not hero.hand and hero.current_turn_card is None and len(hero.discard_pile) == 2
assert len(hero.played_cards) == 3
write("empty-hand", "Arien: empty Hand after earlier actions and discards", state,
    "Round 2 turn 4 planning. All heroes have three resolved turn slots. Arien's two remaining cards were discarded earlier this round and she has passed through the engine; teammates/opponents still hold two cards and have not committed. Display fixture, not a replay of the earlier effects.")

state = setup()
request_id = request_swap(state, "hero_arien", "hero_hanu")
assert position_view(state, "hero_hanu")["requests"][0]["id"] == request_id
write("pending-swap", "Starting position: Hanu awaiting Arien's swap request", state,
    "Opening planning, before any commitment. The engine accepted Arien's request to swap with Hanu. Hanu sees Accept/Decline; no response has been submitted.")
