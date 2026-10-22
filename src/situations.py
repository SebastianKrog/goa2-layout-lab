"""Portable, folder-based shared library and private situation drafts."""

from __future__ import annotations

import copy
import json
import re
import uuid
import threading
from pathlib import Path

from state_model import (SITUATION_SCHEMA, current_record, decision_state, identifier, validate_situation)


class SituationStore:
    def __init__(self, shared, data, *, create=True):
        self.shared = Path(shared).resolve()
        self.local = Path(data).resolve() / "situations"
        if create:
            self.local.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._cache = {}
        self._decision_cache = {}
        self.shared_decisions = self.shared.parent / "decision-states"
        self.local_decisions = Path(data).resolve() / "decision-states"

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
        temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)

    def _scan(self):
        entries = []
        present = set()
        ids = set()
        for origin, root in [("library", self.shared), ("local", self.local)]:
            for path in sorted(root.rglob("*.json")):
                if not path.resolve().is_relative_to(root):
                    raise ValueError("Situation symlink escapes its library")
                stat = path.stat()
                stamp = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_ino)
                present.add(path)
                cached = self._cache.get(path)
                if cached is None or cached[0] != stamp:
                    cached = (stamp, json.loads(path.read_text(encoding="utf-8")))
                    self._cache[path] = cached
                value = cached[1]
                validate_situation(value)
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
        self._cache = {p: value for p, value in self._cache.items() if p in present}
        return sorted(
            entries, key=lambda s: (s["group"].lower(), s["name"].lower(), s["id"])
        )

    def entries(self, metadata=False):
        with self._lock:
            entries = self._scan()
            entries = [self._hydrate(entry, metadata=metadata) for entry in entries]
            return copy.deepcopy(entries)

    def read(self, identifier):
        self._target(False, "", identifier)
        with self._lock:
            for entry in self._scan():
                if entry["id"] == identifier:
                    # Restore/organize callers may mutate their copy; never leak
                    # the cached checkpoint into a live game or another clone.
                    return self._hydrate(entry)
        raise KeyError("Situation not found")

    def save_decision_state(self, checkpoint, *, shared=False, name=None):
        record = decision_state(checkpoint)
        root = self.shared_decisions if shared else self.local_decisions
        path = root / (record["id"] + ".json")
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))
            if existing != record:
                raise ValueError("Decision State content hash collision or corrupt file")
        else:
            self._write(path, record)
        if name:
            labels_file = root / "labels.json"
            labels = json.loads(labels_file.read_text(encoding="utf-8")) if labels_file.is_file() else {}
            labels[record["id"]] = str(name)[:160]
            self._write(labels_file, labels)
        return record

    def decision_entries(self):
        entries = {}
        for origin, root in [("library",self.shared_decisions),("local",self.local_decisions)]:
            labels_file = root / "labels.json"
            labels = json.loads(labels_file.read_text(encoding="utf-8")) if labels_file.is_file() else {}
            for path in sorted(root.glob("*.json")):
                if path.name == "labels.json":
                    continue
                identity = identifier(path.stem, decision=True)
                saved = self._decision({"decisionStateId":identity,"origin":origin})
                state = saved["state"]
                entries[identity] = {"id":identity,"name":labels.get(identity,"Decision State " + identity[:12]),
                    "origin":origin,"summary":{"phase":state.get("phase"),"round":state.get("round")}}
        return sorted(entries.values(),key=lambda e:(e["name"].lower(),e["id"]))

    def _decision(self, entry):
        identity = identifier(entry["decisionStateId"], decision=True)
        # Never let a shared fixture depend on an ignored local checkpoint.
        roots = [self.shared_decisions] if entry.get("origin") == "library" else [self.local_decisions, self.shared_decisions]
        for root in roots:
            path = root / (identity + ".json")
            if not path.is_file():
                continue
            if not path.resolve().is_relative_to(root.resolve()):
                raise ValueError("Decision State symlink escapes its store")
            stamp = (path.stat().st_mtime_ns, path.stat().st_size)
            cached = self._decision_cache.get(path)
            if cached is None or cached[0] != stamp:
                value = json.loads(path.read_text(encoding="utf-8"))
                if value.get("kind") != "decision-state" or value.get("schema") != 1 or value.get("id") != identity or decision_state(value.get("checkpoint"))["id"] != identity:
                    raise ValueError("Corrupt Decision State: " + identity)
                cached = (stamp, value)
                self._decision_cache[path] = cached
            return copy.deepcopy(cached[1]["checkpoint"])
        raise ValueError("Missing Decision State: " + identity)

    def _hydrate(self, entry, metadata=False):
        result = current_record(entry, None if metadata else self._decision(entry))
        if metadata:
            result.pop("checkpoint", None)
        return result

    @staticmethod
    def _persist_value(value):
        validate_situation(value)
        return {k: v for k, v in value.items() if k not in {"checkpoint", "origin", "group"}}

    def save(self, value, group=""):
        # Ordinary saves always create local drafts, never overwrite shared fixtures.
        path = self._target(False, group, value["id"])
        validate_situation(value)
        if "checkpoint" in value:
            state = self.save_decision_state(value["checkpoint"])
            if state["id"] != value["decisionStateId"]:
                raise ValueError("Decision State does not match Situation")
        else:
            self._decision({**value, "origin": "local"})
        self._write(path, self._persist_value(value))
        return self._hydrate({**self._persist_value(value), "origin": "local", "group": self.group(group)})

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
        if value.get("schema") == SITUATION_SCHEMA and promotion:
            self.save_decision_state(value["checkpoint"], shared=True)
            # A shared copy must not leak local runtime metadata.
            value = {k: v for k, v in value.items() if k in {
                "schema", "kind", "id", "name", "decisionStateId", "presentation",
                "summary", "backend_revision", "saved_at", "checkpoint", "provenance"}}

        target = self._target(shared, group, value["id"])
        if target != old and target.exists():
            raise ValueError("A situation already exists at that location")
        self._write(target, self._persist_value(value))
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
