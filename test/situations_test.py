"""Storage checks run on Windows Python without starting game services."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from situations import SituationStore


class SituationLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = SituationStore(self.root / "shared", self.root / "data")
        self.draft = {
            "schema": 1,
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

    def test_legacy_migration_does_not_reimport_moved_drafts(self):
        legacy = self.root / "data/scenarios"
        legacy.mkdir(parents=True)
        (legacy / "abc123.json").write_text(json.dumps(self.draft), encoding="utf-8")
        store = SituationStore(self.root / "shared", self.root / "data")
        store.organize("abc123", "heroes/gydion")
        reopened = SituationStore(self.root / "shared", self.root / "data")
        self.assertEqual(len(reopened.entries()), 1)
        self.assertEqual(reopened.read("abc123")["group"], "heroes/gydion")
        self.assertTrue((legacy / "abc123.json").exists())

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

    def test_shared_fixtures_are_not_overwritten_by_draft_save(self):
        self.store.save(self.draft)
        shared = self.store.organize("abc123", "cards", True)
        self.store.save({**self.draft, "name": "Changed draft"})
        self.assertEqual(self.store.read(shared["id"])["name"], "Choosing defense")
        self.assertEqual(self.store.read("abc123")["name"], "Changed draft")


if __name__ == "__main__":
    unittest.main()
