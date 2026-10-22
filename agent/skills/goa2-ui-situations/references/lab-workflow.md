# Fabrication, import and handoff

Read this for the concrete lab integration. Recipe-specific engine setup is in recipes.md.

## Locate the runtime

Resolve checkout roots from the workspace/sibling folders and the lab configuration. The lab uses GOA2_LAB_FRONTEND, GOA2_LAB_BACKEND and GOA2_LAB_PATCH overrides. ROOT in src/config.mjs is the frontend checkout; TOOL is the lab. DATA is the lab's ignored .layout-lab directory.

Use the backend's installed Python environment to run a factory, from its checkout with src on PYTHONPATH. Use the configured platform/runtime; Windows UI verification may use the normal WSL backend services. Do not create a Windows environment over a Linux .venv, or run Linux UI test suites to validate a fixture.

For an isolated desk, set all five distinct GOA2*LAB*\*\_PORT variables: DESK, BASE, COMPARATOR, LIVE, BACKEND. Start with --no-auto-load; add --verification for an owned diagnostic instance. Shut down only that owned instance. Avoid full source preparation when a fixture can be produced and imported into an existing authorized desk.

## Executed examples and verification scope

The shared repo library contains the five simple examples under library/situations/cards/{selection,actions,upgrades,defense,discard}/. Inspect library/README.md for their current files and names. The reusable factory is scripts/create-simple-situations.py in the lab repo; run it with the sibling backend's Python environment. It supports --backend and --output, and defaults to ignored .layout-lab/situation-recipes/simple/. It outputs five import envelopes plus manifest.json, including owning slots and the planning selectedCard presentation. It does not start a desk, validate rendering, promote fixtures or commit anything. Import only the five envelopes, not manifest.json.

On 2026-10-18 the five examples were created, saved and reopened in Windows Playwright Chromium, using the normal WSL backend services and three portrait/2D slots: frozen Base a3c5e0a46b35a42cd6e054512ce3dbc6a61a579c; comparator d762c0916d2176bc870a09e0c64d0ef415db523e; and Base plus userscript ad1eed5427b91b8daaebb56c4ceafda01db5f7de. Checks covered phase, request/responder, upgrade tier/count, selectedCard restoration, equal clone hashes, unchanged game hash after arranging selection, hidden Cheats controls and no restore warnings. Local evidence: .layout-lab/simple-situations-acceptance.json and .layout-lab/runtime/simple-library-verification.log. Those files are optional local evidence, not dependencies of the shared library.

This establishes the five fixtures on those sources and viewports. It does not establish desktop/3D presentation, future commits, Snorri/Gydion/Emmitt UI displays or every menu variant. A separate Windows engine-only audit checked Gydion's two faceup outside-book spells with private remaining spellbook; Snorri's partial rune placement restored at slot 2 and completed arrangement active on turn 2; and Emmitt's first-commit planning plus post-reveal SELECT_CARD retrieval. Evidence: .layout-lab/runtime/skill-recipe-audit.json. These checks establish checkpoint/data construction, not rendered UI availability. Those UIs and the menu variants must still be opened and checked when fabricated. Do not report source inspection or skill syntax validation as runtime UI verification.

## Fresh full-map factory pattern

This example prepares Arien's action chooser. It is a construction template, not a new game-rule test. Run an adapted factory only when actually creating the requested situation. Read current signatures before using it on another backend revision.

The Python process needs goa2-backend/src on PYTHONPATH. Pass the lab root as argv[1] and an output JSON filename as argv[2]. Place factories and outputs under the lab's ignored .layout-lab/situation-recipes unless the user wants them versioned elsewhere.

