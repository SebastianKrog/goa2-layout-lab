"""Versioned lab state contracts. Engine checkpoints stay entirely in Python."""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path

SITUATION_SCHEMA = 2
PRESENTATION_SCHEMA = 2
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


_UNSET = object()


def presentation(value=_UNSET, viewpoint=_UNSET):
    """Normalize raw adapter captures and canonical Presentation envelopes."""
    if value is _UNSET:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("Presentation must be an object")
    value = copy.deepcopy(value)
    if "schema" in value and value["schema"] != PRESENTATION_SCHEMA:
        raise ValueError("Unsupported Presentation schema")
    if any(k in value for k in ("schema", "viewpoint", "sessionState", "userState")):
        if not isinstance(value.get("sessionState", {}), dict) or not isinstance(value.get("userState", {}), dict):
            raise ValueError("Presentation states must be objects")
        result = {"schema": PRESENTATION_SCHEMA, "sessionState": {}, "userState": {}, **value}
    else:
        storage = value.pop("storage", {})
        if not isinstance(storage, dict):
            raise ValueError("Presentation storage must be an object")
        user = {k: v for k, v in storage.items() if k in USER_STATE_KEYS}
        scoped = {k: v for k, v in storage.items() if k.startswith(SESSION_STORAGE_PREFIXES)}
        unsupported = sorted(k for k in storage if k not in user and k not in scoped)
        result = {"schema": PRESENTATION_SCHEMA, "sessionState": value, "userState": user}
        if scoped:
            result["sessionState"]["storage"] = scoped
        if unsupported:
            result["warnings"] = ["Unsupported saved storage key: " + k for k in unsupported]
    for key, val in result["userState"].items():
        if key not in USER_STATE_KEYS or not (val is None or isinstance(val, str)):
            raise ValueError("Unsupported User State setting: " + key)
    def validate_session(session):
        if not isinstance(session, dict):
            raise ValueError("Session State must be an object")
        if "storage" in session:
            storage = session["storage"]
            if not isinstance(storage, dict):
                raise ValueError("Presentation storage must be an object")
            for key, val in storage.items():
                if not key.startswith(SESSION_STORAGE_PREFIXES) or not (val is None or isinstance(val, str)):
                    raise ValueError("Unsupported Session State storage key: " + key)
        if "modes" in session:
            if not isinstance(session["modes"], dict):
                raise ValueError("Session State modes must be an object")
            for mode in session["modes"].values():
                validate_session(mode)
    validate_session(result["sessionState"])
    if viewpoint is not _UNSET:
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


def current_record(record, checkpoint=None):
    validate_situation(record)
    result = copy.deepcopy(record)
    if checkpoint is not None:
        result["checkpoint"] = copy.deepcopy(checkpoint)
    return result


def make_layout(configs, name="Suggested layout"):
    views = []
    for config in configs:
        view = copy.deepcopy(config)
        if "layout" in view:
            raise ValueError("Use uiMode in Layout views")
        if "seat" in view:
            view.setdefault("presentationDefaults", {})["viewpoint"] = view.pop("seat")
        views.append(view)
    return {"schema": 2, "kind": "layout", "id": digest([name, views])[:24],
            "name": name, "views": views, "synchronization": "none"}


def portable_situation(value):
    """Build portable composed records from explicit canonical factory inputs."""
    original = copy.deepcopy(value)
    if ("schema" in original and original["schema"] != 2) or "presentations" in original or "slots" in original.get("provenance", {}):
        raise ValueError("Factory output requires canonical Presentation and separate Layout")
    if original.get("kind") == "situation":
        validate_situation(original)
        return original
    state = decision_state(original.pop("checkpoint"))
    primary_id = original.pop("id", digest([original.get("name"), state["id"]])[:12])
    presentations = [original.pop("presentation"), *original.pop("additionalPresentations", [])]
    suggested = original.pop("suggestedLayout", None)
    records = []
    for index, saved in enumerate(presentations):
        if not isinstance(saved, dict) or saved.get("schema") != 2:
            raise ValueError("Factory output requires a schema 2 Presentation")
        composed = presentation(saved)
        record = {**original, "schema": 2, "kind": "situation",
                  "id": primary_id if index == 0 else digest([primary_id, index, composed])[:24],
                  "decisionStateId": state["id"], "presentation": composed}
        if index:
            record["name"] += " (variant " + str(index + 1) + ")"
        validate_situation(record)
        records.append(record)
    primary = records[0]
    primary["decisionState"] = state
    if len(records) > 1:
        primary["additionalSituations"] = records[1:]
    if suggested:
        primary["suggestedLayout"] = suggested
    return primary
