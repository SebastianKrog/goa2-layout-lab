"""Create a game-only empty-Hand planning Situation for mobile surface reviews."""
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = Path(os.environ.get("GOA2_LAB_BACKEND", ROOT.parent / "goa2-backend"))
sys.path[:0] = [str(BACKEND / "src"), str(ROOT / "src")]
from goa2.bootstrap import register_all_effects
from goa2.engine.session import GameSession
from goa2.engine.setup import GameSetup
from goa2.server.map_paths import resolve_map_path

spec = importlib.util.spec_from_file_location("empty_hand_lab", ROOT / "src/backend.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
register_all_effects()
state = GameSetup.create_game(str(resolve_map_path("forgotten_island")), ["Arien", "Hanu"], ["Brogan", "Tigerclaw"], False, "LONG", seed=20261024)
hero = state.get_hero("hero_arien")
# A late-round Hand exhausted by discards; the other heroes still have choices.
state.turn = 3
for card in list(hero.hand):
    hero.discard_card(card)
assert not hero.hand and hero.current_turn_card is None
assert state.get_hero("hero_hanu").hand
normalized, _ = lab.restore(lab.checkpoint(GameSession(state)))
saved = lab.checkpoint(normalized)
again, _ = lab.restore(saved)
assert lab.canonical_hash(saved["state"]) == lab.canonical_hash(lab.checkpoint(again)["state"])
assert not again.state.get_hero("hero_arien").hand
payload = lab.portable_situation({"schema": lab.SCHEMA, "name": "Planning: empty Hand while other heroes choose", "checkpoint": saved,
    "provenance": {"kind": "ui-fabrication", "seed": 20261024, "fixture": {"factory": "scripts/create-empty-hand-situation.py", "condition": "Turn 3 planning, Arien's five cards discarded; other heroes have uncommitted Hands"}}})
output = ROOT / ".layout-lab/situation-recipes/mobile-r1-empty-hand.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(output)
