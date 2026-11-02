import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from situations import SituationStore
from state_model import decision_state, normalize_tags, roster_tags

class TagStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = SituationStore(self.root / "library/situations", self.root / "local")
        self.checkpoint = {"state": {"phase": "PLANNING", "round": 1, "rng": 2**90 + 13}, "rollback_snapshot": {"rng": 2**80 + 7}}
        self.identity = decision_state(self.checkpoint)["id"]
        self.record = {"schema":3,"kind":"situation","id":"tags123","name":"Choose","decisionStateId":self.identity,
                       "checkpoint":self.checkpoint,"tags":[" Hero:Arien ", "card choice"]}
        self.store.save(self.record)

    def test_tags_preserve_checkpoint_identity_and_propagate_to_variants(self):
        self.store.save({**self.record, "id":"variant123"})
        self.store.set_tags("decision-state", self.identity, ["Phase:Planning", "phase:planning"], "local")
        for record in self.store.entries():
            self.assertEqual(record["checkpoint"], self.checkpoint)
            self.assertEqual(record["decisionStateId"], self.identity)
            self.assertEqual(record["tags"], ["card-choice", "hero:arien"])
            self.assertEqual(record["decisionStateTags"], ["phase:planning"])
        self.store.save_decision_state(self.checkpoint, name="Named checkpoint")
        self.assertEqual(self.store.decision_entries()[0]["tags"], ["phase:planning"])
        self.store.set_tags("decision-state", self.identity, ["updated"], "local")
        self.assertTrue(all(s["decisionStateTags"] == ["updated"] for s in self.store.entries(metadata=True)))
        self.assertTrue(all("checkpoint" not in s for s in self.store.entries(metadata=True)))

    def test_promotion_retains_both_tag_sets_and_tag_edits_survive_restart(self):
        self.store.set_tags("decision-state", self.identity, ["planning"], "local")
        promoted = self.store.organize("tags123", "cards", True)
        fresh = SituationStore(self.store.shared, self.root / "local")
        saved = fresh.read(promoted["id"])
        self.assertEqual(saved["tags"], ["card-choice", "hero:arien"])
        self.assertEqual(saved["decisionStateTags"], ["planning"])
        fresh.set_tags("situation", saved["id"], ["Updated Tag"], "library")
        self.assertEqual(self.store.read(saved["id"])["tags"], ["updated-tag"])
        persisted = json.loads(fresh._find(saved["id"], True).read_text())
        self.assertNotIn("decisionStateTags", persisted)
        self.assertEqual(decision_state(self.checkpoint)["id"], self.identity)

    def test_invalid_tags_do_not_change_metadata_and_clearing_is_explicit(self):
        before = self.store.read("tags123")
        for tags in ("bad", [1], ["../escape"], ["x"*49], ["tag"+str(i) for i in range(33)]):
            with self.subTest(tags=tags), self.assertRaises(ValueError):
                self.store.set_tags("situation", "tags123", tags)
            self.assertEqual(self.store.read("tags123"), before)
        self.store.set_tags("situation", "tags123", [])
        self.assertEqual(self.store.read("tags123")["tags"], [])

    def test_saving_a_shared_moment_locally_keeps_its_checkpoint_tags(self):
        shared = self.store.organize("tags123", "cards", True)
        self.store.set_tags("decision-state", self.identity, ["shared-moment"], "library")
        other = SituationStore(self.store.shared, self.root / "other-local")
        saved = other.save({**self.record, "id":"copied"})
        self.assertEqual(saved["decisionStateTags"], ["shared-moment"])
        self.assertEqual(saved["checkpoint"], self.checkpoint)

    def test_roster_tags_and_description_survive_promotion(self):
        checkpoint = {"state": {"phase": "PLANNING", "teams": {
            "BLUE": {"heroes": [{"id": "hero_arien"}, {"id": "hero_hanu"}]},
            "RED": {"heroes": [{"id": "hero_brogan"}]}}}}
        record = {**self.record, "id": "roster", "checkpoint": checkpoint,
                  "decisionStateId": decision_state(checkpoint)["id"], "description": "Choose an opening card."}
        self.store.save(record)
        expected = roster_tags(checkpoint["state"])
        saved = self.store.read("roster")
        self.assertTrue(set(expected).issubset(saved["decisionStateTags"]))
        promoted = self.store.organize("roster", "planning", True)
        self.assertEqual(promoted["description"], record["description"])
        self.assertEqual(self.store.entries(metadata=True)[0].get("checkpoint"), None)
        self.assertTrue(set(expected).issubset(self.store.read(promoted["id"])["decisionStateTags"]))

    def test_entire_curated_library_has_canonical_tags_without_changing_ids(self):
        root = Path(__file__).resolve().parents[1] / "library"
        for kind in ("situations", "decision-states", "layouts"):
            for file in (root / kind).rglob("*.json"):
                record = json.loads(file.read_text(encoding="utf-8"))
                self.assertTrue(record.get("tags"), str(file))
                self.assertEqual(record["tags"], normalize_tags(record["tags"]), str(file))
                if kind == "situations":
                    self.assertTrue(record.get("description"), str(file))
                    self.assertNotRegex(record["name"], r"(?i)\bM\d+\b|\bvariant\s+\d+")
                    checkpoint = json.loads((root / "decision-states" / (record["decisionStateId"] + ".json")).read_text(encoding="utf-8"))
                    self.assertTrue(set(roster_tags(checkpoint["checkpoint"]["state"])).issubset(checkpoint["tags"]))
                if kind == "decision-states":
                    self.assertEqual(decision_state(record["checkpoint"])["id"], file.stem)
                for view in record.get("views", []):
                    self.assertTrue(view.get("tags"), str(file))
                    self.assertEqual(view["tags"], normalize_tags(view["tags"]))

if __name__ == "__main__":
    unittest.main()