```python
import importlib.util
import json
from pathlib import Path
import sys

from goa2.bootstrap import register_all_effects
from goa2.domain.input import InputRequestType
from goa2.domain.models import CardState, GamePhase
from goa2.engine.handler import push_steps
from goa2.engine.session import GameSession
from goa2.engine.setup import GameSetup
from goa2.engine.steps import ResolveCardStep
from goa2.server.map_paths import resolve_map_path

lab_root = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
register_all_effects()
state = GameSetup.create_game(
    map_path=str(resolve_map_path("forgotten_island")),
    red_heroes=["Arien", "Hanu"],
    blue_heroes=["Brogan", "Tigerclaw"],
    cheats_enabled=False,
    game_type="LONG",
    seed=20261017,
)
hero = state.get_hero("hero_arien")
card = next(c for c in hero.hand if c.id == "noble_blade")
hero.hand.remove(card)
card.state = CardState.UNRESOLVED
card.is_facedown = False
hero.current_turn_card = card
state.phase = GamePhase.RESOLUTION
state.current_actor_id = hero.id
# This is a fresh isolated chooser fixture, not a partially played live game.
state.unresolved_hero_ids = []
push_steps(state, [ResolveCardStep(hero_id=hero.id)])
session = GameSession(state)
result = session.advance()
assert result.input_request is not None
assert result.input_request.request_type == InputRequestType.CHOOSE_ACTION
assert result.input_request.player_id == hero.id

sys.path.insert(0, str(lab_root / "src"))
spec = importlib.util.spec_from_file_location("ui_fixture_lab", lab_root / "src/backend.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
saved = lab.checkpoint(session)
restored, restored_result = lab.restore(saved)
assert restored_result is not None
assert restored_result.input_request is not None
assert restored_result.input_request.request_type == InputRequestType.CHOOSE_ACTION
assert restored_result.input_request.player_id == hero.id
normalized = lab.checkpoint(restored)
again, again_result = lab.restore(normalized)
assert again_result.input_request.request_type == InputRequestType.CHOOSE_ACTION
assert again_result.input_request.player_id == hero.id
assert lab.canonical_hash(normalized["state"]) == lab.canonical_hash(lab.checkpoint(again)["state"])
payload = {
    "schema": lab.SCHEMA,
    "name": "Arien - action chooser - owner",
    "checkpoint": normalized,
    "provenance": {
        "kind": "ui-fabrication",
        "condition": "Choose an action for Noble Blade; no action submitted",
        "seed": 20261017,
    },
    "presentation": lab.compose_presentation({"pane": "board"}, str(hero.id)),
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(lab.portable_situation(payload), indent=2), encoding="utf-8")
```

Do not clear a captured live game's stack/context to adapt this example. Construct a fresh state instead. When continuing through earlier prompts, use InputResponse(request_id=result.input_request.id, selection=...) and keep the returned result; do not use test helpers that bypass the live request-ID contract.

Restoring a waiting step can initialize transient context defaults (this occurred for the defense fixture). Normalize with restore -> checkpoint before requiring idempotent canonical state; retain the expected prompt/responder throughout. Do not demand an identical raw checkpoint before this first normalization.

For planning or a display-only state with no pending step, restore may legitimately return no SessionResult. Validate the phase and visible data instead of demanding an input prompt.

The factory exports a composed Situation through `portable_situation()`. Use an explicit canonical `presentation`, optional `additionalPresentations`, and a separate `suggestedLayout` from `make_layout()`; do not assemble legacy `presentations` or `provenance.slots`. Do not add production save credentials, hand-write opaque IDs, or fake backend_revision. The lab importer supplies the actual situation ID, revision, timestamp and summary.

## Import and load through the public desk

The default desk listens on port 3200; use its actual configured port. Node examples below run from the lab root. Prefer the public API to extracting private backend credentials from processes or logs.

```javascript
import fs from "node:fs/promises";
const origin = "http://127.0.0.1:3200";
async function request(name, body) {
  const response = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || JSON.stringify(value));
  return value;
}
const saved = await request("import", {
  content: await fs.readFile(
    ".layout-lab/situation-recipes/action-chooser.json",
    "utf8",
  ),
});
// Loading replaces the current comparison. Use an owned isolated desk, or
// preserve the user's current moments first when loading into their desk.
const slots = [
  {
    source: "base",
    profile: "portrait",
    render: "2d",
    uiMode: "desktop",
    seat: "hero_arien",
  },
  {
    source: "comparator",
    profile: "portrait",
    render: "2d",
    uiMode: "mobile",
    seat: "hero_arien",
  },
  {
    source: "target",
    profile: "portrait",
    render: "2d",
    uiMode: "desktop",
    seat: "hero_arien",
  },
];
await request("load", { situationId: saved.id, slots });
await request("synchronize", { mode: "none" });
```

The fixed starter route is POST /api/starter. Replay import uses POST /api/import with kind:"replay", the JSONL content and decision:N; N applies exactly N recorded decisions. Do not invent a POST /api/fabricate or /api/set-state route; neither exists.

A load applies the composed Situation's Presentation while retaining the selected Layout. Use explicit View overrides for an intentional different Viewpoint or Session State. Runtime accepts only the new model; old fixtures must be ported offline.

