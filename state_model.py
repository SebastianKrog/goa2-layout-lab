"""Versioned lab state contracts. Engine checkpoints stay entirely in Python."""
from __future__ import annotations

import copy
import hashlib
import json
import re

SITUATION_SCHEMA = 2
PRESENTATION_SCHEMA = 2
from pathlib import Path
_CONTRACT = json.loads((Path(__file__).parent / "state-contract.json").read_text(encoding="utf-8"))
USER_STATE_KEYS = frozenset(_CONTRACT["userStateKeys"])
SESSION_STORAGE_PREFIXES = tuple(_CONTRACT["sessionStoragePrefixes"])


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def identifier(value, *, decision=False):
    pattern = r"[a-f0-9]{64}" if decision else r"[A-Za-z0-9]{1,40}"
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("Invalid decision state identifier" if decision else "Invalid situation identifier")
    return value


def presentation(value=None, viewpoint=None):
    """Unset means inherit; JSON null explicitly resets a field to adapter defaults."""
    value = copy.deepcopy(value or {})
    if value.get("schema") == PRESENTATION_SCHEMA:
        if not isinstance(value.get("sessionState", {}), dict) or not isinstance(value.get("userState", {}), dict):
            raise ValueError("Presentation states must be objects")
        result = value
    else:
        storage = value.pop("storage", {}) or {}
        if not isinstance(storage, dict):
            raise ValueError("Presentation storage must be an object")
        user = {k: v for k, v in storage.items() if k in USER_STATE_KEYS}
        session_storage = {k: v for k, v in storage.items() if k.startswith(SESSION_STORAGE_PREFIXES)}
        unsupported = [k for k in storage if k not in user and k not in session_storage]
        result = {"schema": PRESENTATION_SCHEMA, "sessionState": value, "userState": user}
        if session_storage:
            result["sessionState"]["storage"] = session_storage
        if unsupported:
            result["warnings"] = ["Unsupported saved storage key: " + k for k in sorted(unsupported)]
    for key, val in result.get("userState", {}).items():
        if key not in USER_STATE_KEYS or not (val is None or isinstance(val, str)):
            raise ValueError("Unsupported User State setting: " + key)
    if viewpoint is not None:
        result["viewpoint"] = viewpoint
    if "viewpoint" in result and result["viewpoint"] is not None and not isinstance(result["viewpoint"], str):
        raise ValueError("Viewpoint must be a player, spectator, or null")
    return result


def decision_state(checkpoint):
    if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get("state"), dict):
        raise ValueError("Decision State requires a resumable checkpoint")
    return {"schema": 1, "kind": "decision-state", "id": digest(checkpoint),
            "checkpoint": copy.deepcopy(checkpoint)}


def validate_situation(value):
    if value.get("schema") != SITUATION_SCHEMA or value.get("kind") != "situation":
        raise ValueError("Unsupported composed Situation schema")
    identifier(value.get("id"))
    identifier(value.get("decisionStateId"), decision=True)
    if not isinstance(value.get("name"), str):
        raise ValueError("Situation name is required")
    if not isinstance(value.get("presentation"), dict) or value["presentation"].get("schema") != PRESENTATION_SCHEMA:
        raise ValueError("Situation requires a schema 2 Presentation")
    presentation(value["presentation"])
    return value


def layout(configs, name="Imported layout", identity=None, synchronization="none"):
    views = []
    for config in configs:
        view = copy.deepcopy(config)
        view["uiMode"] = view.pop("layout", view.get("uiMode", "desktop"))
        if "seat" in view:
            view.setdefault("overrides", {})["viewpoint"] = view.pop("seat")
        views.append(view)
    return {"schema": 2, "kind": "layout", "id": identity or digest([name, configs])[:24],
            "name": name, "views": views, "synchronization": synchronization}


