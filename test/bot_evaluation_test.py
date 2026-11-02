"""Offline ranking contracts for the lab's small positioning bonuses."""
import copy
from pathlib import Path

import pytest
from automata.decision import DecisionDescriptor
from automata.search.contracts import SearchContext
from goa2.bootstrap import register_all_effects
from goa2.domain.models import CardColor, MinionType, TeamColor
from goa2.engine.setup import GameSetup
from bot_evaluation import LabLeafEvaluator, position_bonus


@pytest.fixture
def board():
    register_all_effects()
    maps = Path(__file__).parents[2] / "goa2-backend-bots/src/goa2/data/maps/forgotten_island.json"
    state = GameSetup.create_game(str(maps), ["Wasp"], ["Arien"], game_type="QUICK", seed=7)
    for team in state.teams.values():
        for unit in [*team.heroes, *team.minions]:
            state.remove_entity(str(unit.id))
    hero = state.teams[TeamColor.RED].heroes[0]
    hero.hand = [hero.hand[0].model_copy(update={"color": CardColor.RED, "range_value": 1, "played_this_round": False})]
    origin = next(h for h, tile in state.board.tiles.items() if not tile.is_obstacle and
                  any(n in state.board.tiles and not state.board.tiles[n].is_obstacle for n in h.neighbors()))
    near = next(n for n in origin.neighbors() if n in state.board.tiles and not state.board.tiles[n].is_obstacle)
    state.place_entity(str(hero.id), origin)
    return state, hero, origin, near


def test_setup_tiers_and_remaining_attack_card(board):
    state, hero, origin, near = board
    enemy = state.teams[TeamColor.BLUE]
    minion = enemy.minions[0]
    minion.type = MinionType.MELEE
    state.place_entity(str(minion.id), near)
    ready_minion = position_bonus(state, hero.id)
    hero.hand[0].played_this_round = True
    spent_minion = position_bonus(state, hero.id)
    state.remove_entity(str(minion.id))
    state.place_entity(str(enemy.heroes[0].id), near)
    hero_setup = position_bonus(state, hero.id)
    assert ready_minion == pytest.approx(0.12)
    assert hero_setup == pytest.approx(0.08)
    assert spent_minion == pytest.approx(0.04)
    assert ready_minion > hero_setup > spent_minion > 0


def test_printed_range_includes_boundary_and_excludes_one_hex_beyond(board):
    state, hero, origin, _ = board
    target = state.teams[TeamColor.BLUE].minions[0]
    target.type = MinionType.MELEE
    hero.hand[0].range_value = 3
    for distance, expected in [(3, 0.12), (4, 0.0)]:
        destination = next(h for h, tile in state.board.tiles.items() if origin.distance(h) == distance and not tile.is_obstacle)
        state.remove_entity(str(target.id))
        state.place_entity(str(target.id), destination)
        assert position_bonus(state, hero.id) == pytest.approx(expected)


@pytest.mark.parametrize("kind,expected", [(MinionType.MELEE,0.005),(MinionType.HEAVY,0.005),(MinionType.RANGED,0)])
def test_friendly_defense_cover_is_tiny_and_non_stacking(board, kind, expected):
    state, hero, origin, near = board
    allies = state.teams[hero.team].minions
    allies[0].type = kind
    state.place_entity(str(allies[0].id), near)
    assert position_bonus(state, hero.id) == pytest.approx(expected)
    if expected:
        other = next(n for n in origin.neighbors() if n != near and n in state.board.tiles and not state.board.tiles[n].is_obstacle)
        allies[1].type = kind
        state.place_entity(str(allies[1].id), other)
        assert position_bonus(state, hero.id) == pytest.approx(expected)


def test_enemy_ranged_exposure_only_within_two_hexes(board):
    state, hero, origin, _ = board
    enemy = state.teams[TeamColor.BLUE].minions[0]
    enemy.type = MinionType.RANGED
    hero.hand = []
    for distance, expected in [(2,-0.01),(3,0)]:
        destination = next(h for h, tile in state.board.tiles.items() if origin.distance(h) == distance and not tile.is_obstacle)
        state.remove_entity(str(enemy.id))
        state.place_entity(str(enemy.id), destination)
        assert position_bonus(state, hero.id) == pytest.approx(expected)


def test_kills_outvalue_best_setup_and_terminal_value_stays_exact(board):
    state, hero, _, near = board
    enemy = state.teams[TeamColor.BLUE]
    target = enemy.minions[0]
    target.type = MinionType.MELEE
    state.place_entity(str(target.id), near)
    context = SearchContext(hero.id, hero.team, hero.id, DecisionDescriptor("CARD"))
    evaluator = LabLeafEvaluator()
    setup = evaluator.evaluate(context,state).value
    killed = copy.deepcopy(state)
    killed.remove_entity(str(target.id))
    assert evaluator.evaluate(context,killed).value > setup
    hero_kill = copy.deepcopy(state)
    hero_kill.teams[TeamColor.BLUE].life_counters -= 1
    assert evaluator.evaluate(context,hero_kill).value > setup
    state.winner = hero.team
    assert evaluator.evaluate(context,state).value == 1


def test_scoring_ignores_hidden_enemy_cards_and_off_board_heroes(board):
    state, hero, _, near = board
    enemy = state.teams[TeamColor.BLUE].heroes[0]
    state.place_entity(str(enemy.id),near)
    before = position_bonus(state,hero.id)
    enemy.hand = []
    assert position_bonus(state,hero.id) == before
    state.remove_entity(str(hero.id))
    assert position_bonus(state,hero.id) == 0
