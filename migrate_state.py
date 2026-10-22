"""Dry-run/apply/rollback the lab state migration; never rewrite report evidence.

Run with the lab Python environment: python migrate_state.py [--apply]. Close the
lab before applying or rolling back; the default command only inventories files.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import uuid

from state_model import compose_legacy, decision_state, layout, presentation
from situations import SituationStore


def file_hash(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


class StateMigration:
    def __init__(self, shared, data):
        self.shared = Path(shared).resolve()
        self.data = Path(data).resolve()

    def inventory(self):
        outputs, sources, mappings, warnings, errors = {}, {}, [], [], []
        def output(path, value):
            payload = encoded(value)
            if path in outputs and outputs[path] != payload:
                raise ValueError("Conflicting migration output: " + str(path))
            if path.exists():
                existing = json.loads(path.read_text(encoding="utf-8"))
                if path.read_bytes() == payload or existing == value:
                    return
                if value.get("kind") == "decision-state" and existing.get("id") == value["id"] and existing.get("checkpoint") == value["checkpoint"]:
                    return
            if path.exists() and path not in sources:
                raise ValueError("Output already exists with different contents: " + str(path))
            outputs[path] = payload

        for origin, root, decisions in [
            ("library", self.shared, self.shared.parent / "decision-states"),
            ("local", self.data / "situations", self.data / "decision-states"),
        ]:
            for path in sorted(root.rglob("*.json")):
                try:
                    if not path.resolve().is_relative_to(root):
                        raise ValueError("Situation symlink escapes its library")
                    raw = path.read_bytes()
                    sources[path] = file_hash(raw)
                    old = json.loads(raw)
                    SituationStore.group(path.parent.relative_to(root).as_posix() if path.parent != root else "")
                    state, variants, suggested, notes = compose_legacy(old)
                    warnings.extend({"path": str(path), "message": note} for note in notes)
                    if state is None:
                        decision_path = decisions / (old["decisionStateId"] + ".json")
                        if not decision_path.is_file():
                            raise ValueError("Missing Decision State: " + str(decision_path))
                        existing = json.loads(decision_path.read_text(encoding="utf-8"))
                        if decision_state(existing.get("checkpoint"))["id"] != old["decisionStateId"]:
                            raise ValueError("Decision State content hash does not match")
                        output(path, variants[0])
                        mappings.append({"origin": origin, "sourceId": old["id"], "situationIds": [old["id"]], "decisionStateId": old["decisionStateId"], "unchanged": True})
                        continue
                    output(decisions / (state["id"] + ".json"), state)
                    for index, variant in enumerate(variants):
                        destination = path if index == 0 else path.parent / (variant["id"] + ".json")
                        output(destination, variant)
                    if suggested:
                        folder = self.shared.parent / "layouts" if origin == "library" else self.data / "layouts"
                        output(folder / (suggested["id"] + ".json"), suggested)
                    mappings.append({"origin": origin, "sourceId": old["id"], "situationIds": [v["id"] for v in variants], "decisionStateId": state["id"], "primarySlot": variants[0]["migration"]["sourceSlot"], "suggestedLayoutId": suggested["id"] if suggested else None})
                except (ValueError, KeyError, TypeError, OSError) as error:
                    errors.append({"path": str(path), "message": str(error)})

        # Duplicate IDs are invalid even if records live in different origins/folders.
        owners = {}
        for item in mappings:
            for identity in item["situationIds"]:
                if identity in owners:
                    errors.append({"id": identity, "message": "Duplicate Situation ID across migration inputs"})
                owners[identity] = item["sourceId"]
        for filename, targetname, convert in [
            ("presentations.json", "presentation-templates.json", self._templates),
            ("presets.json", "layouts.json", self._presets),
        ]:
            path = self.data / filename
            target = self.data / targetname
            if path.is_file():
                try:
                    raw = path.read_bytes()
                    sources[path] = file_hash(raw)
                    value = convert(json.loads(raw))
                    # A previously migrated target is authoritative; do not overwrite edits.
                    if not target.exists():
                        output(target, value)
                except (ValueError, KeyError, TypeError, OSError) as error:
                    errors.append({"path": str(path), "message": str(error)})
        reviews = []  # Report/review history is explicitly cleared at cutover.
        return {"schema": 1, "mappings": mappings, "warnings": warnings, "errors": errors,
                "legacyReviews": reviews, "sources": {str(k): v for k, v in sources.items()},
                "outputs": [{"path": str(k), "sha256": file_hash(v)} for k, v in outputs.items()]}, outputs

    @staticmethod
    def _templates(values):
        if not isinstance(values, list):
            raise ValueError("Presentation templates must be a list")
        return [{**copy.deepcopy(v), "schema": 2, "state": presentation(v.get("state"))} for v in values]

    @staticmethod
    def _presets(values):
        if not isinstance(values, dict):
            raise ValueError("Legacy presets must be a name-to-views object")
        return [layout(configs, name) for name, configs in values.items()]

    def apply(self):
        self._assert_no_pending()
        inventory, outputs = self.inventory()
        if inventory["errors"]:
            raise ValueError("Migration validation failed: " + json.dumps(inventory["errors"]))
        if not outputs:
            return {**inventory, "status": "unchanged", "transaction": None}
        folder = self.data / "migrations" / uuid.uuid4().hex
        folder.mkdir(parents=True)
        operations = []
        for index, (target, payload) in enumerate(outputs.items()):
            before = target.read_bytes() if target.exists() else None
            staged = folder / (str(index) + ".new")
            staged.write_bytes(payload)
            if before is not None:
                (folder / (str(index) + ".bak")).write_bytes(before)
            operations.append({"path": str(target), "before": file_hash(before) if before is not None else None,
                               "after": file_hash(payload), "index": index})
        manifest = {**inventory, "status": "prepared", "operations": operations,
                    "roots": [str(self.shared), str(self.shared.parent / "decision-states"),
                              str(self.shared.parent / "layouts"), str(self.data)]}
        journal = folder / "manifest.json"
        SituationStore._write(journal, manifest)
        try:
            # Optimistic concurrency check: fail before touching a changed source.
            for source, expected in inventory["sources"].items():
                if file_hash(Path(source).read_bytes()) != expected:
                    raise ValueError("Migration source changed: " + source)
            # Decision States were inserted before references. Each replacement is atomic;
            # a stopped transaction is recoverable from its prepared journal.
            for operation in operations:
                target = Path(operation["path"])
                current = file_hash(target.read_bytes()) if target.exists() else None
                if current != operation["before"]:
                    raise ValueError("Migration destination changed: " + str(target))
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_name(target.name + ".migration-" + folder.name)
                temporary.write_bytes((folder / (str(operation["index"]) + ".new")).read_bytes())
                temporary.replace(target)
            manifest["status"] = "applied"
            SituationStore._write(journal, manifest)
        except BaseException:
            self.rollback(folder, allow_prepared=True)
            raise
        return {**inventory, "status": "applied", "transaction": str(folder)}

    def _assert_no_pending(self):
        for path in (self.data / "migrations").glob("*/manifest.json"):
            if json.loads(path.read_text(encoding="utf-8")).get("status") == "prepared":
                raise ValueError("Recover interrupted migration with --rollback " + path.parent.name)

    def rollback(self, transaction, *, allow_prepared=False):
        folder = Path(transaction).resolve()
        root = (self.data / "migrations").resolve()
        if not folder.is_relative_to(root) or folder.parent != root:
            raise ValueError("Rollback transaction must belong to this lab data directory")
        journal = folder / "manifest.json"
        manifest = json.loads(journal.read_text(encoding="utf-8"))
        if manifest.get("status") == "rolled-back":
            return {"status": "rolled-back", "transaction": str(folder)}
        if manifest.get("status") not in {"applied", "prepared"}:
            raise ValueError("Invalid migration status")
        roots = [self.shared, self.shared.parent / "decision-states", self.shared.parent / "layouts", self.data]
        changes = []
        for operation in manifest["operations"]:
            target = Path(operation["path"]).resolve()
            if not any(target.is_relative_to(r) for r in roots):
                raise ValueError("Rollback path escapes migration roots")
            current = file_hash(target.read_bytes()) if target.exists() else None
            if current == operation["before"]:
                continue
            if current != operation["after"]:
                raise ValueError("Refusing to overwrite edits made after migration: " + str(target))
            if operation["before"] is not None:
                backup = folder / (str(operation["index"]) + ".bak")
                if file_hash(backup.read_bytes()) != operation["before"]:
                    raise ValueError("Corrupt migration backup")
            changes.append((operation, target))
        for operation, target in reversed(changes):
            if operation["before"] is None:
                target.unlink()
            else:
                temporary = target.with_name(target.name + ".rollback-" + folder.name)
                temporary.write_bytes((folder / (str(operation["index"]) + ".bak")).read_bytes())
                temporary.replace(target)
        manifest["status"] = "rolled-back"
        SituationStore._write(journal, manifest)
        return {"status": "rolled-back", "transaction": str(folder)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shared", type=Path, default=Path(__file__).parent / "situations")
    parser.add_argument("--data", type=Path, default=Path(__file__).parent / ".layout-lab")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", metavar="TRANSACTION")
    args = parser.parse_args()
    migration = StateMigration(args.shared, args.data)
    if args.rollback:
        result = migration.rollback(args.data / "migrations" / args.rollback)
    elif args.apply:
        result = migration.apply()
    else:
        result, _ = migration.inventory()
        result["status"] = "dry-run"
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 1 if result.get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
