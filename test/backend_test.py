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

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


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
            "lab_backend", Path(__file__).parents[1] / "backend.py"
        )
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        from fastapi.testclient import TestClient
        from goa2.server import time_control

        cls.old_schedule = time_control.schedule_deadline

        from situations import SituationStore

        cls.library = Path(cls.temp.name) / "library"
        shutil.copytree(Path(__file__).parents[1] / "situations", cls.library)
        with patch(
            "situations.SituationStore",
            side_effect=lambda shared, data: SituationStore(cls.library, data),
        ):
            cls.client = TestClient(cls.module.create_app())
        cls.client.__enter__()
        cls.headers = {"x-lab-token": "test-lab-secret"}

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
        self.assertEqual(light, [{k: v for k, v in entry.items() if k != "checkpoint"} for entry in full])
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


if __name__ == "__main__":
    unittest.main()


    def test_device_bot_clone_drives_other_heroes_and_keeps_the_human_manual(self):
        from device_bots import bot_kinds
        if not bot_kinds():
            self.skipTest("Bots checkout not selected")
        source = self.post("/starter", {"name": "Bot planning test"})
        original = source["checkpoint"]
        for kind in ("random", "heuristic"):
            specs = {hero: kind for hero in ("hero_hanu", "hero_brogan", "hero_tigerclaw")}
            clone = self.post("/clone", {"situation_id": source["id"], "human_seat": "hero_arien", "bots": specs})
            game = self.client.app.state.registry.get(clone["game_id"])
            deadline = time.monotonic() + 10
            while not set(specs).issubset(game.session.state.pending_inputs):
                self.assertLess(time.monotonic(), deadline, "Other heroes did not commit")
                time.sleep(0.02)
            self.assertNotIn("hero_arien", game.session.state.pending_inputs)
            self.assertEqual({h: spec.kind for h, spec in game.bot_specs.items()}, specs)
            save = Path(os.environ["GOA2_SAVE_DIR"]) / f"{game.game_id}.json"
            self.post("/device/stop", {"game_id": game.game_id})
            self.assertTrue(game.removed)
            self.assertTrue(game.bot_task is None or game.bot_task.done())
            self.assertTrue(save.exists(), "Stopping keeps recovery saves")
        unchanged = self.client.get(f"/__lab/situations/{source['id']}", headers=self.headers).json()
        self.assertEqual(unchanged["checkpoint"], original)

    def test_device_bot_choices_reject_human_unknown_heroes_and_search_agents(self):
        source = self.post("/starter", {"name": "Bot validation test"})
        for values in ({"hero_arien": "random"}, {"missing": "random"}, {"hero_hanu": "ismcts"}, []):
            response = self.client.post("/__lab/clone", headers=self.headers, json={"situation_id": source["id"], "human_seat": "hero_arien", "bots": values})
            self.assertEqual(response.status_code, 422, response.text)
        with patch("device_bots.bot_kinds", return_value=[]):
            response = self.client.post("/__lab/clone", headers=self.headers, json={"situation_id": source["id"], "human_seat": "hero_arien", "bots": {"hero_hanu": "random"}})
            self.assertEqual(response.status_code, 422)
            self.post("/clone", {"situation_id": source["id"]})

    def test_timed_device_clone_readies_bots_and_waits_for_the_human(self):
        from device_bots import bot_kinds
        if not bot_kinds():
            self.skipTest("Bots checkout not selected")
        source = self.post("/starter", {"name": "Timed bots", "timed": True})
        specs = {hero: "random" for hero in ("hero_hanu", "hero_brogan", "hero_tigerclaw")}
        clone = self.post("/clone", {"situation_id": source["id"], "human_seat": "hero_arien", "bots": specs})
        game = self.client.app.state.registry.get(clone["game_id"])
        self.assertEqual(set(game.session.state.clock.ready_hero_ids), set(specs))
        self.assertEqual(game.session.state.clock.status.value, "WAITING_FOR_PLAYERS")
        self.assertFalse(game.session.state.pending_inputs)
        self.post("/device/stop", {"game_id": game.game_id})


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
