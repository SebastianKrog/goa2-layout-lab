# Lab terminology and saved state

Use these names consistently in UI text, documentation and new APIs.

| Term | One responsibility | Examples |
| --- | --- | --- |
| **Situation** | A reusable game checkpoint, usually at a decision point. | Map, heroes, cards, engine stack, pending decision, rollback/replay data. |
| **View** | One playable panel in the lab, with its own running game instance. | View A and View B can advance independently. |
| **Viewpoint** | Whose game information the view displays. | Arien, Hanu, spectator. Auto switch changes this seat only. |
| **Presentation** | Local UI state that does not advance the game. | Open Hand menu, highlighted card, inspected hero, camera, scroll. |
| **View setup** | Configuration for displaying and controlling views. | Frontend source/revision, device size, renderer, shell, viewpoint, bots, auto switch. |
| **Comparison** | The activity of examining two or more views together. | Comparing working-tree mobile UI with a pinned desktop commit. |

A frontend-only highlighted card is Presentation. A card already committed to the engine is Situation. Camera angle is Presentation; player identity is Viewpoint. A view's running game is mutable; its saved Situation is the starting checkpoint. The backend remains the configured live checkout for the desk, shared as a service, with isolated game instances per view.

## Default and adding views

An empty desk shows one Live working tree view with Desktop/2D settings. No game or historical frontend build starts merely by opening the desk. Press **Start**, choose a situation, adjust settings and press **Start** in the overlay. The regular backend/frontend checkout branches are never switched.

The full-height **Add view** rail sits to the right. Views divide the available width equally. Clicking a panel header or footer makes it the source for the next view. A new panel inherits its setup, current live game checkpoint and current Presentation. The overlay's **Game state** selector defaults to **Current state of view A/B/C**; choosing a saved Situation instead starts from that checkpoint with default UI state. **Start** creates the game; **Cancel**, closing or Escape removes the pending panel without touching running games. The current desk supports up to three views.

**Edit view** opens the same overlay with **Save** and **Cancel**. Keeping current game state preserves the game instance, including progress. Choosing another Situation replaces only that view, after the replacement opens successfully. **Remove** closes only that view. **Reset this view** restores its own starting checkpoint; a view cloned from current progress resets to that progress, not to the older library checkpoint.

## Independent saves

**Save...** offers three explicit kinds:

- **Situation:** game checkpoint from the selected view. Does not capture menus, sources, revision choices or other views.
- **Presentation:** local UI state from the selected view, saved independently in ignored `.layout-lab/presentations.json`. Choose it in a view's Presentation selector. Presentations require a matching 2D/3D renderer and suitable UI/content; adapters return warnings for unsupported controls.
- **View setup:** current view configurations, saved in ignored `.layout-lab/presets.json`. Reuse through **Comparison tools**. It contains no engine checkpoint or Presentation.

Presentation capture is separate from Situation capture. Reproduction recipes should identify a Situation, View setup and optional Presentation explicitly. Reports are evidence bundles: they deliberately record all three plus captured revisions and per-view checkpoints; this does not make those settings part of a Situation's meaning.

## Compatibility

Existing shared/local Situation JSON is retained, including historical `presentations` and `provenance.slots`. Normal loads keep the selected view setup and do not restore these legacy fields. **Comparison tools & legacy saved setups > Restore legacy bundled setup** explicitly reproduces an old combined fixture. No library files are rewritten automatically. Existing `/api/load` with `restoreViews:true` remains supported for agents and older tools.

## API

- `POST /api/views/add {config, fromIndex}` clones a running view's current checkpoint and Presentation. Alternatively `{config, situationId}` starts from a saved checkpoint. Optional `index` replaces exactly that existing view.
- `POST /api/views/remove {index}` removes only that view.
- `POST /api/configure {index,update}` changes setup while preserving progress.
- `POST /api/save {index,name}` saves game state only.
- `POST /api/presentation/save {index,name}` returns an independent Presentation record.
- `POST /api/presentation/apply {index,id}` applies a saved Presentation and updates that view's reset Presentation without changing game state.
- `POST /api/preset {name,slots}` saves a View setup independently.
- `/api/status.windows[]` includes each view's `situationId` and `situationName`. The top-level `situationId` remains the first view's compatibility shorthand.

The lab adapter accepts inline checkpoints when cloning; this is lab-owned orchestration, with no production engine or frontend changes.

## Verification

`test/view-workspace-e2e.mjs` owns an isolated desk and checks default one view, Start/Cancel/Save, independent game cloning, equal widths, preserving existing game IDs/hashes, separate saves and removal. Run with distinct service ports and `GOA2_LAB_DISPLAY=browser` or `embedded`. The regular Node suite covers startup, legacy fixtures, reporting and bot behavior.
