"""Real planning-to-resolution checkpoints for mobile order badges."""
from pathlib import Path
import argparse
import importlib.util
import json
import sys

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--backend", type=Path, default=root.parent / "goa2-backend")
args = parser.parse_args()
sys.path.insert(0, str(args.backend / "src"))
from goa2.bootstrap import register_all_effects
from goa2.engine.setup import GameSetup
from goa2.engine.session import GameSession
from goa2.server.map_paths import resolve_map_path
from goa2.domain.input import InputResponse
from goa2.domain.models import TeamColor
spec = importlib.util.spec_from_file_location("resolution_lab", root / "backend.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
register_all_effects()
state = GameSetup.create_game(str(resolve_map_path("forgotten_island")), ["Arien", "Hanu"], ["Brogan", "Tigerclaw"], False, "LONG", seed=20261020)
state.tie_breaker_team = TeamColor.RED
session = GameSession(state)
for hero_id, card_id in [("hero_arien", "spell_break"), ("hero_hanu", "fight_and_flight"), ("hero_brogan", "onslaught"), ("hero_tigerclaw", "blink_strike")]:
    hero = state.get_hero(hero_id)
    result = session.commit_card(hero.id, next(card for card in hero.hand if card.id == card_id))
output = root / ".layout-lab/situation-recipes/mobile-resolution"
output.mkdir(parents=True, exist_ok=True)

def write(key):
    saved = lab.checkpoint(session)
    restored, pending = lab.restore(saved)
    saved = lab.checkpoint(restored)
    again, _ = lab.restore(saved)
    assert lab.canonical_hash(saved["state"]) == lab.canonical_hash(lab.checkpoint(again)["state"])
    assert pending.input_request is not None
    payload = {"schema": lab.SCHEMA, "name": "M3 resolution - " + key, "checkpoint": saved,
        "provenance": {"kind": "ui-fabrication", "fixture": {"case": key}, "seat": "hero_hanu", "seed": 20261020}, "presentations": {}}
    (output / (key + ".json")).write_text(json.dumps(lab.portable_situation(payload), indent=2), encoding="utf-8")
    print(key, pending.input_request.request_type, pending.input_request.options)

write("team-tie")
assert result.input_request is not None
assert any(getattr(option, "id", option) == "hero_hanu" for option in result.input_request.options)
result = session.advance(InputResponse(request_id=result.input_request.id, selection="hero_hanu"))
write("selected-teammate")

# Resolve a real HOLD so completion has an authoritative played slot.
result = session.advance(InputResponse(request_id=result.input_request.id, selection="HOLD"))
assert result.input_request.options[0].id == "CONFIRM"
result = session.advance(InputResponse(request_id=result.input_request.id, selection="CONFIRM"))
assert state.get_hero("hero_hanu").played_cards[state.turn - 1] is not None
assert result.input_request is not None
write("completed-turn")
# A display fixture for a removed, unqueued hero; preserve the next real prompt.
brogan = state.get_hero("hero_brogan")
if brogan.current_turn_card:
    brogan.discard_card(brogan.current_turn_card, from_hand=False)
state.unresolved_hero_ids = [hero_id for hero_id in state.unresolved_hero_ids if hero_id != brogan.id]
write("unqueued-no-card")
state.remove_entity(brogan.id)
write("offboard-and-completed")

state.remove_entity(state.get_hero("hero_hanu").id)
write("offboard-completed-turn")
