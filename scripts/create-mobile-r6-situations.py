"""R6 full-map UI checkpoints using registered cards, real casts and expiry."""
import importlib.util, json, os, sys
from pathlib import Path
LAB=Path(__file__).resolve().parents[1]
BACKEND=Path(os.environ.get("GOA2_LAB_BACKEND",LAB.parent/"goa2-backend"))
sys.path[:0]=[str(BACKEND/"src"),str(LAB/"src")]
from goa2.bootstrap import register_all_effects
from goa2.engine.setup import GameSetup
from goa2.engine.session import GameSession
from goa2.server.map_paths import resolve_map_path
from goa2.domain.models import GamePhase, CardState, TeamColor
from goa2.domain.models.enums import RuneType
from goa2.domain.models.marker import MarkerType
from goa2.domain.models.effect import EffectType, EffectScope, Shape, DurationType
from goa2.domain.time_control import TimeControlConfig, ClockStatus
from goa2.domain.input import InputResponse
from goa2.engine.handler import push_steps
from goa2.engine.steps import ResolveUpgradesStep, ResolveCardStep, CastSpellStep
from goa2.engine.steps.cards import apply_hero_upgrade
from goa2.engine.effect_manager import EffectManager
spec=importlib.util.spec_from_file_location("r6_lab",LAB/"src/backend.py");lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
register_all_effects();out=LAB/".layout-lab/situation-recipes/mobile-r6";out.mkdir(parents=True,exist_ok=True)
def fresh(red=None,blue=None,timed=False):
 timing=TimeControlConfig(planning_allowance_seconds=120,resolution_allowance_seconds=90,response_grant_seconds=20,initial_time_bank_seconds=300,time_bank_increment_seconds=30,max_time_bank_seconds=600,upgrade_allowance_seconds=60,enforce_timeouts=False) if timed else None
 return GameSetup.create_game(str(resolve_map_path("forgotten_island")),red or ["Arien","Hanu"],blue or ["Brogan","Tigerclaw"],False,"LONG",seed=20261102,time_control=timing)
def write(slug,name,state,condition):
 names={str(h.id): f"Player {i+1}" for i,h in enumerate([h for t in state.teams.values() for h in t.heroes])}
 session,_=lab.restore(lab.checkpoint(GameSession(state),names=names));saved=lab.checkpoint(session,names=names);again,result=lab.restore(saved)
 assert lab.canonical_hash(saved["state"])==lab.canonical_hash(lab.checkpoint(again)["state"])
 payload=lab.portable_situation({"schema":lab.SCHEMA,"name":name,"checkpoint":saved,"provenance":{"kind":"ui-fabrication","seed":20261102,"fixture":{"factory":"scripts/create-mobile-r6-situations.py","condition":condition}}})
 (out/(slug+".json")).write_text(json.dumps(payload,indent=2),encoding="utf8");print(slug,"phase",state.phase,"request",result.input_request.request_type if result and result.input_request else None)
# One actual upgrade was accepted; peer still has a real pending offer.
state=fresh();state.phase=GamePhase.LEVEL_UP
for id in ["hero_arien","hero_hanu"]:state.get_hero(id).level=2
state.pending_upgrades={"hero_arien":1,"hero_hanu":1};push_steps(state,[ResolveUpgradesStep()]);session=GameSession(state);result=session.advance()
choice=result.input_request.context["players"][
"hero_arien"]["options"][0]["pair"][0]
session.advance(InputResponse(request_id=result.input_request.id,selection={"hero_id":"hero_arien","card_id":choice}))
write("mixed-upgrades","R6: one upgrade finished, peer pending",state,"Arien accepted a real upgrade; Hanu still pending. Public absence alone cannot prove entitlement/completion: unknown must stay neutral. Player names are display-fixture labels.")
state=fresh(["Snorri","Hanu"]);hero=state.get_hero("hero_snorri");hero.rune_slots={1:RuneType.BIRD,2:RuneType.AXE,3:RuneType.ANVIL,4:RuneType.HORN};hero.level=2;state.phase=GamePhase.LEVEL_UP;state.pending_upgrades={hero.id:1};push_steps(state,[ResolveUpgradesStep()]);GameSession(state).advance();write("snorri-level-up","R6: Snorri Level Up with retained runes",state,"Acknowledged slots retained from the prior round; no active rune during Level Up.")
# Timed real team tie: idle peers must show forecast rather than a dead countdown.
state=fresh(timed=True);state.clock.status=ClockStatus.RUNNING;state.tie_breaker_team=TeamColor.RED;session=GameSession(state)
for id,cid in [("hero_arien","spell_break"),("hero_hanu","fight_and_flight"),("hero_brogan","onslaught"),("hero_tigerclaw","blink_strike")]:
 hero=state.get_hero(id);result=session.commit_card(id,next(c for c in hero.hand if c.id==cid))
