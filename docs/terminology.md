# Lab terminology and saved state

These terms describe the current state model. See [storage and contracts](state-model.md)
for implementation details and the [completed design record](plans/situation-model-refactor.md)
for the refactor decisions.

| Term | One responsibility | Examples |
| --- | --- | --- |
| Decision State | Exact resumable engine checkpoint. | Game data, pending decision, execution stack, rollback/replay and deterministic state. |
| Session State | Temporary UI state that does not advance the game. | Open menu, selected/inspected card, hero inspection, camera, scroll. |
| User State | Supported persistent UI preferences. | Card size, brightness, display and sound settings. |
| Viewpoint | Player or spectator whose information is shown. | Arien, Hanu, spectator; independent of the hero currently acting. |
| Presentation | Viewpoint + Session State + User State. | Snorri viewing Hand with a particular card selected and small cards enabled. |
| Situation | Named Decision State reference + Presentation. | A reproducible moment someone should inspect. Several Situations can share a Decision State. |
| View | One running game/browser instance in the lab. | Views A/B/C can advance independently. |
| View settings | How one View runs and displays its Situation. | Source, renderer, UI mode, device profile, bots, auto switch and explicit overrides. |
| Layout | Reusable arrangement of configured Views and synchronization policy. | One phone view or two equally sized comparison views. Contains no checkpoint. |
| Comparison | Activity of examining Views together with selected versions. | Live mobile versus a pinned desktop commit. |
| Review | Named, ordered inspection queue with immutable revisions. | A collection of Situations to inspect in sequence. |
| Review Run | One execution of a Review revision. | Frozen moments, resolved settings, progress and collected reports. |
| Report | Capture-time evidence, attached to a Run entry when applicable. | Screenshots, element HTML/CSS, comment, actual Presentation and revision information. |

A locally selected card belongs to Session State; a submitted card choice belongs
to Decision State. Bots are View controllers. Auto switch changes the effective
Viewpoint without rewriting the saved Situation. Synchronization relates Views.

## Starting and editing Views

The empty desk defaults to one Live working-tree View, Desktop UI and 2D renderer.
It does not start a game or historical build until **Start**. Choose a Situation
and adjust the overlay, then **Start** or **Cancel**. Sources are prepared without
switching the user's regular repository branches.

The full-height **Add view** rail is on the right. Views share available width
equally. A new View inherits the selected View's current game progress and
Presentation; it does not reset existing games. Start/Cancel creates or removes
the pending panel. **Edit view** uses Save/Cancel. **Reset this view** returns to
that View's own starting Decision State and Presentation. Replacements are prepared
before current Views are retired, so a failed open preserves the current game.

**Interface preset** selects a supported combination of **Renderer** (2D/3D) and
**UI mode** (desktop/mobile). Both fields can also be adjusted separately. These
settings are separate from Layout.
Device profiles specify viewport dimensions and input emulation. Physical devices
retain their actual screen/input environment, which reports capture separately.
The current desk supports one to three Views and one configured backend service
with isolated game instances per View.

## Defaults, Situations and overrides

Resolve each Presentation field from application defaults, then Layout defaults,
then the Situation, then explicit View overrides. **Viewpoint: Follow situation**
removes the Viewpoint override; choosing a player/spectator explicitly pins it.
Missing fields inherit. A JSON null resets a field to its adapter default: Board
for the pane, no selected card, removal of a saved preference, spectator for an
explicitly reset Viewpoint. An unspecified saved Viewpoint follows the View default.

Presentation restores through semantic adapters without submitting game actions.
Unsupported controls produce warnings. Reports distinguish intended and effective
Presentation and record overrides rather than claiming exact restoration after a
fallback. User State uses the supported keys in `state-contract.json`; credentials
and unrelated local storage are excluded. Device preference overrides are scoped
to the tab and review revision. Reloading the same step retains edits; changing steps starts with the saved settings and
application defaults. Personal device preferences remain unchanged.

## Saving and reuse

**Save...** offers:

- **Situation:** exact Decision State plus captured Presentation from the selected View.
- **Decision State:** game-only checkpoint, reusable through **Create from Decision State** in Situations.
- **Presentation template:** reusable Presentation values. Applying a template preserves game progress; it opens a replacement browser context so preferences apply before frontend startup.
- **Layout:** view arrangement/settings/defaults/overrides and synchronization, with no checkpoint.

Create from Decision State optionally copies a Presentation template into a new
Situation. Subsequent edits to that template do not change the saved Situation.
A Run similarly freezes its inputs so library edits do not rewrite previous results.

Shared Situations live under `situations/<folder>/`; their Decision States live
under `decision-states/`. Local drafts and Decision States use the corresponding
folders inside ignored `.layout-lab/`. Decision State IDs are hashes of exact
checkpoint content. Python owns checkpoint serialization and cloning by reference,
including large integers. UI code must not round-trip checkpoints through JS numbers.
Presentation templates live in `.layout-lab/presentation-templates.json`; Layouts
in `.layout-lab/layouts.json` and optional shared/local `layouts/` directories.

## Porting older situations

Runtime accepts composed Situations only. Use the [offline porting tool](state-model.md#porting-older-situations)
for older bundles; it preserves exact Decision States, maps Presentation variants
and separates suggested Layouts. It cannot recover UI state that was never saved.

## API

- `POST /api/views/add {config,fromIndex}` clones current progress and Presentation; `{config,situationId}` starts a saved moment. Optional `index` replaces one View.
- `POST /api/configure {index,update}` changes settings while preserving progress. Use `uiMode`, not `layout`, in View configuration.
- `POST /api/save {index,name,kind?}` saves a Situation; `kind:"decision-state"` saves game-only state.
- `POST /api/situation/compose {decisionStateId,name,presentation?}` creates a Situation from an existing Decision State.
- `POST /api/presentation/save {index,name}` saves a template; `/api/presentation/apply {index,id}` applies its copied state.
- `POST /api/layout/save {name,slots,synchronization?}` saves a Layout. `POST /api/load {situationId,layoutId}` restores a Situation with it; explicit `slots` can configure an ad hoc arrangement.
- `GET /api/catalog` lists Situations, Decision States, templates and Layouts.

See [Review queues and Runs](reviews.md) for inspection and report APIs.
