"""Run in the bots checkout environment; the game backend does not import bots."""
import copy
import json
from pathlib import Path
from unittest.mock import patch
import pytest
from bot_decisions import choose

@pytest.fixture
def body():
    root=Path(__file__).parents[1]
    situation=json.loads((root/"library/situations/planning/a00000000001.json").read_text())
    state=json.loads((root/"library/decision-states"/(situation["decisionStateId"]+".json")).read_text())["checkpoint"]
    return {"checkpoint":state,"result":None,"hash":"test","seed":"fixed","bots":{"hero_brogan":"heuristic","hero_tigerclaw":"heuristic"}}

def test_each_policy_returns_one_command_without_mutating_checkpoint_or_using_neural_modules(body):
    import builtins
    original=builtins.__import__
    def classic_only(name,*a,**kw):
        if name=="torch" or name.startswith(("torch.","automata.models.shared_encoder","automata.training")):
            raise AssertionError("Neural/training import: "+name)
        return original(name,*a,**kw)
    for kind in ("random","heuristic","ismcts"):
        body["bots"]={"hero_brogan":kind}
        saved=copy.deepcopy(body)
        with patch("builtins.__import__",new=classic_only):
            decision=choose(body)["decision"]
        assert decision["actor"]=="hero_brogan"
        assert decision["message"]["type"]=="COMMIT_CARD"
        assert body==saved

def test_human_only_and_invalid_policies(body):
    body["bots"]={}
    assert choose(body)=={"decision":None}
    for policies in ({"hero_brogan":"learned"},{"missing":"random"}):
        body["bots"]=policies
        with pytest.raises(ValueError):choose(body)

def test_bot_service_requires_private_token(body,monkeypatch):
    from fastapi.testclient import TestClient
    from bot_decisions import create_app
    monkeypatch.setenv("GOA2_LAB_TOKEN","private")
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code==403
        assert client.post("/decision",json=body).status_code==403
        assert client.get("/health",headers={"x-lab-token":"private"}).json()["botKinds"]==["random","heuristic","ismcts"]
        assert client.post("/decision",json=body,headers={"x-lab-token":"private"}).status_code==422
        wire={**body, "checkpoint_json":json.dumps(body["checkpoint"]), "result_json":json.dumps(body["result"])}
        response=client.post("/decision",json=wire,headers={"x-lab-token":"private"})
        assert response.status_code==200
        assert response.json()["decision"]["actor"]=="hero_brogan"

@pytest.mark.parametrize("fixture,owner",[
    ("heroes/snorri/0601f17bbdab.json","hero_snorri"),
    ("resolution/ties/50205badf8ea.json","team:RED"),
])
def test_input_commands_preserve_selections_and_human_team_ownership(fixture,owner):
    from backend import restore, checkpoint
    from automata.runtime.driver import eligible_hero_ids_for_request
    root=Path(__file__).parents[1]
    situation=json.loads((root/"library/situations"/fixture).read_text())
    saved=json.loads((root/"library/decision-states"/(situation["decisionStateId"]+".json")).read_text())["checkpoint"]
    session,result=restore(saved)
    assert result.input_request.player_id==owner
    eligible=eligible_hero_ids_for_request(session.state,result.input_request)
    body={"checkpoint":checkpoint(session),"result":result.model_dump(mode="json"),"hash":"input","bots":{h:"heuristic" for h in eligible}}
    before=copy.deepcopy(body)
    answer=choose(body)["decision"]
    assert answer["message"]["type"]=="SUBMIT_INPUT"
    assert answer["actor"] in eligible
    assert "selection" in answer["message"]
    assert "request_id" not in answer["message"]  # Live backends remap their own opaque prompt IDs.
    assert body==before
    if owner.startswith("team:"):
        body["bots"]={eligible[0]:"heuristic"}
        assert choose(body)["decision"] is None


def test_opaque_wire_checkpoint_is_decoded_without_rounding(body):
    body["checkpoint"]["state"]["rng_seed"] = 2**64 - 1
    wire = {"checkpoint_json": json.dumps(body["checkpoint"]), "result_json": "null",
            "hash": body["hash"], "bots": body["bots"]}
    seen = []
    def inspect(state, agents, result):
        seen.append(state.rng_seed)
        return None
    with patch("automata.runtime.driver.inspect_next_decision", side_effect=inspect):
        assert choose(wire)["decision"] is None
    assert seen == [2**64 - 1]


def test_lab_ismcts_uses_ten_seconds_and_two_game_turns(body):
    from goa2.server.bot_factory import agent_for_spec
    from goa2.server.bot_models import SearchSettings
    seen = []
    def build(spec, **kwargs):
        if spec.kind == "ismcts":
            from automata.search.contracts import CutoffUnit
            assert kwargs["cutoff_unit"] is CutoffUnit.TURNS
            assert kwargs["leaf_evaluator"].recipe_id == "lab-attack-range-v1"
            seen.append(spec.search)
        return agent_for_spec(spec, **kwargs)
    body["bots"] = {"hero_brogan": "ismcts"}
    with patch("goa2.server.bot_factory.agent_for_spec", side_effect=build), patch(
        "automata.runtime.driver.inspect_next_decision", return_value=None
    ):
        choose(body)
    assert len(seen) == 1
    assert seen[0].decision_timeout_seconds == 10.0
    defaults = SearchSettings().model_dump()
    defaults["decision_timeout_seconds"] = 10.0
    defaults["leaf_mode"] = "bounded_continuation"
    assert seen[0].model_dump() == defaults
    assert SearchSettings().decision_timeout_seconds == 2.0


def test_cold_bot_process_loads_card_effects_before_search(body):
    import subprocess
    import sys
    script = """
import json, sys
from goa2.engine.effects import CardEffectRegistry
assert CardEffectRegistry.get('onslaught') is None
from bot_decisions import choose
body = json.load(sys.stdin)
body['bots'] = {}
choose(body)
assert CardEffectRegistry.get('onslaught') is not None
assert CardEffectRegistry.get('blink_strike') is not None
"""
    completed = subprocess.run([sys.executable, "-c", script], input=json.dumps(body),
                               text=True, capture_output=True, timeout=30)
    assert completed.returncode == 0, completed.stderr
