"""Storage checks run on Windows Python without starting game services."""

import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from situations import SituationStore
from state_model import decision_state


class SituationLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = SituationStore(self.root / "shared", self.root / "data")
        self.draft = {
            "schema": 2,
            "kind": "situation",
            "decisionStateId": decision_state({"state":{}})["id"],
            "presentation": {"schema":2,"sessionState":{},"userState":{}},
            "id": "abc123",
            "name": "Choosing defense",
            "checkpoint": {"state": {}},
            "summary": {},
            "provenance": {
                "kind": "capture",
                "runtime": {"path": "private"},
                "slots": [{"seat": "hero_arien"}],
            },
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_nested_folders_promotion_and_reload(self):
        self.store.save(self.draft)
        moved = self.store.organize("abc123", "cards/defense")
        self.assertEqual(moved["origin"], "local")
        shared = self.store.organize("abc123", "cards/defense", True)
        self.assertNotEqual(shared["id"], "abc123")
        self.assertEqual(shared["checkpoint"], moved["checkpoint"])
        self.assertNotIn("runtime", shared["provenance"])
        self.assertEqual(len(self.store.entries()), 2)
        self.assertTrue(
            (self.root / "shared/cards/defense" / (shared["id"] + ".json")).exists()
        )
        self.store.organize(shared["id"], "heroes/arien", True)
        reopened = SituationStore(self.root / "shared", self.root / "data")
        self.assertEqual(reopened.read(shared["id"])["group"], "heroes/arien")
        self.assertEqual(reopened.read("abc123")["group"], "cards/defense")
        self.assertEqual(len(reopened.entries()), 2)

    def test_old_format_requires_explicit_offline_porting(self):
        old = {"schema":1,"id":"old123","name":"Old","checkpoint":{"state":{}}}
        with self.assertRaisesRegex(ValueError,"Unsupported composed"):
            self.store.save(old)
        self.assertEqual(self.store.entries(),[])

    def test_paths_cannot_escape_either_root(self):
        self.store.save(self.draft)
        for group in [
            "../elsewhere",
            "/absolute",
            "C:/Windows",
            "a/../b",
            "a//b",
            "a\\b",
            "a/.",
            "a/",
            ".hidden",
        ]:
            with self.subTest(group=group), self.assertRaises(ValueError):
                self.store.organize("abc123", group, True)
        self.assertEqual(len(self.store.entries()), 1)
        with self.assertRaises(ValueError):
            self.store.read("../../private")

    def test_cached_reads_are_isolated_and_metadata_excludes_checkpoints(self):
        self.store.save(self.draft)
        with patch("situations.json.loads", wraps=json.loads) as parse:
            first = self.store.read("abc123")
            self.store.read("abc123")
            self.store.entries(metadata=True)
            self.assertEqual(parse.call_count, 1)
        first["checkpoint"]["state"]["changed"] = True
        self.assertEqual(self.store.read("abc123")["checkpoint"]["state"], {})
        metadata = self.store.entries(metadata=True)[0]
        self.assertNotIn("checkpoint", metadata)
        metadata["provenance"]["slots"].clear()
        self.assertEqual(len(self.store.read("abc123")["provenance"]["slots"]), 1)

    def test_cache_observes_edits_moves_additions_deletions_and_duplicates(self):
        self.store.save(self.draft)
        self.store.read("abc123")
        self.store.save({**self.draft, "name": "Changed externally"})
        self.assertEqual(self.store.read("abc123")["name"], "Changed externally")
        self.store.organize("abc123", "new-folder")
        self.assertEqual(self.store.read("abc123")["group"], "new-folder")
        self.store.save({**self.draft, "id": "second"})
        self.assertEqual(len(self.store.entries()), 2)
        (self.root / "data/situations/second.json").unlink()
        self.assertEqual(len(self.store.entries()), 1)
        self.store.save(self.draft)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.store.entries()

    def test_shared_fixtures_are_not_overwritten_by_draft_save(self):
        self.store.save(self.draft)
        shared = self.store.organize("abc123", "cards", True)
        self.store.save({**self.draft, "name": "Changed draft"})
        self.assertEqual(self.store.read(shared["id"])["name"], "Choosing defense")
        self.assertEqual(self.store.read("abc123")["name"], "Changed draft")


if __name__ == "__main__":
    unittest.main()