def compose_legacy(value):
    """Return a Decision State, deterministic Situation variants and suggested Layout.

    Offline porting only: retain unknown metadata without duplicating checkpoints.
    Runtime accepts only the resulting new-schema records.
    """
    if value.get("schema") == SITUATION_SCHEMA:
        validate_situation(value)
        record = copy.deepcopy(value)
        legacy = record.pop("legacy", None)
        if legacy:
            provenance = legacy.get("provenance", {})
            record["provenance"] = {k: copy.deepcopy(v) for k, v in provenance.items() if k != "slots"}
            extra = {k: copy.deepcopy(v) for k, v in legacy.items() if k not in {"id","name","schema","summary","backend_revision","saved_at","provenance","presentations"}}
            if extra:
                record["metadata"] = extra
        return None, [record], None, []
    if value.get("schema", 1) != 1:
        raise ValueError("Unsupported legacy Situation schema")
    old_id = identifier(value.get("id"))
    state = decision_state(value.get("checkpoint"))
    legacy = {k: copy.deepcopy(v) for k, v in value.items()
              if k not in {"checkpoint", "origin", "group"}}
    slots = value.get("provenance", {}).get("slots", [])
    presentations = value.get("presentations", {}) or {}
    if not isinstance(presentations, dict) or not isinstance(slots, list):
        raise ValueError("Invalid bundled Presentation or view setup")
    warnings, variants, seen = [], [], set()
    indexes = sorted(set(str(i) for i in range(len(slots))) | set(presentations),
                     key=lambda k: (0, int(k)) if k.isdigit() else (1, k)) or ["0"]
    for key in indexes:
        index = int(key) if key.isdigit() else -1
        slot = slots[index] if 0 <= index < len(slots) else {}
        source = presentations.get(key) or {}
        viewpoint = slot.get("seat") or value.get("provenance", {}).get("seat")
        composed = presentation(source, viewpoint)
        if not source:
            composed["sessionState"] = {"pane": "board", "selectedCard": None, "inspectedCard": None}
            composed["restoration"] = "defaulted; no historical Session State was saved"
        # Adapter identity is meaningful even where the visible fields happen to match.
        if slot.get("layout") or slot.get("render"):
            composed["adapter"] = {"uiMode": slot.get("layout", "desktop"), "render": slot.get("render", "2d")}
        signature = digest(composed)
        if signature in seen:
            continue
        seen.add(signature)
        variant_id = old_id if not variants else digest([old_id, signature])[:24]
        record = {"schema": SITUATION_SCHEMA, "kind": "situation", "id": variant_id,
                  "name": value.get("name", "Imported situation") + ("" if not variants else " (variant " + str(len(variants) + 1) + ")"),
                  "decisionStateId": state["id"], "presentation": composed,
                  "summary": copy.deepcopy(value.get("summary", {})),
                  "backend_revision": value.get("backend_revision"), "saved_at": value.get("saved_at"),
                  "provenance": {k: copy.deepcopy(v) for k,v in value.get("provenance",{}).items() if k != "slots"},
                  "metadata": {k: copy.deepcopy(v) for k,v in legacy.items() if k not in {"id","name","schema","summary","backend_revision","saved_at","provenance","presentations"}},
                  "migration": {"sourceId": old_id, "sourceSlot": key}}
        validate_situation(record)
        variants.append(record)
        warnings.extend(composed.get("warnings", []))
    if len(variants) > 1:
        warnings.append("Bundled views expanded into " + str(len(variants)) + " Situations; the original ID selects slot " + variants[0]["migration"]["sourceSlot"] + ".")
    suggested = layout(slots, value.get("name", "Imported") + " - suggested layout", digest([old_id, "layout"])[:24]) if slots else None
    return state, variants, suggested, warnings


def current_record(record, checkpoint=None):
    validate_situation(record)
    result = copy.deepcopy(record)
    if checkpoint is not None:
        result["checkpoint"] = copy.deepcopy(checkpoint)
    return result


def portable_situation(value):
    """Compose factory output into a portable v2 import bundle.

    Factory-side assembly may use the old per-view recipe, but exported records
    carry explicit Presentations and suggested Layouts. Variants are imported as
    separate Situations; executable choices are never applied automatically.
    """
    original = copy.deepcopy(value)
    if "checkpoint" in original and original.get("kind") != "situation":
        original["schema"] = 1  # Factory assembly is converted before export.
    original.setdefault("id", digest([original.get("name"), original.get("checkpoint")])[:12])
    state, variants, suggested, _ = compose_legacy(original)
    if state is None:
        return original
    records = []
    for variant in variants:
        record = {k: v for k, v in variant.items() if k not in {"legacy", "migration"}}
        record["decisionState"] = state
        provenance = original.get("provenance", {})
        record["provenance"] = {k: copy.deepcopy(v) for k, v in provenance.items() if k != "slots"}
        records.append(record)
    primary = records[0]
    if len(records) > 1:
        primary["additionalSituations"] = records[1:]
    if suggested:
        primary["suggestedLayout"] = suggested
    return primary
