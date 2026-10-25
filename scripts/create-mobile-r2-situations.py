"""Game-only spell-reference and unlocked-Ultimate renderer moments."""
import importlib.util
import json
import os
from pathlib import Path
import sys
LAB = Path(__file__).resolve().parents[1]
BACKEND = Path(os.environ.get('GOA2_LAB_BACKEND', LAB.parent / 'goa2-backend'))
sys.path[:0] = [str(BACKEND / 'src'), str(LAB / 'src')]
from goa2.bootstrap import register_all_effects
from goa2.domain.models import CardState
from goa2.engine.session import GameSession
from goa2.engine.steps import ResolveUpgradesStep, apply_hero_upgrade
from goa2.engine.setup import GameSetup
from goa2.server.map_paths import resolve_map_path
from goa2.scripts.ursafar_effects import UnboundFuryEffect
spec=importlib.util.spec_from_file_location('r2_lab', LAB / 'src/backend.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
register_all_effects()
output=LAB / '.layout-lab/situation-recipes/mobile-r2';output.mkdir(parents=True,exist_ok=True)
def write(name,state,condition):
    session,_=lab.restore(lab.checkpoint(GameSession(state)))
    checkpoint=lab.checkpoint(session);again,_=lab.restore(checkpoint)
    assert lab.canonical_hash(checkpoint['state'])==lab.canonical_hash(lab.checkpoint(again)['state'])
    payload=lab.portable_situation({'schema':lab.SCHEMA,'name':name,'checkpoint':checkpoint,
        'provenance':{'kind':'ui-fabrication','seed':20261024,'fixture':{'factory':'scripts/create-mobile-r2-situations.py','condition':condition}}})
    path=output / (name.split(':')[0].lower()+'.json');path.write_text(json.dumps(payload,indent=2),encoding='utf8');print(path)
state=GameSetup.create_game(str(resolve_map_path('forgotten_island')),['Gydion','Hanu'],['Arien','Brogan'],False,'LONG',seed=20261024)
hero=state.get_hero('hero_gydion')
state.round=2
for spell in hero.spells:
    spell.state=CardState.OUTSIDE_SPELLBOOK if spell.id=='magic_missile' else CardState.SPELLBOOK
    spell.is_facedown=spell.id!='magic_missile'
assert any(c.id=='cantrip' for c in hero.hand)
write('Gydion: Cantrip references prepared and cast spells',state,'Planning; Magic Missile cast in the previous round and still outside the book; other referenced cantrips remain private/prepared. Inspect Cantrip; no cast is pending or answered.')
state=GameSetup.create_game(str(resolve_map_path('forgotten_island')),['Ursafar','Hanu'],['Arien','Brogan'],False,'LONG',seed=20261024)
hero=state.get_hero('hero_ursafar')
state.pending_upgrades[str(hero.id)]=6
upgrade_history=[]
for _ in range(6):
    options=ResolveUpgradesStep()._get_upgrade_options(state,str(hero.id))
    assert options
    chosen=options[0]['pair'][0]
    apply_hero_upgrade(state,str(hero.id),chosen)
    upgrade_history.append(chosen)
assert not state.pending_upgrades
hero.level=8
state.round=5
UnboundFuryEffect().on_ultimate_unlocked(state,hero)
# Resolve an ordinary card earlier in this round. The registered ultimate makes
# all resolved cards active; the passive Ultimate stays in its real separate slot.
source=hero.hand[0];hero.play_card(source);hero.current_turn_card.is_facedown=False;hero.resolve_current_card(turn_number=1)
state.turn=2
assert source.is_active and hero.ultimate_card.state==CardState.PASSIVE
write('Ursafar: unlocked Ultimate and active resolved history',state,'Level 8 Unbound Fury after six engine-offered upgrades: '+', '.join(upgrade_history)+'; mandatory paired items '+str({str(k):v for k,v in hero.items.items()})+'. Round 5; registered unlock hook; turn-1 resolved card remains active. Ultimate stays in its separate passive slot; availability is distinct from an active-effect flag.')
