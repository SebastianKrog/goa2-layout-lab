"""Fabricate M3 presentation fixtures on a real map, without touching live saves."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

LAB = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--backend', type=Path, default=Path(os.environ.get('GOA2_LAB_BACKEND', LAB.parent / 'goa2-backend')))
parser.add_argument('--output', type=Path, default=LAB / '.layout-lab/situation-recipes/mobile-presentation')
args = parser.parse_args()
sys.path.insert(0, str(args.backend.resolve() / 'src'))
from goa2.bootstrap import register_all_effects
from goa2.domain.models import CardState, StatType
from goa2.domain.models.enums import RuneType
from goa2.domain.models.marker import MarkerType
from goa2.engine.session import GameSession
from goa2.engine.setup import GameSetup
from goa2.server.map_paths import resolve_map_path
spec = importlib.util.spec_from_file_location('presentation_fixture_lab', LAB / 'backend.py')
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
register_all_effects()
args.output.mkdir(parents=True, exist_ok=True)
outputs = []

def fresh(name):
    state = GameSetup.create_game(str(resolve_map_path('forgotten_island')), [name], ['Wasp'], False, 'LONG', seed=20261019)
    return state, state.get_hero('hero_' + name.lower())

def write(key, state, hero):
    saved = lab.checkpoint(GameSession(state))
    restored, _ = lab.restore(saved)
    saved = lab.checkpoint(restored)
    again, _ = lab.restore(saved)
    assert lab.canonical_hash(saved['state']) == lab.canonical_hash(lab.checkpoint(again)['state'])
    payload = {'schema': lab.SCHEMA, 'name': 'M3 presentation - ' + key, 'checkpoint': saved,
        'provenance': {'kind': 'ui-fabrication', 'fixture': {'case': key}, 'seat': str(hero.id), 'seed': 20261019,
            'slots': [{'source': 'live', 'profile': 'portrait', 'render': '2d', 'layout': 'mobile', 'seat': seat}
                      for seat in (str(hero.id), 'spectator')]}, 'presentations': {}}
    path = args.output / (key + '.json')
    path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    outputs.append(str(path))

for count in [0, 1, 3, 9, 10]:
    state, hero = fresh('Gydion')
    hero.level = 8
    hero.items = {StatType.ATTACK: 2, StatType.DEFENSE: 1, StatType.INITIATIVE: 1}
    assert len(hero.spells) >= count
    for index, spell in enumerate(hero.spells):
        spell.state = CardState.OUTSIDE_SPELLBOOK if index < count else CardState.SPELLBOOK
        spell.is_facedown = index >= count
    state.place_marker(MarkerType.BOUNTY, str(hero.id), 1, 'hero_wasp')
    state.place_marker(MarkerType.POISON, str(hero.id), -1, 'hero_wasp')
    write('gydion-public-spells-' + str(count), state, hero)

state, hero = fresh('Snorri')
hero.rune_slots = {1: RuneType.AXE, 2: RuneType.BIRD, 3: RuneType.ANVIL, 4: RuneType.HORN}
state.turn = 2
hero.played_cards = [None, None, None, None]
write('snorri-empty-history-runes', state, hero)

state, hero = fresh('Razzle')
piece_id = state.get_piece_ids(str(hero.id))[0]
state.place_marker(MarkerType.BOUNTY, piece_id, 1, 'hero_wasp')
state.place_marker(MarkerType.POISON, piece_id, -1, 'hero_wasp')
write('razzle-piece-markers', state, hero)
print(json.dumps(outputs, indent=2))
