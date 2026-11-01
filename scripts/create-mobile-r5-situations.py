"""Reproducible R5 upgrade and completed-rune moments; no production changes."""
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
from goa2.server.map_paths import resolve_map_path

spec = importlib.util.spec_from_file_location("r4_fixture_lab", LAB / "src/backend.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
register_all_effects()
output = LAB / ".layout-lab/situation-recipes/mobile-r5"
output.mkdir(parents=True, exist_ok=True)

def write(slug, name, state, condition):
    restored, _ = lab.restore(lab.checkpoint(GameSession(state)))
    checkpoint = lab.checkpoint(restored)
    again, _ = lab.restore(checkpoint)
    assert lab.canonical_hash(checkpoint["state"]) == lab.canonical_hash(lab.checkpoint(again)["state"])
    payload = lab.portable_situation({"schema": lab.SCHEMA, "name": name, "checkpoint": checkpoint,
        "provenance": {"kind": "ui-fabrication", "seed": 20261101, "fixture": {"factory": "scripts/create-mobile-r5-situations.py", "condition": condition}}})
    target = output / (slug + ".json")
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(target)

from goa2.domain.models import GamePhase, CardState
from goa2.domain.input import InputResponse
from goa2.engine.handler import push_steps
from goa2.engine.steps import ResolveUpgradesStep, ResolveCardStep
state = GameSetup.create_game(str(resolve_map_path("forgotten_island")), ["Gydion", "Hanu"], ["Arien", "Brogan"], False, "LONG", seed=20261101)
hero = state.get_hero("hero_gydion")
hero.level = 7
state.round = 4
state.phase = GamePhase.LEVEL_UP
state.pending_upgrades = {hero.id: 6}
push_steps(state, [ResolveUpgradesStep()])
session = GameSession(state)
result = session.advance()
assert result.input_request.request_type.value == "UPGRADE_PHASE"
write("gydion-upgrades", "Gydion: six pending tier upgrades", state, "Level 7 after six unspent level-ups. Full native catalog and private spellbook; real ResolveUpgradesStep with six pending choices, no acquired upgrades. Engine preview owns sequential tier prerequisites.")
state = GameSetup.create_game(str(resolve_map_path("forgotten_island")), ["Snorri", "Hanu"], ["Arien", "Brogan"], False, "LONG", seed=20261101)
hero = state.get_hero("hero_snorri")
card = next(card for card in hero.hand if card.id == "inscribe_the_runes")
hero.hand.remove(card)
card.state, card.is_facedown = CardState.UNRESOLVED, False
hero.current_turn_card = card
state.phase, state.current_actor_id, state.unresolved_hero_ids = GamePhase.RESOLUTION, hero.id, []
push_steps(state, [ResolveCardStep(hero_id=hero.id)])
session = GameSession(state)
result = session.advance()
result = session.advance(InputResponse(request_id=result.input_request.id, selection="SKILL"))
for rune in ["bird", "axe", "anvil"]:
    assert result.input_request.request_type.value == "SELECT_OPTION"
    result = session.advance(InputResponse(request_id=result.input_request.id, selection=rune))
assert len(hero.rune_slots) == 4
print("Completed rune phase", state.phase, "pending prompt", result.input_request)
write("snorri-confirmation", "Snorri: completed four-rune inscription receipt", state, "Real inscription choices bird, axe, anvil; engine automatically places horn in the fourth slot. All slots acknowledged. This engine completes inscription immediately, so no final gameplay confirmation exists; inspect the receipt without inventing another input.")