## Presentation and saving

- POST /api/configure: {index, update:{seat,source,profile,render,layout}}. Configure the responder's viewpoint before opening private menus.
- POST /api/pane: {index,pane:"board"|"heroes"|"hand"|"deck"|"log"|"settings"}. Check whether the view really has that panel; desktop adapters can scroll to inline content.
- POST /api/hero: {index,heroId}. The current 3D adapter opens bridge-based hero inspection. The 2D adapter scrolls to the instrumented hero and records focus; it does not itself open the Heroes menu or a hero tooltip. Use /api/pane with pane:"heroes" or the actual UI for that menu.
- For local selection, wait for the requested panel and visible card control, then use the actual control or restorePresentation(page,{render:"2d",pane:"hand",selectedCard:"noble_blade"},slot). This is a JavaScript module adapter, not a public HTTP endpoint. The current adapter waits for native mobile navigation to mount and the card to become visible; check its returned warnings. Confirm capturePresentation().selectedCard after saving and reopening. In planning, a selected card is not yet committed. For pending choices, clicking a card can immediately submit it: do not use generic clicks to manufacture a highlight before saving.
- GET /api/views reports config, presentation, canonical state hash, decision summary and userscript activation. It does not expose all choice options; inspect the owning page's actual **GOA2_LAB_STATE** or the restored factory result when needed.
- POST /api/save {index,name} captures Decision State plus Presentation. Add kind:"decision-state" for game-only state. POST /api/presentation/save {index,name} saves a template; POST /api/presentation/apply {index,id} reapplies it without game progress changes. POST /api/layout/save stores Views and synchronization without a checkpoint.
- Reopen the composed Situation with the intended Layout. Confirm exact meaningful state and panel/selection, not opaque IDs or byte-for-byte equality of newly generated requests.
- GET /export/<situation-id> exports a credential-free saved situation. Treat unsupported presentation warnings as information to classify, not permission to patch missing UI into old sources.

If card markers are absent in every otherwise-rendered hand, check that the current src/instrument.mjs is loaded: it normalizes Windows CRLF line endings before matching CardRow anchors. Restart an already-running desk after adapter-module changes so it uses the updated restoration code. A failure of lab instrumentation is not evidence that the frontend lacks a hand.

Keep inspection intentional: pointer hover during automated selection can also capture inspectedCard. If only a selected hand is intended, move the pointer off the card and wait for hover dismissal before saving; verify the captured presentation rather than silently adding a tooltip to the fixture.

The browser's ordinary localhost page is a streamed preview when native display is in use. Prefer the native desk for visual confirmation of the fabricated situation. Screenshots/diffs are outside this skill.

## Handoff to comparison-image work

Use a small JSON or Markdown record beside the factory. This is a handoff convention, not an existing lab API schema. Include:

- Situation ID/name and portable export/factory paths; backend revision returned by the lab.
- Exact stopping condition: phase, request type/responder when present, key IDs and expected content/options.
- Slots and viewpoint intent: source, shell, renderer, profile, owner/opponent/spectator.
- Per-view presentation and availability: supported, inline-equivalent, unsupported or not-verified, with a reason for missing features.
- Round-trip status and any non-persisted UI state that the image workflow must reapply.

Do not store player tokens or absolute machine-specific checkout paths in the handoff. Do not claim "ready" when the prompt, data or required viewpoint was never loaded. The image workflow can use the saved checkpoint plus these notes without advancing the game again.

## Shared library and local drafts

GET /api/catalog returns situations with origin (library or local) and a relative group path. Shared JSON fixtures live in the repo library/situations/ tree. Save/import creates a local draft under ignored .layout-lab/situations/. POST /api/organize {id,group,shared:false} moves a draft into subfolders. With shared:true it creates a library copy (new ID, draft retained), or moves an existing shared fixture. Use folders such as heroes/snorri/runes or cards/defense. The Situations page provides folder filtering, Move and Add to library. Include the relative library path and new ID in the handoff if promoted.

Promotion currently whitelists provenance fields: kind, timed, decision, clock_fidelity, slots, references, script_checksum and source_slot. Arbitrary condition/seed/factory notes do not survive promotion automatically. Keep the visual contract in a versioned companion document or a deliberately reviewed portable field in the shared JSON, and check the promoted file. The five existing card fixtures carry their contract in provenance.fixture; do not assume another promotion will preserve that extra key.
