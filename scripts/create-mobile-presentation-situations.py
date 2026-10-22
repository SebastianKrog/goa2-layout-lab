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
from goa2.domain.models import CardState, StatType, GamePhase, TeamColor
from goa2.domain.time_control import TimeControlConfig, ClockStatus
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
        'provenance': {'kind': 'ui-fabrication', 'fixture': {'case': key}, 'seed': 20261019},
        'presentation': lab.compose_presentation({'pane': 'board'}, str(hero.id)),
        'additionalPresentations': [lab.compose_presentation({'pane': 'board'}, 'spectator')],
        'suggestedLayout': lab.make_layout([
            {'source': 'live', 'profile': 'portrait', 'render': '2d', 'uiMode': 'mobile', 'seat': seat}
            for seat in (str(hero.id), 'spectator')])}
    path = args.output / (key + '.json')
    path.write_text(json.dumps(lab.portable_situation(payload), indent=2), encoding='utf-8')
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
    if count == 3:
        session = GameSession(state)
        session.commit_card(hero.id, hero.hand[0])
        write('gydion-three-indicators-committed', state, hero)

state, hero = fresh('Snorri')
hero.rune_slots = {1: RuneType.AXE, 2: RuneType.BIRD, 3: RuneType.ANVIL, 4: RuneType.HORN}
state.turn = 2
hero.played_cards = [None, None, None, None]
write('snorri-empty-history-runes', state, hero)
hero.play_card(hero.hand[0])
hero.current_turn_card.is_facedown = False
hero.resolve_current_card(turn_number=2)
write('snorri-played-history-runes', state, hero)

state, hero = fresh('Razzle')
piece_id = state.get_piece_ids(str(hero.id))[0]
state.place_marker(MarkerType.BOUNTY, piece_id, 1, 'hero_wasp')
state.place_marker(MarkerType.POISON, piece_id, -1, 'hero_wasp')
write('razzle-piece-markers', state, hero)
state, hero = fresh('Brogan')
hero.level = 8
hero.items = {StatType.ATTACK: 1, StatType.DEFENSE: 2, StatType.INITIATIVE: 1}
for card in list(hero.hand[:4]):
    hero.discard_card(card)
hero.discard_pile[0].is_active = True
hero.play_card(hero.hand[0])
hero.resolve_current_card(turn_number=2)
state.turn = 3
write('brogan-discard-active-history', state, hero)
hero.played_cards[1].is_facedown = False
hero.played_cards[1].is_active = True
write('brogan-public-active-history', state, hero)

state = GameSetup.create_game(str(resolve_map_path('forgotten_island')),
    ['Arien', 'Hanu', 'Snorri', 'Gydion', 'Emmitt'],
    ['Brogan', 'Tigerclaw', 'Wasp', 'Razzle', 'Silverarrow'], False, 'LONG', seed=20261019)
hero = state.get_hero('hero_arien')
GameSession(state).commit_card(hero.id, hero.hand[0])
write('shell-long-waiting-status', state, hero)

for status in [ClockStatus.PAUSED, ClockStatus.SUSPENDED_FOR_INACTIVITY, ClockStatus.FINISHED]:
    timing = TimeControlConfig(planning_allowance_seconds=120, resolution_allowance_seconds=90,
        response_grant_seconds=20, initial_time_bank_seconds=300, time_bank_increment_seconds=30,
        max_time_bank_seconds=600, upgrade_allowance_seconds=60)
    state = GameSetup.create_game(str(resolve_map_path('forgotten_island')), ['Arien', 'Hanu'],
        ['Brogan', 'Tigerclaw'], False, 'LONG', seed=20261019, time_control=timing)
    state.clock.status = status
    state.clock.paused_at_ms = lab.FROZEN_MS if status == ClockStatus.PAUSED else None
    state.clock.pause_requested_by = 'hero_arien' if status == ClockStatus.PAUSED else None
    if status == ClockStatus.FINISHED:
        state.phase = GamePhase.GAME_OVER
        state.winner = TeamColor.RED
    write('shell-' + status.value.lower(), state, state.get_hero('hero_arien'))

# A public rank-IV display, with all other prepared spells still masked.
state, hero = fresh('Gydion')
hero.level = 8
hero.items = {StatType.ATTACK: 2, StatType.INITIATIVE: 1}
for spell in hero.spells:
    spell.state = CardState.OUTSIDE_SPELLBOOK if spell.id == 'wish' else CardState.SPELLBOOK
    spell.is_facedown = spell.id != 'wish'
write('gydion-public-rank-4', state, hero)

print(json.dumps(outputs, indent=2))
