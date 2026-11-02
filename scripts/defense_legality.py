"""Legitimate card inventories and turn schedules for the defense display fixtures."""
from collections import Counter
from goa2.domain.models import ActionType,CardState,CardColor,StatType
from goa2.engine.steps.cards import ResolveUpgradesStep,apply_hero_upgrade
from goa2.engine.stats import get_computed_stat

ROUTES={
 'item-attack':{'arien':['expert_duelist']},
 'item-defense':{'brogan':['bolster']},
 'weakness':{'dodger':['weakness'],'arien':['rogue_wave']},
 'no-primary-defense':{'tigerclaw':['sidestep','pick_pocket','backstab','backstab_with_a_ballista']},
 'misa-defense':{'misa':['matter_of_honor']},
 'poison-defense':{'tigerclaw':['combat_reflexes','sidestep','poisoned_dagger','poisoned_dart']},
 'poison-attack':{'tigerclaw':['combat_reflexes','sidestep','poisoned_dagger','poisoned_dart']},
 'barrier-one':{'trinkets':['deployable_barrier']},
 'barrier-two':{'trinkets':['deployable_barrier']},
 'min-attack':{'min':['inner_strength','death_grenade']},
 'min-defense':{'min':['inner_strength','death_grenade']},
 'stone-carapace':{'mrak':['stone_carapace']},
}
PREVIOUS={'poison-defense','poison-attack','barrier-one','barrier-two','min-attack','min-defense','stone-carapace'}
RESERVE={'unstable_timeline','dodge','shield_of_decay','stone_carapace','fast_as_lightning'}
def heroes(state):return [h for t in state.teams.values() for h in t.heroes]
def prepare(state,key):
 history={}
 for short,route in ROUTES.get(key,{}).items():
  h=state.get_hero('hero_'+short);history[str(h.id)]=[]
  for cid in route:
   state.pending_upgrades[h.id]=1
   legal=ResolveUpgradesStep()._get_upgrade_options(state,str(h.id))
   assert cid in [x for o in legal for x in o['pair']],(key,h.id,cid,legal)
   before={c.id for c in h.deck if c.state==CardState.ITEM}
   h.level+=1;apply_hero_upgrade(state,str(h.id),cid)
   added=[c.id for c in h.deck if c.state==CardState.ITEM and c.id not in before]
   history[str(h.id)].append({'level':h.level,'chosen':cid,'item':added[0]})
 # An upgraded inventory comes from an earlier round, after its mandatory purchases.
 state.round=2 if history else 1
 if history:
  for h in heroes(state):h.gold=1 if h.level==1 else 0
 # The recipe stores its audit separately, not in transient gameplay context.
 return history

def fixture_item(h,stat):
 cs=[c for c in h.deck if c.state==CardState.ITEM and c.item==stat]
 assert len(cs)==1,(h.id,stat,cs)
 return cs[0]

def initiative(state,h,c):return get_computed_stat(state,h.id,StatType.INITIATIVE,c.initiative)
def commit(h,c):
 h.hand.remove(c);c.state=CardState.UNRESOLVED;c.is_facedown=False;c.played_this_round=True;h.current_turn_card=c

