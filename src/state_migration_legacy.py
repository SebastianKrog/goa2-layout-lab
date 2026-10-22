"""Offline-only conversion of pre-cutover bundled situations and presets."""
import copy
from state_model import SITUATION_SCHEMA, digest, identifier, presentation, decision_state, validate_situation

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
        composed = presentation(source, **({"viewpoint": viewpoint} if viewpoint is not None else {}))
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
