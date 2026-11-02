"""Versioned lab state contracts. Engine checkpoints stay entirely in Python."""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path

SITUATION_SCHEMA = 3
PRESENTATION_SCHEMA = 2
_CONTRACT = json.loads((Path(__file__).parent / "state-contract.json").read_text(encoding="utf-8"))
USER_STATE_KEYS = frozenset(_CONTRACT["userStateKeys"])
SESSION_STORAGE_PREFIXES = tuple(_CONTRACT["sessionStoragePrefixes"])


def normalize_tags(value=None):
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(tag, str) for tag in value):
        raise ValueError("Tags must be a list of names")
    tags = sorted({re.sub(r"\s+", "-", tag.strip().lower()) for tag in value} - {""})
    if len(tags) > 32 or any(len(tag) > 48 or not re.fullmatch(r"[a-z0-9][a-z0-9:_-]*", tag) for tag in tags):
        raise ValueError("Use up to 32 tags, each up to 48 letters, numbers, colons, dashes or underscores")
    return tags


def roster_tags(state):
    return sorted({"hero:" + str(hero["id"]).removeprefix("hero_").replace("_", "-")
                   for team in state.get("teams", {}).values() for hero in team.get("heroes", []) if hero.get("id")})


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
    if any(key in value for key in ("presentation", "presentations", "additionalPresentations", "additionalSituations", "layout", "slots")):
        raise ValueError("Situations contain game state only; pass Presentation separately")
    normalize_tags(value.get("tags"))
    if "description" in value and (not isinstance(value["description"], str) or len(value["description"]) > 800):
        raise ValueError("Situation description must be text up to 800 characters")
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
        if "tags" in view:
            view["tags"] = normalize_tags(view["tags"])
        views.append(view)
    return {"schema": 2, "kind": "layout", "id": digest([name, views])[:24],
            "name": name, "views": views, "synchronization": "none"}


def session_alteration(value, checkpoint=None):
    """Reduce factory snapshots to reusable session intent, never player/preferences."""
    normalized = presentation(value)
    saved = normalized["sessionState"]
    change = {}
    if saved.get("pane") and saved["pane"] != "board":
        change["pane"] = saved["pane"]
    heroes = [hero for team in (checkpoint or {}).get("state", {}).get("teams", {}).values() for hero in team.get("heroes", [])]
    cards = [card for hero in heroes for key in ("hand", "deck", "discard_pile", "played_cards", "spells")
             for card in (hero.get(key) if isinstance(hero.get(key), list) else []) if isinstance(card, dict)]
    for key in ("selectedCard", "inspectedCard"):
        target = saved.get(key)
        if not target or (key == "inspectedCard" and target == saved.get("selectedCard")):
            continue
        if isinstance(target, dict):
            change[key] = copy.deepcopy(target)
            continue
        card = next((c for c in cards if c.get("id") == target), None)
        if card:
            if card.get("color") == "GOLD":
                change[key] = {"role": "gold"}
            elif card.get("color") and card.get("tier") in ("I", "II", "III"):
                change[key] = {"role": "upgrade" if card["tier"] in ("II", "III") else "color",
                               "color": card["color"], "tier": {"I": 1, "II": 2, "III": 3}[card["tier"]]}
                image = card.get("image_id", "")
                if image.endswith(("A", "B")):
                    change[key]["branch"] = image[-1]
    if saved.get("publicSpells") or saved.get("spellBrowserMobile") or ((saved.get("inspectionScript") or {}).get("selectedHeroCard") or {}).get("spells"):
        change["publicSpells"] = True
    return {"schema": 2, "sessionState": change}


def portable_situation(value):
    """Portable game moment; optional factory Presentations stay separate."""
    original = copy.deepcopy(value)
    if "presentations" in original or "slots" in original.get("provenance", {}) or ("schema" in original and original["schema"] != SITUATION_SCHEMA):
        raise ValueError("Port old bundles offline; use independent Situations and Presentation presets")
    if original.get("kind") == "situation":
        validate_situation(original)
        return original
    state = decision_state(original.pop("checkpoint"))
    presets = [original.pop("presentation", None), *original.pop("additionalPresentations", [])]
    suggested = original.pop("suggestedLayout", None)
    original.pop("schema", None)
    record = {**original, "schema": SITUATION_SCHEMA, "kind": "situation",
              "id": original.get("id", digest([original.get("name"), state["id"]])[:12]),
              "decisionStateId": state["id"]}
    validate_situation(record)
    record["decisionState"] = state
    changes = [session_alteration(p, state["checkpoint"]) for p in presets if p is not None]
    record["presentationPresets"] = [{"schema": 2, "id": digest(p)[:24],
        "name": original.get("name", "Presentation") + " — " + str(i + 1), "state": p}
        for i, p in enumerate(changes) if p["sessionState"]]
    if suggested:
        record["suggestedLayout"] = suggested
    return record
