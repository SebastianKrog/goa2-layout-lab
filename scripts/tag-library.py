"""Suggest consistent tags for the curated library; --apply writes metadata only."""
from pathlib import Path
import argparse
import json
import re
import sys

LAB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LAB / "src"))
from state_model import normalize_tags, decision_state, roster_tags

def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")

def view_tags(view):
    tags = ["source:" + view["source"], "renderer:" + view["render"], "ui:" + view.get("uiMode", "desktop")]
    profile = view.get("profile", "")
    tags.append("device:" + ("phone" if profile in ("portrait", "landscape", "compact") else slug(profile)))
    seat = view.get("overrides", {}).get("viewpoint") or view.get("presentationDefaults", {}).get("viewpoint") or view.get("seat")
    if seat:
        tags.append("viewpoint:" + slug(seat.removeprefix("hero_")))
    if view.get("autoSwitch"):
        tags.append("auto-switch")
    for kind in set(view.get("bots", {}).values()):
        tags.append("bot:" + ("simple" if kind == "heuristic" else kind))
    return normalize_tags([*view.get("tags", []), *tags])

def situation_tags(value, folder):
    tags = ["topic:" + slug(folder.parts[0])] if folder.parts else []
    if len(folder.parts) > 1 and folder.parts[0] != "heroes":
        tags.append("topic:" + slug(folder.parts[-1]))
    elif len(folder.parts) > 2:
        tags.append("topic:" + slug(folder.parts[-1]))
    # Name and folder identify the subject even when the saved viewpoint is a spectator.
    if folder.parts and folder.parts[0] == "heroes" and len(folder.parts) > 1:
        tags.append("hero:" + slug(folder.parts[1]))
    else:
        hero = re.match(r"([A-Za-z]+)(?: - |: )", value["name"])
        if hero:
            tags.append("hero:" + slug(hero.group(1)))
    return normalize_tags([*value.get("tags", []), *tags])

def annotate(root, apply=False):
    changes = {}
    decision_tags = {}
    for file in sorted((root / "situations").rglob("*.json")):
        value = json.loads(file.read_text(encoding="utf-8"))
        tags = situation_tags(value, file.parent.relative_to(root / "situations"))
        shared = decision_tags.setdefault(value["decisionStateId"], set())
        summary = value.get("summary", {})
        if summary.get("phase"):
            shared.add("phase:" + slug(summary["phase"]))
        if summary.get("decision"):
            shared.add("decision:" + slug(summary["decision"]))
        shared.update(tag for tag in tags if tag.startswith("topic:"))
        value["tags"] = tags
        changes[file] = value
    for file in sorted((root / "decision-states").glob("*.json")):
        if file.name == "labels.json":
            continue
        value = json.loads(file.read_text(encoding="utf-8"))
        if decision_state(value["checkpoint"])["id"] != value["id"]:
            raise ValueError("Corrupt checkpoint: " + str(file))
        tags = set(value.get("tags", [])) | decision_tags.get(value["id"], set())
        state = value["checkpoint"]["state"]
        tags.update(roster_tags(state))
        if state.get("phase"):
            tags.add("phase:" + slug(state["phase"]))
        if state.get("time_control"):
            tags.add("timed")
        value["tags"] = normalize_tags(list(tags))
        changes[file] = value
    for file in sorted((root / "layouts").glob("*.json")):
        value = json.loads(file.read_text(encoding="utf-8"))
        for view in value["views"]:
            view["tags"] = view_tags(view)
        tags = {"views:" + str(len(value["views"]))}
        tags.update(tag for view in value["views"] for tag in view["tags"] if tag.startswith(("renderer:", "ui:", "device:")))
        value["tags"] = normalize_tags([*value.get("tags", []), *tags])
        changes[file] = value
    changed = 0
    for file, value in changes.items():
        if value != json.loads(file.read_text(encoding="utf-8")):
            changed += 1
            if apply:
                file.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"records": len(changes), "changed": changed, "applied": apply}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=LAB / "library")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(annotate(args.library.resolve(), args.apply), indent=2))
