"""Lab-only short-horizon positioning preferences; no hidden enemy cards."""
from __future__ import annotations

import math

from automata.search.contracts import LeafEvaluation
from automata.search.heuristic import HeuristicLeafEvaluator
from goa2.domain.models import CardColor, MinionType
from goa2.domain.types import HeroID


def position_bonus(state, hero_id: str) -> float:
    hero = state.get_hero(HeroID(hero_id))
    positions = state.get_positions(hero_id)
    if hero is None or hero.team is None or not positions:
        return 0.0
    remaining = [card for card in hero.hand if not card.played_this_round]
    attack_cards = [card for card in remaining if card.color in (CardColor.GOLD, CardColor.RED)]
    # Printed range only: no targeting validation, buffs, topology, or special effects.
    attack_range = max((card.range_value or 1 for card in attack_cards), default=1)

    def distance(unit):
        targets = state.get_positions(str(unit.id))
        return min((max(abs(a.q-b.q), abs(a.r-b.r), abs(a.s-b.s))
                    for a in positions for b in targets), default=math.inf)

    enemies = [team for color, team in state.teams.items() if color != hero.team]
    near_minion = any(distance(minion) <= attack_range for team in enemies for minion in team.minions)
    near_hero = any(distance(enemy) <= attack_range for team in enemies for enemy in team.heroes)
    setup = 0.12 if near_minion and attack_cards else 0.08 if near_hero else 0.04 if near_minion else 0.0
    friendly_cover = any(minion.type in (MinionType.MELEE, MinionType.HEAVY) and distance(minion) == 1
                         for minion in state.teams[hero.team].minions)
    ranged_exposure = any(minion.type == MinionType.RANGED and distance(minion) <= 2
                         for team in enemies for minion in team.minions)
    # Bounded, non-stacking preferences stay below the smallest minion kill's
    # 0.5 material gain and cannot overturn the three setup tiers on their own.
    return setup + 0.005 * friendly_cover - 0.01 * ranged_exposure


class LabLeafEvaluator(HeuristicLeafEvaluator):
    recipe_id = "lab-attack-range-v1"

    def evaluate(self, context, state):
        ordinary = super().evaluate(context, state)
        if state.winner is not None:
            return ordinary
        base = max(-1 + self._EPSILON, min(1 - self._EPSILON, ordinary.value))
        return LeafEvaluation(value=math.tanh(math.atanh(base) + position_bonus(state, context.root_viewer_id) / 5))
