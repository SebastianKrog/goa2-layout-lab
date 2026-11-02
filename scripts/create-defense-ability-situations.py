from __future__ import annotations
import importlib.util,json,sys
from pathlib import Path
LAB=Path(__file__).resolve().parents[1];OUT=LAB/'.layout-lab/situation-recipes/defense-abilities';OUT.mkdir(parents=True,exist_ok=True)
sys.path[:0]=[str(LAB.parent/'goa2-backend/src'),str(LAB/'src')]
from goa2.bootstrap import register_all_effects
from goa2.domain.models import ActionType,CardState,GamePhase,StatType,TokenType
from goa2.domain.input import InputRequestType,InputResponse
from goa2.engine.effects import CardEffectRegistry
from goa2.engine.handler import push_steps
from goa2.engine.session import GameSession
from goa2.engine.setup import GameSetup
from goa2.engine.steps import AttackSequenceStep,CreateEffectStep,PlaceMarkerStep
from goa2.engine.stats import compute_card_stats,get_computed_stat
from goa2.server.map_paths import resolve_map_path
spec=importlib.util.spec_from_file_location('ability_lab',LAB/'src/backend.py');lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
sys.path.insert(0,str(LAB/'scripts'))
from defense_legality import prepare,arrange,audit,fixture_item
register_all_effects()
CASES=[
 ('item-attack','Arien','Brogan','Hanu','Tigerclaw','Noble Blade with a +1 Attack item'),
 ('item-defense','Arien','Brogan','Hanu','Tigerclaw','Brogan defending with a +1 Defense item'),
 ('weakness','Arien','Brogan','Hanu','Dodger','Dodger Weakness reduces Rogue Wave to zero Attack'),
 ('no-primary-defense','Tigerclaw','Emmitt','Hanu','Brogan','Flanking Ballista prevents primary defense actions'),
 ('misa-defense','Arien','Misa','Hanu','Tigerclaw','Misa defending with Matter of Honor active'),
 ('poison-defense','Arien','Brogan','Hanu','Tigerclaw','Poison marker reduces Brogan Defense by two'),
 ('poison-attack','Arien','Brogan','Hanu','Tigerclaw','Poison marker reduces Noble Blade Attack by two'),
 ('barrier-one','Arien','Brogan','Hanu','Trinkets','Brogan adjacent to one friendly Barrier token'),
 ('barrier-two','Arien','Brogan','Hanu','Trinkets','Brogan adjacent to two friendly Barrier tokens'),
 ('min-attack','Min','Brogan','Hanu','Tigerclaw','Min attacking with Inner Strength and doubled items'),
 ('min-defense','Arien','Min','Hanu','Tigerclaw','Min defending with Inner Strength and doubled items'),
 ('stone-carapace','Arien','Mrak','Hanu','Tigerclaw','Mrak can defend with resolved Stone Carapace'),
 ('temporal-punch','Emmitt','Brogan','Hanu','Tigerclaw','Temporal Punch uses Initiative to defend'),
]
def find(hero,id):return next(c for c in hero.deck if c.id==id)
def zone(hero,card,where):
 for seq in [hero.hand,hero.played_cards,hero.discard_pile]:
  if card in seq:seq.remove(card)
 if hero.current_turn_card is card:hero.current_turn_card=None
 card.is_facedown=False
 if where=='played':card.state=CardState.RESOLVED;hero.played_cards.append(card)
 elif where=='current':card.state=CardState.UNRESOLVED;hero.current_turn_card=card
 elif where=='hand':card.state=CardState.HAND;hero.hand.append(card)
 elif where=='item':card.state=CardState.ITEM;hero.items[card.item]=hero.items.get(card.item,0)+1;hero.level=max(hero.level,1+sum(hero.items.values()))
 return card
def item(hero,stat):return fixture_item(hero,stat)

def set_actor(state,hero,action):
 state.current_actor_id=hero.id
 state.execution_context={'current_action_type':action,'action_type_stack':[]}
def effect_steps(state,hero,card):return CardEffectRegistry.get_for_card(card).get_steps(state,hero,card)
def run_setup(state,hero,card,steps):
 set_actor(state,hero,card.current_primary_action);state.execution_context['current_card_id']=card.id
 push_steps(state,steps);res=GameSession(state).advance()
 assert res.input_request is None,(card.id,res.input_request)
 state.execution_stack.clear()
def activate(state,hero,id):
 card=zone(hero,find(hero,id),'played')
 run_setup(state,hero,card,[s for s in effect_steps(state,hero,card) if isinstance(s,CreateEffectStep)])
 assert any(e.source_card_id==id for e in state.active_effects)
 return card
