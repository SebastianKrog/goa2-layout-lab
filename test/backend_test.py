"""Run using the sibling backend's uv environment; no production files edited."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import sys
import shutil
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


class SituationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.old_environ = dict(os.environ)
        cls.old_time, cls.old_ns = time.time, time.time_ns
        os.environ.update(
            GOA2_LAB_DATA=cls.temp.name,
            GOA2_LAB_TOKEN="test-lab-secret",
            GOA2_PREWARM_WORKERS="0",
            GOA2_VERIFY_REPLAYS="0",
        )
        for env, sub in [
            ("GOA2_SAVE_DIR", "games"),
            ("GOA2_REPLAY_DIR", "replays"),
            ("GOA2_LOG_DIR", "logs"),
            ("GOA2_BUG_REPORT_DIR", "reports"),
            ("GOA2_SHARE_DIR", "shares"),
        ]:
            os.environ[env] = str(Path(cls.temp.name) / sub)
        spec = importlib.util.spec_from_file_location(
            "lab_backend", Path(__file__).parents[1] / "src/backend.py"
        )
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        from fastapi.testclient import TestClient
        from goa2.server import time_control

        cls.old_schedule = time_control.schedule_deadline

        from situations import SituationStore

        cls.library = Path(cls.temp.name) / "library"
        shutil.copytree(Path(__file__).parents[1] / "library/situations", cls.library)
        shutil.copytree(Path(__file__).parents[1] / "library/decision-states", Path(cls.temp.name) / "decision-states")
        with patch(
            "situations.SituationStore",
            side_effect=lambda shared, data: SituationStore(cls.library, data),
        ):
            cls.client = TestClient(cls.module.create_app())
        cls.client.__enter__()
        cls.headers = {"x-lab-token": "test-lab-secret"}

    def test_tags_roundtrip_through_capture_export_and_import_without_changing_checkpoint(self):
        original = self.client.get("/__lab/situations/e81bc3bd5fff", headers=self.headers).json()
        imported = self.client.post("/__lab/import", headers=self.headers, json={"content": original}).json()
        result = self.client.post("/__lab/tags", headers=self.headers, json={
            "kind":"situation", "id":imported["id"], "tags":["QA", "custom moment"]})
        self.assertEqual(result.status_code, 200, result.text)
        result = self.client.post("/__lab/tags", headers=self.headers, json={
            "kind":"decision-state", "id":imported["decisionStateId"], "origin":"local", "tags":["Phase:Planning"]})
        self.assertEqual(result.status_code, 200, result.text)
        exported = self.client.get("/__lab/situations/" + imported["id"], headers=self.headers).json()
        self.assertEqual(exported["tags"], ["custom-moment","qa"])
        self.assertEqual(exported["decisionStateTags"], ["hero:arien", "hero:brogan", "hero:hanu", "hero:tigerclaw", "phase:planning"])
        self.assertEqual(exported["checkpoint"], original["checkpoint"])
        again = self.client.post("/__lab/import", headers=self.headers, json={"content":exported}).json()
        self.assertEqual(again["tags"], exported["tags"])
        self.assertEqual(again["decisionStateTags"], exported["decisionStateTags"])
        self.assertEqual(again["decisionStateId"], exported["decisionStateId"])
        self.assertEqual(again["description"], exported["description"])
        invalid = self.client.post("/__lab/tags", headers=self.headers, json={"kind":"situation","id":again["id"],"tags":["../bad"]})
        self.assertEqual(invalid.status_code, 422)

    def test_roster_metadata_is_small_and_excludes_checkpoint(self):
        response = self.client.get("/__lab/situations/a00000000001?metadata=true", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        value = response.json()
        self.assertNotIn("checkpoint", value)
        self.assertLess(len(response.content), 4096)
        self.assertEqual({seat["id"] for seat in value["seats"]}, {"hero_arien", "hero_hanu", "hero_brogan", "hero_tigerclaw"})
        self.assertIn("botKinds", value)
        self.assertIn("botKinds", self.client.get("/__lab/capabilities", headers=self.headers).json())

    def test_read_frozen_review_snapshot_never_recreates_missing_input(self):
        spec = {"reviewId": "f" * 24, "index": 0}
        response = self.client.post("/__lab/review/snapshot", headers=self.headers,
            json={**spec, "id": "e81bc3bd5fff"})
        self.assertEqual(response.status_code, 200, response.text)
        frozen = response.json()
        url = "/__lab/review/snapshot?reviewId=" + spec["reviewId"] + "&index=0"
        self.assertEqual(self.client.get(url, headers=self.headers).json(), frozen)
        missing = url.replace("index=0", "index=1")
        self.assertEqual(self.client.get(missing, headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get(url.replace(spec["reviewId"], "bad"), headers=self.headers).status_code, 422)

    def test_composed_situations_share_exact_decision_state_and_keep_presentations_separate(self):
        original = self.client.get("/__lab/situations/e81bc3bd5fff", headers=self.headers).json()
        one = self.client.post("/__lab/import", headers=self.headers, json={"content": original, "name":"Composed source"}).json()
        self.assertEqual(one["schema"], 3)
        state_id = one["decisionStateId"]
        moment = {"schema":2,"viewpoint":"spectator","sessionState":{"pane":"heroes","selectedCard":None},"userState":{"goa2:board-brightness":"0.4"}}
        response = self.client.post("/__lab/situations/compose",headers=self.headers,json={"name":"Same decision","decisionStateId":state_id})
        self.assertEqual(response.status_code,200,response.text)
        two = response.json()
        self.assertNotEqual(two["id"],one["id"])
        self.assertEqual(two["decisionStateId"],one["decisionStateId"])
        self.assertNotIn("presentation",two)
        rejected = self.client.post("/__lab/situations/compose",headers=self.headers,json={"name":"UI belongs to inspection","decisionStateId":state_id,"presentation":moment})
        self.assertEqual(rejected.status_code,422)
        clone = self.client.post("/__lab/clone",headers=self.headers,json={"decision_state_id":state_id}).json()
        checkpoint = self.client.get("/__lab/games/"+clone["game_id"]+"/checkpoint",headers=self.headers).json()
        self.assertEqual(json.loads(checkpoint["checkpoint_json"]),checkpoint["situation"]["checkpoint"])
        captured = self.client.post("/__lab/capture",headers=self.headers,json={"game_id":clone["game_id"],"name":"Game only","kind":"decision-state"})
        self.assertEqual(captured.status_code,200,captured.text)
        self.assertEqual(captured.json()["kind"],"decision-state")
        self.assertTrue(any(d["id"]==captured.json()["id"] for d in self.client.get("/__lab/decision-states",headers=self.headers).json()))
        invalid = self.client.post("/__lab/situations/compose",headers=self.headers,json={"decisionStateId":"../bad"})
        self.assertEqual(invalid.status_code,422)

    def test_pending_defense_presentations_reuse_the_exact_existing_decision_state(self):
        original=self.client.get("/__lab/situations/2b928b7b0ab4",headers=self.headers).json()
        ids=[]
        for pane in ["hand","heroes"]:
            response=self.client.post("/__lab/situations/compose",headers=self.headers,json={"name":"Defense "+pane,"decisionStateId":original["decisionStateId"]})
            self.assertEqual(response.status_code,200,response.text)
            created=response.json()
            self.assertEqual(created["decisionStateId"],original["decisionStateId"])
            self.assertEqual(created["checkpoint"],original["checkpoint"])
            ids.append(created["id"])
        self.assertNotEqual(*ids)

    def test_single_situation_lookup_returns_only_requested_checkpoint(self):
        response = self.client.get("/__lab/situations/e81bc3bd5fff", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "e81bc3bd5fff")
        self.assertIn("checkpoint", response.json())
        self.assertEqual(self.client.get("/__lab/situations/missing", headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get("/__lab/situations/e81bc3bd5fff").status_code, 403)

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        time.time, time.time_ns = cls.old_time, cls.old_ns
        from goa2.server import time_control

        time_control.schedule_deadline = cls.old_schedule
        os.environ.clear()
        os.environ.update(cls.old_environ)
        import logging

        logging.shutdown()  # Release per-game file handlers before Windows temp cleanup.
        cls.temp.cleanup()

    def post(self, path, body):
        response = self.client.post("/__lab" + path, json=body, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_restart_skips_old_clones_and_preserves_recovery_saves(self):
        from fastapi.testclient import TestClient

        save = Path(os.environ["GOA2_SAVE_DIR"]) / "old-clone.json"
        save.parent.mkdir(parents=True, exist_ok=True)
        save.write_text('{"old": "recovery save"}')
        before = save.read_bytes()
        with patch("goa2.server.registry.GameRegistry.restore_all", side_effect=AssertionError("restored old clones")):
            with TestClient(self.module.create_app()) as client:
                self.assertEqual(client.app.state.registry._games, {})
                self.assertEqual(client.get("/__lab/health", headers=self.headers).status_code, 200)
        self.assertEqual(save.read_bytes(), before)

    def test_metadata_catalog_omits_checkpoints_without_changing_full_exports(self):
        full = self.client.get("/__lab/situations", headers=self.headers).json()
        light = self.client.get("/__lab/situations?metadata=true", headers=self.headers).json()
        self.assertEqual(len(full), len(light))
        self.assertEqual([{k:v for k,v in entry.items() if k != "seats"} for entry in light], [{k: v for k, v in entry.items() if k != "checkpoint"} for entry in full])
        self.assertTrue(all("checkpoint" in entry for entry in full))
        self.assertLess(len(json.dumps(light)), len(json.dumps(full)) // 5)

    def test_shared_library_clones_and_local_promotion(self):
        listing = self.client.get("/__lab/situations", headers=self.headers).json()
        bundled = [s for s in listing if s["origin"] == "library"]
        self.assertEqual(len(bundled), len(list(self.library.rglob("*.json"))))
        self.assertGreaterEqual(len(bundled), 2)
        for situation in bundled:
            cloned = self.post("/clone", {"situation_id": situation["id"]})
            self.assertEqual(cloned["summary"], situation["summary"])
            contract = (
                situation.get("provenance", {}).get("fixture", {}).get("condition")
            )
            if contract:
                self.assertEqual(cloned["summary"]["phase"], contract["phase"])
                self.assertEqual(cloned["summary"]["decision"], contract["decision"])
        local = self.post("/starter", {"name": "Defense UI draft"})
        self.assertEqual(local["origin"], "local")
        moved = self.post(
            "/organize", {"id": local["id"], "group": "cards/defense", "shared": False}
        )
        shared = self.post(
            "/organize", {"id": moved["id"], "group": "cards/defense", "shared": True}
        )
        self.assertNotEqual(shared["id"], local["id"])
        self.assertTrue(
            (self.library / "cards/defense" / (shared["id"] + ".json")).exists()
        )
        self.assertEqual(
            self.post("/clone", {"situation_id": shared["id"]})["hash"],
            self.post("/clone", {"situation_id": local["id"]})["hash"],
        )
        rejected = self.client.post(
            "/__lab/organize",
            headers=self.headers,
            json={"id": local["id"], "group": "../outside", "shared": True},
        )
        self.assertEqual(rejected.status_code, 400)
        # Keep this test independent of ordering in the shared test class.
        (self.library / "cards/defense" / (shared["id"] + ".json")).unlink()

    def test_clone_independence_capture_and_no_source_credentials(self):
        situation = self.post("/starter", {})
        a = self.post("/clone", {"situation_id": situation["id"]})
        b = self.post("/clone", {"situation_id": situation["id"]})
        self.assertNotEqual(a["game_id"], b["game_id"])
        self.assertNotEqual(a["seats"]["hero_arien"], b["seats"]["hero_arien"])
        self.assertEqual(a["hash"], b["hash"])
        game = self.client.app.state.registry.get(a["game_id"])
        hero = next(
            h
            for team in game.session.state.teams.values()
            for h in team.heroes
            if h.id == "hero_arien"
        )
        hero.gold += 1
        captured = self.post("/capture", {"game_id": a["game_id"], "name": "One gold"})
        data = json.dumps(captured)
        self.assertNotIn(a["spectator_token"], data)
        self.assertNotIn(a["seats"]["hero_arien"], data)
        c = self.post("/clone", {"situation_id": captured["id"]})
        self.assertNotEqual(c["hash"], b["hash"])
        reset = self.post("/clone", {"situation_id": situation["id"]})
        self.assertEqual(reset["hash"], b["hash"])
        imported = self.post("/import", {"content": captured})
        self.assertEqual(
            imported["checkpoint"]["state"], captured["checkpoint"]["state"]
        )

    def test_inline_clone_uses_current_checkpoint_without_saving_a_situation(self):
        original = self.post("/starter", {})
        source = self.post("/clone", {"situation_id": original["id"]})
        game = self.client.app.state.registry.get(source["game_id"])
        hero = next(h for team in game.session.state.teams.values() for h in team.heroes if h.id == "hero_arien")
        hero.gold += 1
        before = len(self.client.get("/__lab/situations", headers=self.headers).json())
        snapshot = self.client.get(f"/__lab/games/{source['game_id']}/checkpoint", headers=self.headers).json()
        added = self.post("/clone", {"situation": snapshot["situation"]})
        self.assertEqual(added["hash"], snapshot["hash"])
        self.assertNotEqual(added["hash"], source["hash"])
        self.assertNotEqual(added["game_id"], source["game_id"])
        self.assertEqual(len(self.client.get("/__lab/situations", headers=self.headers).json()), before)

    def test_timed_state_is_frozen_and_protected(self):
        self.assertEqual(self.client.get("/__lab/situations").status_code, 403)
        situation = self.post("/starter", {"timed": True})
        clone = self.post("/clone", {"situation_id": situation["id"]})
        game = self.client.app.state.registry.get(clone["game_id"])
        from goa2.server.time_control import set_player_ready

        for hero in clone["seats"]:
            set_player_ready(game, hero, True, self.module.FROZEN_MS)
        self.assertEqual(game.session.state.clock.status.value, "RUNNING")
        saved = self.post(
            "/capture", {"game_id": clone["game_id"], "name": "Running frozen"}
        )
        one = self.post("/clone", {"situation_id": saved["id"]})
        time.sleep(0.05)
        two = self.post("/clone", {"situation_id": saved["id"]})
        self.assertEqual(one["hash"], two["hash"])
        self.assertIsNone(game.timer_task)
        self.assertEqual(time.time_ns(), self.module.FROZEN_MS * 1_000_000)

    def test_invalid_schema_and_state_fail_clearly(self):
        response = self.client.post(
            "/__lab/import",
            json={"content": {"schema": 99, "checkpoint": {}}},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("schema", response.text)
        response = self.client.post(
            "/__lab/import", json={"content": {"state": {}}}, headers=self.headers
        )
        self.assertEqual(response.status_code, 422)

    def test_real_actions_pending_decision_restore_and_replay_import(self):
        situation = self.post("/starter", {})
        one = self.post("/clone", {"situation_id": situation["id"]})
        two = self.post("/clone", {"situation_id": situation["id"]})
        registry = self.client.app.state.registry
        game = registry.get(one["game_id"])
        for team in game.session.state.teams.values():
            for hero in team.heroes:
                response = self.client.post(
                    f"/games/{game.game_id}/cards",
                    json={"card_id": hero.hand[0].id},
                    headers={"Authorization": "Bearer " + one["seats"][hero.id]},
                )
                self.assertEqual(response.status_code, 200, response.text)
        for hero_id, token in one["seats"].items():
            self.client.post(
                f"/games/{game.game_id}/planning-done",
                json={},
                headers={"Authorization": "Bearer " + token},
            )
        self.assertNotEqual(
            self.module.canonical_hash(game.session.state.model_dump(mode="json")),
            two["hash"],
        )
        saved = self.post(
            "/capture", {"game_id": game.game_id, "name": "Actual decision"}
        )
        restored = self.post("/clone", {"situation_id": saved["id"]})
        expected = game.last_result.input_request if game.last_result else None
        actual_game = registry.get(restored["game_id"])
        actual = (
            actual_game.last_result.input_request if actual_game.last_result else None
        )
        self.assertIsNotNone(expected)
        self.assertIsNotNone(actual)
        self.assertEqual(expected.request_type, actual.request_type)
        self.assertEqual(expected.player_id, actual.player_id)
        self.assertEqual(
            self.module.canonical_hash(game.session.state.model_dump(mode="json")),
            restored["hash"],
        )
        records = saved["checkpoint"]["replay_log"]
        self.assertGreater(len(records), 1)
        imported = self.post(
            "/import",
            {
                "kind": "replay",
                "decision": 0,
                "content": "\n".join(json.dumps(r) for r in records),
            },
        )
        replay_clone = self.post("/clone", {"situation_id": imported["id"]})
        self.assertEqual(replay_clone["hash"], two["hash"])
        decision = self.post(
            "/import",
            {
                "kind": "replay",
                "decision": len(records) - 1,
                "content": "\n".join(json.dumps(r) for r in records),
            },
        )
        at_decision = self.post("/clone", {"situation_id": decision["id"]})
        replay_game = registry.get(at_decision["game_id"])
        self.assertEqual(at_decision["hash"], restored["hash"])
        self.assertEqual(
            replay_game.last_result.input_request.request_type, expected.request_type
        )
        self.assertEqual(
            replay_game.last_result.input_request.player_id, expected.player_id
        )





    def test_reconnect_gets_initial_state_when_previous_transport_already_closed(self):
        source = self.post("/starter", {"name": "Reconnect test"})
        clone = self.post("/clone", {"situation_id": source["id"]})
        game = self.client.app.state.registry.get(clone["game_id"])
        token = clone["seats"]["hero_arien"]
        address = f"/games/{game.game_id}/ws?token={token}"
        with self.client.websocket_connect(address) as first:
            self.assertEqual(first.receive_json()["type"], "STATE_UPDATE")
            previous = game.ws_connections[token]
        async def already_closed(message):
            raise RuntimeError("Unexpected ASGI message 'websocket.close', after sending 'websocket.close' or response already completed.")
        previous._send = already_closed
        game.ws_connections[token] = previous
        with self.client.websocket_connect(address) as replacement:
            self.assertEqual(replacement.receive_json()["type"], "STATE_UPDATE")
            self.assertIsNot(game.ws_connections[token], previous)




    def test_autoswitch_responders_follow_real_commits_and_request_owners(self):
        from types import SimpleNamespace
        from goa2.domain.models import GamePhase
        source = self.post("/starter", {})
        clone = self.post("/clone", {"situation_id": source["id"]})
        game = self.client.app.state.registry.get(clone["game_id"])
        route = f"/__lab/games/{game.game_id}/responders"
        def players():
            return self.client.get(route, headers=self.headers).json()["players"]
        self.assertEqual(set(players()), set(clone["seats"]))
        arien = game.session.state.get_hero("hero_arien")
        response = self.client.post(f"/games/{game.game_id}/cards", json={"card_id": arien.hand[0].id}, headers={"Authorization": "Bearer " + clone["seats"]["hero_arien"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("hero_arien", players())
        self.assertIn("hero_hanu", players())
        saved_result = game.last_result
        def request(owner, kind="SELECT_OPTION", context=None):
            game.last_result = SimpleNamespace(input_request=SimpleNamespace(player_id=owner, request_type=SimpleNamespace(value=kind), context=context or {}))
        request("hero_brogan")
        self.assertEqual(players(), ["hero_brogan"], "Follow the responder, not current actor")
        team = next(iter(game.session.state.teams.values()))
        request("team:" + team.color.value)
        self.assertEqual(set(players()), {str(h.id) for h in team.heroes})
        request("simultaneous", "UPGRADE_PHASE", {"players": {"hero_arien": {"remaining": 0}, "hero_hanu": {"remaining": 1}}})
        self.assertEqual(players(), ["hero_hanu"])
        request("unknown")
        self.assertEqual(players(), [])
        game.last_result = saved_result
        self.assertEqual(self.client.get(route).status_code, 403)



    def test_game_backend_never_accepts_autonomous_bot_configuration(self):
        source = self.post("/starter", {})
        response = self.client.post("/__lab/clone", headers=self.headers, json={"situation_id":source["id"],"bots":{"hero_hanu":"random"}})
        self.assertEqual(response.status_code,422)
        clone=self.post("/clone",{"situation_id":source["id"]})
        game=self.client.app.state.registry.get(clone["game_id"])
        self.assertFalse(getattr(game,"bot_specs",{}))
        self.assertIsNone(getattr(game,"bot_task",None))
        self.assertEqual(self.client.get("/__lab/capabilities",headers=self.headers).json()["botKinds"],[])

    def test_bot_state_is_transient_and_stale_decisions_do_not_mutate_games(self):
        source=self.post("/starter",{})
        clones=[self.post("/clone",{"situation_id":source["id"]}) for _ in range(2)]
        games=[self.client.app.state.registry.get(c["game_id"]) for c in clones]
        state_files=list(Path(os.environ["GOA2_LAB_DATA"]).rglob("decision-states/*.json"))
        snapshot=self.client.get(f"/__lab/games/{clones[0]['game_id']}/bot-state",headers=self.headers).json()
        self.assertEqual(snapshot["hash"],clones[0]["hash"])
        self.assertEqual(list(Path(os.environ["GOA2_LAB_DATA"]).rglob("decision-states/*.json")),state_files)
        hero=games[0].session.state.get_hero("hero_arien")
        command={"games":[c["game_id"] for c in clones],"source":clones[0]["game_id"],"actor":"hero_arien","expectedHash":snapshot["hash"],"message":{"type":"COMMIT_CARD","card_id":hero.hand[0].id}}
        self.post("/synchronize",command)
        hashes=[self.module.canonical_hash(g.session.state.model_dump(mode="json")) for g in games]
        self.assertEqual(hashes[0],hashes[1])
        rejected=self.client.post("/__lab/synchronize",headers=self.headers,json=command)
        self.assertEqual(rejected.status_code,409)
        self.assertIn("stale",rejected.text)
        self.assertEqual(hashes,[self.module.canonical_hash(g.session.state.model_dump(mode="json")) for g in games])
        # The same command route works with a single independent/device game.
        other=self.post("/clone",{"situation_id":source["id"]})
        command.update(games=[other["game_id"]],source=other["game_id"])
        self.post("/synchronize",command)

    def test_device_clone_from_opaque_checkpoint_preserves_large_engine_integers(self):
        source = self.post("/starter", {})
        clone = self.post("/clone", {"situation_id": source["id"]})
        game = self.client.app.state.registry.get(clone["game_id"])
        game.session.state.rng_seed = 2**64 - 1
        snapshot = self.client.get(f"/__lab/games/{clone['game_id']}/bot-state", headers=self.headers).json()
        self.assertNotIn("checkpoint", snapshot)
        self.assertEqual(json.loads(snapshot["checkpoint_json"])["state"]["rng_seed"], 2**64 - 1)
        # Node forwards string contents unchanged even though its parsed metadata can be rounded.
        copied = self.post("/clone", {"situation_id": source["id"], "checkpoint_json": snapshot["checkpoint_json"]})
        self.assertEqual(copied["hash"], snapshot["hash"])
        self.assertEqual(self.client.app.state.registry.get(copied["game_id"]).session.state.rng_seed, 2**64 - 1)

    def test_element_report_checkpoint_is_read_only_resumable_and_has_no_credentials(self):
        source = self.post("/starter", {})
        clone = self.post("/clone", {"situation_id": source["id"]})
        before = self.client.get("/__lab/situations?metadata=true", headers=self.headers).json()
        route = f"/__lab/games/{clone['game_id']}/checkpoint"
        self.assertEqual(self.client.get(route).status_code, 403)
        response = self.client.get(route, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        captured = response.json()
        self.assertEqual(captured["hash"], clone["hash"])
        self.assertEqual(self.client.get("/__lab/situations?metadata=true", headers=self.headers).json(), before)
        payload = json.dumps(captured)
        for credential in [*clone["seats"].values(), clone["spectator_token"]]:
            self.assertNotIn(credential, payload)
        imported = self.post("/import", {"content": captured["situation"]})
        restored = self.post("/clone", {"situation_id": imported["id"]})
        self.assertEqual(restored["hash"], clone["hash"])


    def test_review_snapshots_keep_exact_engine_integers_and_validate_references(self):
        situation = self.client.get("/__lab/situations/e81bc3bd5fff", headers=self.headers).json()
        hero = situation["checkpoint"]["state"]["teams"]["RED"]["heroes"][0]
        hero["gold"] = 2 ** 60 + 3
        saved = self.post("/import", {"content": situation, "name": "Exact review snapshot"})
        spec = {"reviewId": "b" * 24, "index": 0}
        snapshot = self.post("/review/snapshot", {"id": saved["id"], **spec})
        self.assertEqual(snapshot["review_snapshot"], spec)
        clone = self.post("/clone", {"review_snapshot": spec, "situation": {"checkpoint": {}}})
        game = self.client.app.state.registry.get(clone["game_id"])
        from goa2.domain.models.enums import TeamColor
        self.assertEqual(game.session.state.teams[TeamColor.RED].heroes[0].gold, 2 ** 60 + 3)
        snapshot_file = Path(self.temp.name) / "reports" / "reviews" / spec["reviewId"] / "situations" / "000.json"
        exact = json.loads(snapshot_file.read_text(encoding="utf-8"))
        self.assertEqual(exact["checkpoint"]["state"]["teams"]["RED"]["heroes"][0]["gold"], 2 ** 60 + 3)
        for bad in [{"reviewId": "../escape", "index": 0}, {"reviewId": "a" * 24, "index": -1}, "bad"]:
            response = self.client.post("/__lab/clone", json={"review_snapshot": bad}, headers=self.headers)
            self.assertEqual(response.status_code, 422)

    def test_review_rerun_copies_snapshot_without_refreshing_the_library(self):
        spec = {"reviewId": "c" * 24, "index": 0}
        first = self.post("/review/snapshot", {"id": "e81bc3bd5fff", **spec})
        source = Path(self.temp.name) / "reports" / "reviews" / spec["reviewId"] / "situations" / "000.json"
        original = source.read_bytes()
        rerun_spec = {"reviewId": "d" * 24, "index": 1}
        # The source snapshot is sufficient even if the library entry changes or disappears.
        from situations import SituationStore
        with patch.object(SituationStore, "read", side_effect=AssertionError("Do not reread library")):
            rerun = self.post("/review/snapshot", {"id": first["id"], "from": spec, **rerun_spec})
        self.assertEqual(rerun["checkpoint"], first["checkpoint"])
        self.assertEqual(rerun["review_snapshot"], rerun_spec)
        self.assertEqual(source.read_bytes(), original)
        clone = self.post("/clone", {"review_snapshot": rerun_spec})
        self.assertTrue(clone["game_id"])
        response = self.client.post("/__lab/review/snapshot", json={"id": first["id"], "from": {"reviewId": "../bad", "index": 0}, "reviewId": "e" * 24, "index": 0}, headers=self.headers)
        self.assertEqual(response.status_code, 422)

    def test_device_reports_are_grouped_under_validated_review_folder(self):
        import base64
        clone = self.post("/clone", {"situation_id": "e81bc3bd5fff"})
        review_id = "a" * 24
        review = {"id": review_id, "index": 1, "situationId": "e81bc3bd5fff"}
        captured = self.post("/device/capture", {
            "game_id": clone["game_id"], "provenance": {"review": review, "session": {"id": "b" * 24, "name": "Phone review", "startedAt": "2026-10-22T10:00:00Z"}},
            "presentation": {"pane": "heroes"}, "viewport": {"width": 378, "height": 781},
        })
        png = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode()
        body = {"id": captured["id"], "game_id": clone["game_id"], "comment": "Review <script>test</script>", "screenshot": png}
        result = self.post("/device/report", body)
        relative = f"reviews/{review_id}/reports/device/{captured['id']}"
        self.assertEqual(result["report"], f"/reports/{relative}/index.html")
        folder = Path(self.temp.name) / "reports" / relative
        report = json.loads((folder / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["review"], review)
        self.assertEqual(report["session"]["name"], "Phone review")
        self.assertIn("T", report["capturedAt"])
        self.assertIn("report-captured-time", (folder / "index.html").read_text(encoding="utf-8"))
        self.assertIn("&lt;script&gt;", (folder / "index.html").read_text(encoding="utf-8"))
        situation = json.loads((folder / "situation.json").read_text(encoding="utf-8"))
        self.assertEqual(situation["provenance"]["report"], relative)
        self.assertEqual(self.post("/device/report", body), result)
        bad = self.post("/device/capture", {"game_id": clone["game_id"], "provenance": {"review": {"id": "../../escape"}}})
        response = self.client.post("/__lab/device/report", json={**body, "id": bad["id"]}, headers=self.headers)
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
