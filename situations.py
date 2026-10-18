"""Portable, folder-based shared library and private situation drafts."""

from __future__ import annotations

import copy
import json
import re
import uuid
from pathlib import Path


class SituationStore:
    def __init__(self, shared, data):
        self.shared = Path(shared).resolve()
        self.local = Path(data).resolve() / "situations"
        self.local.mkdir(parents=True, exist_ok=True)
        # Preserve old IDs without moving or deleting the original backups.
        legacy = Path(data).resolve() / "scenarios"
        existing = {
            json.loads(p.read_text(encoding="utf-8"))["id"]
            for p in self.local.rglob("*.json")
        }
        for source in sorted(legacy.glob("*.json")):
            destination = self.local / source.name
            if source.stem not in existing and not destination.exists():
                self._write(destination, json.loads(source.read_text(encoding="utf-8")))

    @staticmethod
    def group(value):
        if not isinstance(value, str) or len(value) > 160:
            raise ValueError("Use a short folder path")
        if value == "":
            return ""
        parts = value.split("/")
        if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,60}", p) for p in parts):
            raise ValueError(
                "Folder names use letters, numbers, spaces, dashes or underscores; separate folders with /"
            )
        return "/".join(parts)

    def _target(self, shared, group, identifier):
        if not isinstance(identifier, str) or not re.fullmatch(
            r"[a-zA-Z0-9]{1,40}", identifier
        ):
            raise ValueError("Invalid situation identifier")
        root = self.shared if shared else self.local
        target = root / self.group(group) / (identifier + ".json")
        if not target.resolve().is_relative_to(root):
            raise ValueError("Folder escapes the situation library")
        return target

    @staticmethod
    def _write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(
            json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        temp.replace(path)

    def entries(self):
        entries = []
        ids = set()
        for origin, root in [("library", self.shared), ("local", self.local)]:
            for path in sorted(root.rglob("*.json")):
                if not path.resolve().is_relative_to(root):
                    raise ValueError("Situation symlink escapes its library")
                value = json.loads(path.read_text(encoding="utf-8"))
                identifier = value["id"]
                self._target(origin == "library", "", identifier)
                if identifier in ids:
                    raise ValueError("Duplicate situation ID: " + identifier)
                ids.add(identifier)
                entries.append(
                    {
                        **value,
                        "origin": origin,
                        "group": (
                            ""
                            if path.parent == root
                            else path.parent.relative_to(root).as_posix()
                        ),
                    }
                )
        return sorted(
            entries, key=lambda s: (s["group"].lower(), s["name"].lower(), s["id"])
        )

    def read(self, identifier):
        self._target(False, "", identifier)
        for entry in self.entries():
            if entry["id"] == identifier:
                return entry
        raise KeyError("Situation not found")

    def save(self, value, group=""):
        # Ordinary saves always create local drafts, never overwrite shared fixtures.
        path = self._target(False, group, value["id"])
        self._write(path, value)
        return {**value, "origin": "local", "group": self.group(group)}

    def organize(self, identifier, group, shared=False):
        value = self.read(identifier)
        old = self._find(identifier, value["origin"] == "library")
        source_shared = value.pop("origin") == "library"
        value.pop("group", None)
        if source_shared and not shared:
            raise ValueError(
                "Shared situations stay in the library; save a local copy from a view"
            )
        promotion = shared and not source_shared
        if promotion:
            value = copy.deepcopy(value)
            value["id"] = uuid.uuid4().hex[:12]
            # Shared copies must not retain machine-specific paths or runtime metadata.
            provenance = value.get("provenance", {})
            value["provenance"] = {
                k: provenance[k]
                for k in (
                    "kind",
                    "timed",
                    "decision",
                    "clock_fidelity",
                    "slots",
                    "references",
                    "script_checksum",
                    "source_slot",
                )
                if k in provenance
            }
        target = self._target(shared, group, value["id"])
        if target != old and target.exists():
            raise ValueError("A situation already exists at that location")
        self._write(target, value)
        if not promotion and target != old:
            old.unlink()
        return {
            **value,
            "origin": "library" if shared else "local",
            "group": self.group(group),
        }

    def _find(self, identifier, shared):
        root = self.shared if shared else self.local
        for path in root.rglob("*.json"):
            if json.loads(path.read_text(encoding="utf-8"))["id"] == identifier:
                return path
        raise KeyError("Situation not found")