manifest=[]
for key,an,dn,ra,ba,name in CASES:
 state=GameSetup.create_game(str(resolve_map_path('forgotten_island')),[an,ra],[dn,ba],False,'LONG',seed=20261023)
 upgrades=prepare(state,key)
 state.phase=GamePhase.RESOLUTION;state.unresolved_hero_ids=[]
 attacker=state.get_hero('hero_'+an.lower());defender=state.get_hero('hero_'+dn.lower())
 state.entity_locations.clear();state.rebuild_occupancy_cache()
 floor=sorted((h for h,t in state.board.tiles.items() if not t.is_terrain),key=lambda h:(abs(h.q)+abs(h.r)+abs(h.s),h.q,h.r))
 center=next(h for h in floor if len([n for n in h.neighbors() if n in floor])==6)
 near=[h for h in floor if h.distance(center)==1];far=[h for h in floor if h.distance(center)==2]
 state.entity_locations[defender.id]=center;state.entity_locations[attacker.id]=near[0]
 notes=[];selected=None
 if key=='item-attack':notes.append('Attack item: '+item(attacker,StatType.ATTACK).id)
 if key=='item-defense':notes.append('Defense item: '+item(defender,StatType.DEFENSE).id)
 if key=='weakness':
  dodger=state.get_hero('hero_dodger');state.entity_locations[dodger.id]=near[1];activate(state,dodger,'weakness')
  assert get_computed_stat(state,attacker.id,StatType.ATTACK,4)==0
 if key=='misa-defense':activate(state,defender,'matter_of_honor')
 if key.startswith('poison-'):
  tiger=state.get_hero('hero_tigerclaw');card=zone(tiger,find(tiger,'poisoned_dart'),'played')
  target=attacker if key=='poison-attack' else defender
  steps=[s for s in effect_steps(state,tiger,card) if isinstance(s,PlaceMarkerStep)]
  set_actor(state,tiger,ActionType.SKILL);state.execution_context['poison_target']=str(target.id)
  push_steps(state,steps);res=GameSession(state).advance();assert res.input_request is None
  notes.append('Poisoned Dart marker -2 on '+target.name)
 if key.startswith('min-'):
  minh=attacker if key=='min-attack' else defender
  notes.extend(['Attack item: '+item(minh,StatType.ATTACK).id,'Defense item: '+item(minh,StatType.DEFENSE).id])
  activate(state,minh,'inner_strength')
  assert get_computed_stat(state,minh.id,StatType.ATTACK,0)==2
  assert get_computed_stat(state,minh.id,StatType.DEFENSE,0)==2
 if key.startswith('barrier-'):
  tr=state.get_hero('hero_trinkets');state.entity_locations[tr.id]=near[3]
  # Real turret and registered deployable-barrier placements on this full map.
  # Use the actual registered turret ID for card placement constraints.
  from goa2.scripts.trinkets_effects import TURRET_ID
  turret_id=TURRET_ID
  state.entity_locations[turret_id]=near[2]
  state.rebuild_occupancy_cache()
  card=zone(tr,find(tr,'deployable_barrier'),'played');set_actor(state,tr,ActionType.SKILL)
  push_steps(state,effect_steps(state,tr,card));session=GameSession(state);res=session.advance()
  count=1 if key=='barrier-one' else 2
  chosen=[]
  for i in range(count):
   req=res.input_request;assert req.request_type==InputRequestType.SELECT_HEX
   candidates=[o['metadata'].get('raw') for o in req.model_dump(mode='json')['options'] if isinstance(o['metadata'].get('raw'),dict)]
   assert candidates,req.model_dump(mode='json')
   pos=next((p for p in candidates if center.distance(type(center)(**p))==1),None)
   assert pos,(center,near,req.model_dump(mode='json'))
   chosen.append(pos);res=session.advance(InputResponse(request_id=req.id,selection=pos))
  if res.input_request:
   res=session.advance(InputResponse(request_id=res.input_request.id,selection='SKIP'))
  assert res.input_request is None
  assert get_computed_stat(state,defender.id,StatType.DEFENSE,0)==count
  notes.append(str(count)+' adjacent friendly barrier aura(s) from real card placement')
 if key=='stone-carapace':activate(state,defender,'stone_carapace');selected='stone_carapace'
 # Make all newly assigned locations authoritative before positional stat computation.
 state.rebuild_occupancy_cache()
 if key=='no-primary-defense':
  ally=state.get_hero('hero_hanu');state.entity_locations[ally.id]=near[1];state.rebuild_occupancy_cache()
  attack=zone(attacker,find(attacker,'backstab_with_a_ballista'),'current')
 elif key=='temporal-punch':attack=zone(attacker,find(attacker,'temporal_punch'),'current')
 elif key=='weakness':attack=zone(attacker,find(attacker,'rogue_wave'),'current')
 elif key=='misa-defense':attack=zone(attacker,find(attacker,'dangerous_current'),'current')
 elif key=='min-attack':attack=zone(attacker,next(c for c in attacker.hand if c.primary_action==ActionType.ATTACK),'current')
 else:attack=zone(attacker,find(attacker,'noble_blade'),'current')
 set_actor(state,attacker,ActionType.ATTACK);state.execution_context.update(current_card_id=attack.id,victim_id=str(defender.id))
 timeline=arrange(state,key,attacker,defender,selected)
 if key in ('no-primary-defense','temporal-punch'):
  steps=effect_steps(state,attacker,attack)
 else:
  stats=compute_card_stats(state,attacker.id,attack)
  steps=[AttackSequenceStep(damage=stats.primary_value,range_val=stats.range if attack.is_ranged else 1,is_ranged=bool(attack.is_ranged),target_id_key='victim_id')]
 push_steps(state,steps);session=GameSession(state);res=session.advance()
 if res.input_request and res.input_request.request_type==InputRequestType.SELECT_UNIT:
  req=res.input_request;res=session.advance(InputResponse(request_id=req.id,selection=str(defender.id)))
 req=res.input_request
 assert req and req.request_type==InputRequestType.SELECT_CARD_OR_PASS,(key,req)
 assert req.player_id==defender.id
 if key=='no-primary-defense':
  assert state.execution_context['block_primary_defense'] is True
  assert 'unstable_timeline' not in [o.id for o in req.options]
 if key=='stone-carapace':assert 'stone_carapace' in [o.id for o in req.options] and find(defender,'stone_carapace') not in defender.hand
 if key=='temporal-punch':assert state.execution_context['defense_uses_initiative'] and all('Init:' in o.text for o in req.options if o.id!='PASS')
 expected={'item-attack':5,'weakness':0,'poison-attack':2,'temporal-punch':9,'no-primary-defense':7}
 if key in expected:assert req.context['attack_value']==expected[key],(key,req.context)
 bonuses={'item-defense':1,'misa-defense':4,'poison-defense':-2,'barrier-one':1,'barrier-two':2,'min-defense':2}
 if key in bonuses:
  for o in req.options:
   if o.id!='PASS':assert o.metadata['defense_value']-o.metadata['base_defense']==bonuses[key],(key,o)
 audit(state,key,attacker)
 saved=lab.checkpoint(session);restored,res2=lab.restore(saved);norm=lab.checkpoint(restored);again,res3=lab.restore(norm)
 assert res3.input_request.request_type==req.request_type and res3.input_request.player_id==defender.id
 assert lab.canonical_hash(norm['state'])==lab.canonical_hash(lab.checkpoint(again)['state'])
 notes.append('Levels: '+', '.join(h.name+' '+str(h.level) for t in state.teams.values() for h in t.heroes))
 if key=='misa-defense':notes.append('Matter of Honor +3 Defense plus the mandatory paired Power Shot +1 Defense item; attack resolves at Initiative 8 after Misa at 9.')
 desc=f"{name}. Attack {req.context['attack_value']}; defense needed {req.context['defense_needed']}. Waiting for {defender.name}; no defense submitted. "+'; '.join(notes)
 payload={'schema':lab.SCHEMA,'name':name,'description':desc,'checkpoint':norm,'tags':['topic:defense','topic:cards'],'provenance':{'kind':'ui-fabrication','seed':20261023,'condition':key,'setup':'Legal upgrade transitions, explicit turn-slot schedule, real effect and attack steps.','upgrade_history':upgrades,'timeline':timeline}}
 dest=OUT/(key+'.json');dest.write_text(json.dumps(lab.portable_situation(payload),indent=2)+'\n',encoding='utf-8')
 manifest.append({'key':key,'file':str(dest.relative_to(LAB)).replace('\\','/'),'name':name,'description':desc,'seat':str(defender.id),'selected':selected,'attack':req.context['attack_value'],'needed':req.context['defense_needed'],'options':[o.model_dump(mode='json') for o in req.options]})
 print(key,desc)
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