def arrange(state,key,attacker,defender,keep=None):
 state.turn=2 if key in PREVIOUS else 1
 hs=heroes(state);reserved=set(RESERVE)|({keep} if keep else set())
 # Every hero has exactly one committed card per turn. Source cards already in
 # played_cards are placed by the recipe in their actual earlier/same-turn slot.
 earlier={str(h.id):list(h.played_cards) for h in hs}
 for h in hs:
  for c in h.played_cards:
   if c:c.played_this_round=True;c.is_facedown=False
  if state.turn==2 and not h.played_cards:
   choices=[c for c in h.hand if c.id not in reserved and ActionType.MOVEMENT in c.current_secondary_actions]
   if not choices:choices=[c for c in h.hand if c.id not in reserved]
   assert choices,(key,h.id,'previous turn card')
   # A secondary movement action supplies a harmless prior turn; it adds no
   # card-text effect. High initiative lets the slow source skill resolve last.
   c=max(choices,key=lambda c:initiative(state,h,c));pending=h.current_turn_card;commit(h,c);h.resolve_current_card(turn_number=1);h.current_turn_card=pending
  h.resolved_turn_count=len(h.played_cards)
  if h.current_turn_card:
   h.current_turn_card.played_this_round=True;h.current_turn_card.is_facedown=False
 # Put every roster hero on a real unoccupied map space, outside the local fight.
 occupied=set(state.entity_locations.values())
 target=state.get_position(defender.id)
 for h in hs:
  if h.id not in state.entity_locations:
   choices=[x for x,t in state.board.tiles.items() if not t.is_terrain and x not in occupied and target.distance(x)>=4]
   pos=min(choices,key=lambda x:(target.distance(x),x.q,x.r));state.entity_locations[h.id]=pos;occupied.add(pos)
 state.rebuild_occupancy_cache()
 atk_init=initiative(state,attacker,attacker.current_turn_card)
 order=[];remaining=[]
 for h in hs:
  already=state.turn==1 and bool(h.played_cards)
  if already:
   c=h.played_cards[-1];value=initiative(state,h,c)
   assert value>=atk_init,(key,h.id,c.id,value,'cannot precede attack',atk_init)
   order.append({'hero':str(h.id),'card':c.id,'initiative':value,'slot':state.turn,'status':'resolved'})
   continue
  if h is not attacker:
   choices=[c for c in h.hand if c.id not in reserved]
   assert choices,(key,h.id,'current turn card')
   # Prefer a lower-initiative commitment, leaving the pending defender's
   # special card in hand. If all remaining cards are faster, it has resolved.
   c=min(choices,key=lambda c:initiative(state,h,c));commit(h,c)
   if initiative(state,h,c)>atk_init:
    h.resolve_current_card(turn_number=state.turn)
    order.append({'hero':str(h.id),'card':c.id,'initiative':initiative(state,h,c),'slot':state.turn,'status':'resolved'})
    continue
   remaining.append(h.id)
  c=h.current_turn_card
  order.append({'hero':str(h.id),'card':c.id,'initiative':initiative(state,h,c),'slot':state.turn,'status':'acting' if h is attacker else 'unresolved'})
 state.current_actor_id=attacker.id;state.resolution_owner_id=attacker.id;state.unresolved_hero_ids=remaining
 # Keep the effect's genuine creation turn: all lasting effects were established
 # in turn 1, while THIS_TURN buffs are used only in turn 1.
 for e in state.active_effects:
  assert e.created_at_round==state.round
  assert e.created_at_turn==1
 audit(state,key,attacker)
 return {'round':state.round,'turn':state.turn,'current_order':sorted(order,key=lambda r:-r['initiative']),
         'prior_turn_actions':[{'hero':str(h.id),'card':h.played_cards[0].id,'action':'source primary action' if earlier[str(h.id)] else 'secondary Movement','slot':1} for h in hs] if state.turn==2 else []}

def audit(state,key,attacker):
 for h in heroes(state):
  items=[c for c in h.deck if c.state==CardState.ITEM]
  assert h.level==1+len(items),(key,h.id,h.level,items)
  assert dict(Counter(c.item for c in items if c.item))=={k:v for k,v in h.items.items() if v},(key,h.id,'item totals')
  zones=[*h.hand,*h.discard_pile,*[c for c in h.played_cards if c]]+([h.current_turn_card] if h.current_turn_card else [])
  ids=[c.id for c in zones];assert len(ids)==len(set(ids)),(key,h.id,'duplicate zones')
  assert all(c.state==CardState.HAND for c in h.hand)
  assert all(c.state==CardState.RESOLVED for c in h.played_cards if c)
  assert h.current_turn_card is None or h.current_turn_card.state==CardState.UNRESOLVED
  assert len(h.played_cards)<=state.turn
  assert h.resolved_turn_count==len(h.played_cards)
  for color in [CardColor.RED,CardColor.BLUE,CardColor.GREEN]:
   live=[c for c in h.deck if c.color==color and c.state in (CardState.HAND,CardState.RESOLVED,CardState.UNRESOLVED,CardState.DISCARD)]
   assert len(live)==1,(key,h.id,color,[(c.id,c.state) for c in live])
  if h.current_turn_card and h is not attacker:
   assert h.id in state.unresolved_hero_ids
   assert initiative(state,h,h.current_turn_card)<=initiative(state,attacker,attacker.current_turn_card)
 assert state.resolution_owner_id==attacker.id
