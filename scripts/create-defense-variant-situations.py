from __future__ import annotations
import argparse, importlib.util, json, sys
from pathlib import Path
LAB=Path(__file__).resolve().parents[1]
OUT=LAB/'.layout-lab/situation-recipes/defense-variants';OUT.mkdir(parents=True,exist_ok=True)
a=argparse.ArgumentParser(); a.add_argument("--backend",type=Path,default=LAB.parent/"goa2-backend"); args=a.parse_args()
sys.path[:0]=[str(args.backend/"src"),str(LAB/"src")]
from goa2.bootstrap import register_all_effects
from goa2.domain.models import ActionType, CardState, GamePhase, MinionType, TeamColor
from goa2.domain.factory import EntityFactory
from goa2.domain.input import InputRequestType
from goa2.engine.handler import push_steps
from goa2.engine.session import GameSession
from goa2.engine.setup import GameSetup
from goa2.engine.steps import AttackSequenceStep
from goa2.engine.stats import calculate_minion_defense_modifier
from goa2.server.map_paths import resolve_map_path
from goa2.scripts.dodger_effects import _count_empty_spawn_points
spec=importlib.util.spec_from_file_location("defense_fixture_lab",LAB/"src/backend.py"); lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
sys.path.insert(0,str(LAB/'scripts'))
from defense_legality import prepare,arrange,audit
register_all_effects()
SEED=20261023
# team relative to the BLUE defender, minion type, distance
cases=[
 ("no-minions","Brogan - no minion modifier","Brogan",[],0,None),
 ("friendly-melee","Brogan - friendly melee support","Brogan",[("BLUE","MELEE",1)],1,None),
 ("friendly-heavy","Brogan - friendly heavy support","Brogan",[("BLUE","HEAVY",1)],1,None),
 ("friendly-ranged","Brogan - friendly ranged does not support defense","Brogan",[("BLUE","RANGED",1)],0,None),
 ("enemy-melee","Brogan - enemy melee pressure","Brogan",[("RED","MELEE",1)],-1,None),
 ("enemy-heavy","Brogan - enemy heavy pressure","Brogan",[("RED","HEAVY",1)],-1,None),
 ("enemy-ranged","Brogan - enemy ranged pressure at two spaces","Brogan",[("RED","RANGED",2)],-1,None),
 ("mixed-minions","Brogan - mixed minion pressure","Brogan",[("BLUE","MELEE",1),("RED","MELEE",1),("RED","HEAVY",1),("RED","RANGED",2)],-2,None),
 ("defense-skill","Emmitt - numeric Defense Skill against an attack","Emmitt",[],0,"unstable_timeline"),
 ("block-skill","Tigerclaw - Dodge against a ranged attack","Tigerclaw",[("RED","RANGED",2)],-1,"dodge"),
 ("plus-skill","Dodger - Shield of Decay with its bonus available","Dodger",[],0,"shield_of_decay"),
]
manifest=[]
for key,name,defender_name,minions,expected,selected in cases:
 blue=[defender_name,"Brogan" if defender_name=="Tigerclaw" else "Tigerclaw"]
 state=GameSetup.create_game(str(resolve_map_path("forgotten_island")),["Arien","Hanu"],blue,False,"LONG",seed=SEED)
 upgrades=prepare(state,key)
 defender=state.get_hero("hero_"+defender_name.lower()); ranged=key=="block-skill"
 attacker=state.get_hero("hero_hanu" if ranged else "hero_arien")
 played=next(c for c in attacker.hand if c.id==("helping_hand" if ranged else "noble_blade"))
 attacker.hand.remove(played);played.state=CardState.UNRESOLVED;played.is_facedown=False;attacker.current_turn_card=played
 # Fresh fixture: keep original reserves, remove all board pieces, then arrange only participants.
 state.entity_locations.clear(); state.rebuild_occupancy_cache()
 floor=sorted((h for h,t in state.board.tiles.items() if not t.is_terrain),key=lambda h:(abs(h.q)+abs(h.r)+abs(h.s),h.q,h.r))
 center=next(h for h in floor if len([n for n in h.neighbors() if n in state.board.tiles and not state.board.tiles[n].is_terrain])>=5 and len([n for n in floor if h.distance(n)==2])>=4)
 if key=="plus-skill":
  center=None
  for h in floor:
   state.entity_locations[defender.id]=h;state.rebuild_occupancy_cache()
   if _count_empty_spawn_points(state,str(defender.id),2)>=2 and any(n in state.board.tiles and not state.board.tiles[n].is_terrain for n in h.neighbors()):center=h;break
  assert center is not None,"No actual spawn-point bonus position"
 state.entity_locations[defender.id]=center
 distance=2 if ranged else 1
 attack_hex=next(h for h in floor if h.distance(center)==distance and not state.board.tiles[h].spawn_point)
 state.entity_locations[attacker.id]=attack_hex
 used={center,attack_hex}; placements=[]
 for team,kind,distance in minions:
  h=next(h for h in floor if center.distance(h)==distance and h not in used)
  m=EntityFactory.create_minion(state,TeamColor(team),MinionType(kind));state.register_entity(m,"minion");state.entity_locations[m.id]=h;used.add(h)
  placements.append({"id":str(m.id),"team":team,"type":kind,"distance":distance,"hex":h.model_dump()})
 state.rebuild_occupancy_cache()
 actual=calculate_minion_defense_modifier(state,defender.id);assert actual==expected,(key,actual)
 state.phase=GamePhase.RESOLUTION;state.current_actor_id=attacker.id;state.unresolved_hero_ids=[]
 state.execution_context.update(current_action_type=ActionType.ATTACK,action_type_stack=[],victim_id=str(defender.id))
 timeline=arrange(state,key,attacker,defender,selected)
 damage=played.primary_action_value
 push_steps(state,[AttackSequenceStep(damage=damage,range_val=played.range_value if ranged else 1,is_ranged=ranged,target_id_key="victim_id")])
 session=GameSession(state);result=session.advance();request=result.input_request
 assert request and request.request_type==InputRequestType.SELECT_CARD_OR_PASS,(key,request)
 assert request.player_id==defender.id
 assert request.context["minion_modifier"]==expected
 assert request.context["defense_needed"]==damage-expected
 audit(state,key,attacker)
 saved=lab.checkpoint(session); restored,r=lab.restore(saved);normalized=lab.checkpoint(restored);again,r2=lab.restore(normalized)
 assert lab.canonical_hash(normalized["state"])==lab.canonical_hash(lab.checkpoint(again)["state"])
 assert r2.input_request.player_id==defender.id
 bonus_spawns=_count_empty_spawn_points(state,str(defender.id),2) if key=="plus-skill" else None
 desc=f"Attack {damage}; minion modifier {actual:+d}; defense needed {damage-actual}. Waiting for {defender_name}; no defense submitted."
 if selected: desc+=f" Inspect {selected}."
 if bonus_spawns is not None: assert bonus_spawns>=2;desc+=f" {bonus_spawns} empty battle-zone spawn points in radius 2; printed 3+ can gain its card-text bonus."
 payload={"schema":lab.SCHEMA,"name":name,"description":desc,"checkpoint":normalized,"tags":["topic:defense","topic:cards"],"provenance":{"kind":"ui-fabrication","seed":SEED,"condition":key,"minions":placements,"upgrade_history":upgrades,"timeline":timeline}}
 dest=OUT/(key+".json");dest.write_text(json.dumps(lab.portable_situation(payload),indent=2)+"\n",encoding="utf-8")
 manifest.append({"key":key,"file":str(dest.relative_to(LAB)).replace("\\","/"),"name":name,"description":desc,"seat":str(defender.id),"selected":selected,"attack":damage,"minionModifier":actual,"needed":damage-actual,"placements":placements})
 print(key,desc)
(OUT/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