write("timed-tie","R6: timed team tie with idle peers",state,"Real equal-initiative team selection. Advisory clocks; nonrunning players retain useful forecast. No timeout actions.")
# Next-turn inversion supplied by an authentic card-bound effect, then normal commitments.
state=fresh(["Emmitt","Hanu"]);emmitt=state.get_hero("hero_emmitt");emmitt.level=8
state.pending_upgrades={emmitt.id:6};upgrade=ResolveUpgradesStep()
for _ in range(6):
 ids=[id for o in upgrade._get_upgrade_options(state,emmitt.id) for id in o["pair"]]
 apply_hero_upgrade(state,emmitt.id,"reverse_time" if "reverse_time" in ids else ids[0])
reverse=next(c for c in emmitt.hand if c.id=="reverse_time");emmitt.play_card(reverse);reverse.is_facedown=False;emmitt.resolve_current_card(turn_number=2)
state.turn=2;EffectManager.create_effect(state,source_id=emmitt.id,effect_type=EffectType.REVERSED_INITIATIVE,scope=EffectScope(shape=Shape.GLOBAL),duration=DurationType.NEXT_TURN,source_card_id=reverse.id,is_active=True)
state.turn=3;session=GameSession(state)
for team in state.teams.values():
 for hero in team.heroes:
  c=hero.hand[0] if hero.id==emmitt.id else next(c for c in hero.hand if c.id in ["fight_and_flight","onslaught","blink_strike"])
  result=session.commit_card(hero.id,c)
if state.phase==GamePhase.PLANNING: session.finish_planning(emmitt.id)
assert state.phase==GamePhase.RESOLUTION
write("reverse-time","R6: reversed initiative with team tie",state,"Card-bound Reverse Time from the preceding turn, normal engine resolution queue. Ascending initiative must remain authoritative.")
# Acquired abjuration path, including all obligatory paired items.
def gydion():
 state=fresh(["Gydion","Hanu"]);hero=state.get_hero("hero_gydion");hero.level=7;state.round=4;state.pending_upgrades={hero.id:6};step=ResolveUpgradesStep()
 for _ in range(6):
  options=step._get_upgrade_options(state,hero.id);ids=[id for o in options for id in o["pair"]];cid=next((id for id in ["lesser_abjuration","greater_abjuration"] if id in ids),ids[0]);apply_hero_upgrade(state,hero.id,cid)
 for spell in hero.spells: spell.state=CardState.SPELLBOOK;spell.is_facedown=True
 state.phase=GamePhase.RESOLUTION;state.current_actor_id=hero.id;state.unresolved_hero_ids=[]
 return state,hero
def cast(state,hero,spell_id,turn):
 state.turn=turn;state.current_actor_id=hero.id;push_steps(state,[CastSpellStep(allowed_spell_ids=[spell_id],caster_id=hero.id)]);session=GameSession(state);result=session.advance()
 result=session.advance(InputResponse(request_id=result.input_request.id,selection=spell_id))
 assert any(e.event_type.value=="SPELL_CAST" for e in result.events)
 result=session.advance(InputResponse(request_id=result.input_request.id,selection="SKILL"))
 if result.input_request and any(getattr(o,"id",o)=="CONFIRM" for o in result.input_request.options):result=session.advance(InputResponse(request_id=result.input_request.id,selection="CONFIRM"))
 assert any(e.source_card_id==spell_id and e.is_active for e in state.active_effects)
state,hero=gydion();cast(state,hero,"shield",1);cast(state,hero,"invulnerability",2);state.turn=3
state.place_marker(MarkerType.BOUNTY,hero.id,1,"hero_brogan");state.place_marker(MarkerType.POISON,hero.id,-1,"hero_brogan")
write("gydion-active","R6: Shield and Invulnerability active with markers",state,"Two real registered casts create independent card-bound effects; acquired tier prerequisites and paired items. Three indicator types permit crowded/normal variants. Turn 3 in the same round.")
EffectManager.expire_effects(state,DurationType.THIS_ROUND)
write("gydion-expired","R6: Shield and Invulnerability expired",state,"Matching spell history after real EffectManager round-duration expiry; no fabricated active flag. Public rows can remain but have no live glow.")
state,hero=gydion();state.turn=2;push_steps(state,[CastSpellStep(allowed_spell_ids=["shield"],caster_id=hero.id)]);result=GameSession(state).advance();assert result.input_request
write("spell-event","R6: Gydion prepared Shield awaiting explicit cast",state,"Real CastSpellStep waits at scoped SELECT_CARD. On disposable review clones select and Confirm choice to emit SPELL_CAST, then inspect the mobile notification. No synthetic socket events.")
