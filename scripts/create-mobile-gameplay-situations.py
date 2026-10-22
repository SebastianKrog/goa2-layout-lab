"""Create real engine checkpoints for the M2 special-hero browser checks.

Run with the sibling backend's Python environment; no production saves are read.
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
parser.add_argument('--backend', type=Path, default=Path(os.environ.get('GOA2_LAB_BACKEND', LAB.parent / 'goa2-backend')))
parser.add_argument('--output', type=Path, default=LAB / '.layout-lab/situation-recipes/mobile-gameplay')
args = parser.parse_args()
sys.path.insert(0, str(args.backend.resolve() / 'src'))
sys.path.insert(0, str(LAB / "src"))
from goa2.bootstrap import register_all_effects
from goa2.domain.input import InputRequestType, InputResponse
from goa2.domain.models import CardState, GamePhase
from goa2.domain.types import HeroID
from goa2.engine.handler import push_steps
from goa2.engine.session import GameSession
from goa2.engine.setup import GameSetup
from goa2.engine.steps import ResolveCardStep
from goa2.server.map_paths import resolve_map_path

spec = importlib.util.spec_from_file_location('mobile_fixture_lab', LAB / 'src/backend.py')
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
register_all_effects()

def fresh(name):
    return GameSetup.create_game(str(resolve_map_path('forgotten_island')), [name], ['Wasp'], False, 'LONG', seed=20261017)

def action(state, card_id):
    hero = state.teams[next(iter(state.teams))].heroes[0]
    card = next(card for card in hero.hand if card.id == card_id)
    hero.hand.remove(card)
    card.state, card.is_facedown = CardState.UNRESOLVED, False
    hero.current_turn_card = card
    state.phase, state.current_actor_id, state.unresolved_hero_ids = GamePhase.RESOLUTION, hero.id, []
    push_steps(state, [ResolveCardStep(hero_id=hero.id)])
    session = GameSession(state)
    result = session.advance()
    assert result.input_request.request_type == InputRequestType.CHOOSE_ACTION
    result = session.advance(InputResponse(request_id=result.input_request.id, selection='SKILL'))
    return session, result, str(hero.id)

def write(key, session, result, seat):
    checkpoint = lab.checkpoint(session)
    restored, pending = lab.restore(checkpoint)
    if result is not None:
        assert pending.input_request.request_type == result.input_request.request_type
    checkpoint = lab.checkpoint(restored)
    again, _ = lab.restore(checkpoint)
    assert lab.canonical_hash(checkpoint['state']) == lab.canonical_hash(lab.checkpoint(again)['state'])
    payload = {'schema': lab.SCHEMA, 'name': f'M2 acceptance - {key}', 'checkpoint': checkpoint,
        'provenance': {'kind': 'ui-fabrication', 'fixture': {'case': key}, 'seed': 20261017},
        'presentation': lab.compose_presentation({'pane': 'board'}, seat),
        'suggestedLayout': lab.make_layout([
            {'source': source, 'profile': 'portrait', 'render': '2d',
             'uiMode': 'mobile' if source == 'comparator' else 'desktop', 'seat': seat}
            for source in ('base', 'comparator', 'target')])}
    output = args.output / f'{key}.json'
    output.write_text(json.dumps(lab.portable_situation(payload), indent=2), encoding='utf-8')
    return str(output)

args.output.mkdir(parents=True, exist_ok=True)
outputs = []
state = fresh('Gydion')
hero = state.get_hero('hero_gydion')
for spell in hero.spells:
    spell.state, spell.is_facedown = CardState.SPELLBOOK, True
session, result, seat = action(state, 'cantrip')
assert result.input_request.request_type == InputRequestType.SELECT_CARD
assert any(option.id == 'magic_missile' for option in result.input_request.options)
outputs.append(write('gydion-spell-choice', session, result, seat))

state = fresh('Snorri')
session, result, seat = action(state, 'inscribe_the_runes')
assert result.input_request.request_type == InputRequestType.SELECT_OPTION
outputs.append(write('snorri-inscription', session, result, seat))

state = fresh('Takahide')
session, result, seat = action(state, 'bushido')
assert result.input_request.request_type == InputRequestType.SELECT_CARD
assert len(result.input_request.options) == 2
outputs.append(write('takahide-gold-card-choice', session, result, seat))

state = fresh('Emmitt')
hero = state.get_hero('hero_emmitt')
hero.level = 8
session = GameSession(state)
session.commit_card(HeroID(hero.id), hero.hand[0])
assert state.phase == GamePhase.PLANNING
outputs.append(write('emmitt-second-card', session, None, str(hero.id)))
session.commit_card(HeroID(hero.id), hero.hand[0])
assert state.phase == GamePhase.PLANNING
assert hero.id in state.pending_inputs and hero.id in state.pending_second_cards
outputs.append(write('emmitt-two-cards-committed', session, None, str(hero.id)))
print(json.dumps(outputs, indent=2))
