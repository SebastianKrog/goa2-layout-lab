import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from state_model import decision_state, presentation, portable_situation, make_layout
from state_migration_legacy import compose_legacy
from situations import SituationStore
from migrate_state import StateMigration


class StateModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.shared = self.root / "situations"
        self.data = self.root / "data"
        self.shared.mkdir()
        self.data.mkdir()
        self.old = {"schema": 1, "id": "old123", "name": "Choose a card", "checkpoint": {
            "state": {"rng": 2**80 + 319, "ordered": [3, 1, 2]}, "rollback_snapshot": {"n": 2**63 + 7}},
            "summary": {"decision": "SELECT"}, "customUnknown": {"preserve": True},
            "provenance": {"slots": [{"source": "live", "layout": "mobile", "render": "2d", "seat": "hero_arien"},
                                       {"source": "comparator", "layout": "desktop", "render": "3d", "seat": "spectator"}]},
            "presentations": {"0": {"pane": "hand", "selectedCard": "card", "storage": {
                "goa2-mobile-display": "{\"cardArt\":false}", "goa2-token": "secret",
                "goa2-mobile-build:game": "plan"}}, "1": {"pane": "heroes"}}}

    def tearDown(self):
        self.temp.cleanup()

    def write_old(self, value=None, *, local=False):
        root = self.data / "situations" if local else self.shared
        path = root / "cards" / "old123.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value or self.old), encoding="utf-8")
        return path

    def test_variants_keep_identity_preferences_and_exact_checkpoint(self):
        state, variants, suggested, notes = compose_legacy(self.old)
        self.assertEqual(state["checkpoint"], self.old["checkpoint"])
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0]["id"], "old123")
        self.assertEqual(variants[0]["decisionStateId"], variants[1]["decisionStateId"])
        self.assertEqual(variants[0]["presentation"]["viewpoint"], "hero_arien")
        self.assertEqual(variants[1]["presentation"]["viewpoint"], "spectator")
        self.assertNotIn("goa2-token", variants[0]["presentation"]["userState"])
        self.assertIn("goa2-mobile-build:game", variants[0]["presentation"]["sessionState"]["storage"])
        self.assertEqual(suggested["views"][0]["uiMode"], "mobile")
        self.assertEqual(suggested["views"][0]["overrides"]["viewpoint"], "hero_arien")
        self.assertEqual(variants[0]["metadata"]["customUnknown"], {"preserve": True})
        self.assertNotIn("legacy", variants[0])
        self.assertTrue(any("Unsupported saved storage" in n for n in notes))
        self.assertEqual(compose_legacy(self.old)[1], variants)
        self.assertNotEqual(decision_state({"state": {"ordered": [1, 2, 3]}})["id"], decision_state({"state": {"ordered": [3, 1, 2]}})["id"])

    def test_portable_factory_outputs_are_composed_and_keep_all_variants(self):
        bundle=portable_situation({"name": self.old["name"], "checkpoint": self.old["checkpoint"],
            "presentation": presentation({"pane": "hand"}, "hero_arien"),
            "provenance": {}, "suggestedLayout": make_layout([]),
            "additionalPresentations": [presentation({"pane": "heroes"}, "spectator")]})
        self.assertEqual(bundle["schema"],2)
        self.assertNotIn("checkpoint",bundle)
        self.assertNotIn("legacy",bundle)
        self.assertNotIn("slots",bundle["provenance"])
        self.assertEqual(bundle["decisionState"]["checkpoint"],self.old["checkpoint"])
        self.assertEqual(len(bundle["additionalSituations"]),1)
        self.assertEqual(bundle["additionalSituations"][0]["decisionStateId"],bundle["decisionStateId"])
        self.assertEqual(bundle["additionalSituations"][0]["presentation"]["viewpoint"],"spectator")
        self.assertEqual(bundle["suggestedLayout"]["kind"],"layout")

    def test_shared_presentation_contract(self):
        cases = json.loads((Path(__file__).parent / "presentation-contract.json").read_text())
        for case in cases:
            with self.subTest(case=case["name"]):
                if case.get("invalid"):
                    with self.assertRaises(ValueError):
                        presentation(case["input"])
                else:
                    self.assertEqual(presentation(case["input"]), case["expected"])
        self.assertIsNone(presentation({}, None)["viewpoint"])

    def test_migration_resolves_shared_decision_for_local_situation_without_mutation(self):
        state, variants, _, _ = compose_legacy(self.old)
        self.shared.parent.joinpath("decision-states").mkdir()
        SituationStore._write(self.shared.parent / "decision-states" / (state["id"] + ".json"), state)
        store = SituationStore(self.shared, self.data)
        store.save(variants[0])
        inventory, outputs = StateMigration(self.shared, self.data).inventory()
        self.assertEqual(inventory["errors"], [])
        self.assertEqual(outputs, {})
        self.assertFalse((self.data / "decision-states").exists())

    def test_factory_rejects_legacy_assembly(self):
        with self.assertRaises(ValueError):
            portable_situation(self.old)

    def test_game_only_defaults_do_not_invent_viewpoint(self):
        old = {k: v for k, v in self.old.items() if k not in {"presentations", "provenance"}}
        _, variants, suggested, _ = compose_legacy(old)
        self.assertNotIn("viewpoint", variants[0]["presentation"])
        self.assertEqual(variants[0]["presentation"]["sessionState"]["pane"], "board")
        self.assertIn("no historical", variants[0]["presentation"]["restoration"])
        self.assertIsNone(suggested)
        explicit = presentation({"schema": 2, "viewpoint": None, "sessionState": {"selectedCard": None}, "userState": {}})
        self.assertIsNone(explicit["viewpoint"])
        with self.assertRaises(ValueError):
            presentation({"schema": 2, "userState": {"goa2-token": "secret"}})

    def test_dry_run_apply_idempotence_and_lossless_rollback(self):
        oldfile = self.write_old()
        original = oldfile.read_bytes()
        (self.data / "presentations.json").write_text(json.dumps([{"id": "template1", "name": "Hand", "state": {"pane": "hand"}}]))
        (self.data / "presets.json").write_text(json.dumps({"Phone": self.old["provenance"]["slots"]}))
        reports = self.data / "reports/reviews" / ("a" * 24)
        reports.mkdir(parents=True)
        manifest = reports / "review.json"
        manifest.write_text(json.dumps({"id": "a" * 24, "entries": [{"situation": self.old}]}))
        evidence = manifest.read_bytes()
        migration = StateMigration(self.shared, self.data)
        before = {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        inventory, _ = migration.inventory()
        self.assertEqual(inventory["errors"], [])
        self.assertEqual(len(inventory["mappings"][0]["situationIds"]), 2)
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})
        result = migration.apply()
        self.assertEqual(result["status"], "applied")
        store = SituationStore(self.shared, self.data)
        one = store.read("old123")
        self.assertEqual(one["checkpoint"], self.old["checkpoint"])
        self.assertEqual(one["presentation"]["sessionState"]["pane"], "hand")
        self.assertNotIn("checkpoint", store.entries(metadata=True)[0])
        self.assertNotIn("checkpoint", json.loads(oldfile.read_text()))
        self.assertEqual(len(store.entries()), 2)
        self.assertEqual(migration.apply()["status"], "unchanged")
        self.assertEqual(manifest.read_bytes(), evidence)
        migration.rollback(result["transaction"])
        self.assertEqual(oldfile.read_bytes(), original)
        self.assertEqual(manifest.read_bytes(), evidence)
        self.assertEqual(len(list(self.shared.rglob("*.json"))), 1)
        self.assertEqual(migration.rollback(result["transaction"])["status"], "rolled-back")

    def test_promotion_copies_decision_state_and_does_not_leak_legacy_paths(self):
        self.write_old(local=True)
        StateMigration(self.shared, self.data).apply()
        store = SituationStore(self.shared, self.data)
        result = store.organize("old123", "cards", shared=True)
        self.assertEqual(result["origin"], "library")
        self.assertNotIn("legacy", result)
        self.assertEqual(result["checkpoint"], self.old["checkpoint"])
        self.assertTrue((self.root / "decision-states" / (result["decisionStateId"] + ".json")).is_file())
        again = SituationStore(self.shared, self.data).read(result["id"])
        self.assertEqual(again["checkpoint"], result["checkpoint"])
        store.organize(result["id"], "other", shared=True)
        self.assertNotIn("checkpoint", json.loads((self.shared / "other" / (result["id"] + ".json")).read_text()))

    def test_invalid_records_duplicate_ids_and_missing_refs_fail_before_mutation(self):
        oldfile = self.write_old()
        before = oldfile.read_bytes()
        self.write_old(local=True)
        migration = StateMigration(self.shared, self.data)
        self.assertTrue(migration.inventory()[0]["errors"])
        with self.assertRaises(ValueError):
            migration.apply()
        self.assertEqual(oldfile.read_bytes(), before)
        (self.data / "situations/cards/old123.json").unlink()
        _, variants, _, _ = compose_legacy(self.old)
        oldfile.write_text(json.dumps(variants[0]))
        with self.assertRaisesRegex(ValueError, "Missing Decision State"):
            SituationStore(self.shared, self.data).read("old123")
        self.assertTrue(migration.inventory()[0]["errors"])

    def test_rollback_rejects_post_migration_edits_without_partial_revert(self):
        oldfile = self.write_old()
        migration = StateMigration(self.shared, self.data)
        result = migration.apply()
        oldfile.write_text(oldfile.read_text() + " ")
        decisions = list((self.root / "decision-states").glob("*.json"))
        with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
            migration.rollback(result["transaction"])
        self.assertTrue(all(p.is_file() for p in decisions))
        with self.assertRaisesRegex(ValueError, "must belong"):
            migration.rollback(self.root)

    def test_failed_apply_restores_already_changed_files(self):
        oldfile = self.write_old()
        original = oldfile.read_bytes()
        migration = StateMigration(self.shared, self.data)
        real_replace = Path.replace
        def fail_once(source, target):
            if Path(target).name == oldfile.name and ".migration-" in source.name:
                raise OSError("Simulated disk failure")
            return real_replace(source, target)
        with patch.object(Path, "replace", fail_once):
            with self.assertRaisesRegex(OSError, "disk failure"):
                migration.apply()
        self.assertEqual(oldfile.read_bytes(), original)
        self.assertEqual(list((self.root / "decision-states").glob("*.json")), [])
        self.assertEqual(migration.apply()["status"], "applied")


if __name__ == "__main__":
    unittest.main()
