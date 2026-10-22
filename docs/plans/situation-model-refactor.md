# Refactor plan: Situations, Layouts and Review Runs

Status: implemented. Automated verification complete; physical-phone confirmation
and the observed long-session Vite limitation are recorded below.

Scope update from the user: retain and port existing Situations, but do not support
legacy runtime formats. Existing report/review history may be cleared. Accordingly,
old-format parsing belongs only in the offline porting tool; historical report/API
compatibility and dual runtime readers are not requirements of this cutover.

## Goal

Make a Situation the complete reproducible moment someone should inspect. Separate
that moment from the view arrangement, executable versions and evidence collected
while inspecting it. Keep the default workflow simple: one current working-tree
view, then add views or choose a saved Layout when needed.

This follows the Decision State diagram discussed on 2026-10-22. Its overlapping
areas represent shared defaults and explicit overrides, rather than duplicated
sources of truth. This plan records the agreed interpretation without requiring
the original attachment to understand or implement it.

## Vocabulary and ownership

| Term | Responsibility |
| --- | --- |
| Decision State | Exact resumable engine checkpoint: game data, pending decisions, execution stack, rollback/replay data and required deterministic state. May also represent a useful moment with no pending decision. |
| Session State | Temporary UI state: open menu, selected or inspected card, inspected hero, camera, focus and scroll. Does not advance the engine. |
| User State | Supported persistent UI preferences, such as display options and card sizes. Excludes credentials, game identity and lab orchestration settings. |
| Viewpoint | Player or spectator whose game information is displayed. Keep this term rather than Actor, which could mean the hero currently acting. |
| Presentation | Viewpoint + Session State + User State, describing how to show a Decision State. |
| Situation | A named Decision State reference + Presentation: the complete moment to reproduce. |
| View | A running game/browser instance displaying a Situation with resolved view settings. Each view may advance independently. |
| View settings | Renderer, UI mode, device profile, controller/bot policy, source selections and explicit Presentation overrides for one view. |
| Layout | Reusable arrangement of one or more configured views and their defaults, plus synchronization policy between those views. Contains no game checkpoint. |
| Comparison | Activity of examining views together, with selected backend/frontend/userscript versions. Does not require a special combined state record. |
| Review | Named, ordered list of Situations. The reusable inspection queue. |
| Review Run | One execution of a particular Review revision, with frozen Situation snapshots, resolved Layout and sources, progress and reports. |
| Report | Evidence captured during inspection, associated with its Run and queue entry when applicable. |

A frontend-only card selection belongs to Session State. A submitted card choice
belongs to Decision State. Bots are controllers configured for a View, not part of
a saved Decision State. Synchronization is a relationship between Views, not a
property of a Situation. Auto switch changes the effective Viewpoint at runtime;
it does not rewrite the saved Situation.

## Proposed data boundaries

Introduce explicitly versioned lab records. The following describes ownership,
not final filenames or API field spelling:

```text
Decision State
  id, exact checkpoint, engine compatibility/provenance
Situation
  id, name, folder, decisionStateId
  presentation: viewpoint, sessionState, userState
  optional renderer/UI-specific presentation adapters
Layout
  id, name, view arrangement
  views: settings, defaults, explicit overrides
  synchronization policy
Review
  id, revision, name, ordered entries with stable entry IDs and Situation references
Review Run
  id, reviewId, reviewRevision, optional parentRunId
  frozen entries: Situation metadata + exact Decision State + Presentation
  resolved Layout, source provenance, progress, reports
```

Multiple Situations can share one Decision State. For example, the same pending
choice can be saved with Hand open, Heroes open, or a particular card inspected.
Allow these as separate review entries. Queue identity must not rely on checkpoint
identity; use entry IDs for progress, reports and navigation.

Retain independently saved Presentations as reusable templates. Selecting a template
when saving a Situation captures its resolved values, so later template edits do
not silently change that Situation. Runs similarly freeze their resolved inputs;
editing library records cannot change previous evidence.

Keep renderer (2D/3D) separate from UI mode (desktop/mobile). Offer friendly
Interface presets for valid combinations. Rename the current desktop/mobile
`config.layout` concept to avoid confusing it with a multi-view Layout. Device
profiles describe viewport dimensions and interaction capabilities, including touch
and mobile emulation; a physical device's actual environment is recorded separately.

Backend, frontend and userscript source selections remain independent. A named
Layout may save source defaults, but each Run records the actual resolved commits
and working-tree provenance. Referencing Live must not be reported as a clean
commit when local modifications were used.

## Resolution and restoration rules

Resolve each Presentation field in this order, lowest to highest priority:

1. Supported application/adapter defaults.
2. Layout defaults.
3. Situation Presentation.
4. Explicit View overrides.

Show overrides in the UI, with an easy return to **Follow situation**. In
particular, a Layout's default Viewpoint must not silently replace the Situation's
Viewpoint. Distinguish an unspecified field from an explicit reset/default value.
Define that distinction in the schema before implementing merge behavior.

Restore in a predictable sequence: clone Decision State, resolve Viewpoint and
credentials for the clone, seed supported User State before application startup,
then apply Session State after relevant controls/content mount. Do not replay
generic click traces that might submit game actions. Presentation restoration must
leave the canonical engine state unchanged.

Use explicit adapters/allowlists for User State instead of collecting arbitrary
local storage. Captured preferences must override existing browser preferences
inside the lab instance, including physical devices, without overwriting unrelated
personal settings. Scope overrides to the lab session or restore prior values on
exit. Report unsupported settings, missing heroes/cards and incompatible UI controls;
record intended and effective Presentation separately. Never claim exact restoration
when a fallback was used.

## User flow

- Choose a Situation or Review; keep the current Layout by default.
- Start with one current view. Add view inherits the current moment and settings;
  configure it in the existing Start/Cancel overlay. Edit uses Save/Cancel.
- Choose a saved Layout or adjust interfaces, devices and versions when needed.
- Start inspection. Review Previous/Next restores the next Situation in every
  participating desk and device View, respecting visible explicit overrides.
- Save Situation captures Decision State and Presentation from the chosen View.
  Save Decision State is available for game-only checkpoints. Save Layout captures
  arrangement/settings without game progress. Keep Presentation templates available.
- Review history groups Runs under their Review, with per-run statistics and reports.
  Run again creates a new Run. Edit and run creates a new Review revision and Run.
  Make replaying the original frozen inputs versus using revised library Situations
  explicit; default rerun to the original frozen inputs.

Preserve movable device reporting, stable links/QR codes, draft protection and
all-view navigation. Existing reports remain attached to their capture-time queue
entry even if the user later navigates elsewhere. Keep reviews manual by default;
normal play layouts can use bots and auto switch.

## Port existing situations and saved records

Migration is part of the refactor, including both the curated `situations/` library
and ignored local drafts. Inventory actual schema variants before choosing final
field names or writing conversions. Include imported fixtures and factory output,
independent Presentations and view presets. Historical reports and review snapshots
are cleared rather than ported.

### Conversion rules

| Existing record | Target and handling |
| --- | --- |
| Game-only Situation | Extract an exact Decision State and retain the original Situation ID as a Situation referencing it. Supply an explicitly documented default Presentation: Board, no local selection, and Follow view for unspecified Viewpoint/preferences. Mark absent historical presentation as unspecified, not recovered. |
| Bundled Situation with `presentations` and `provenance.slots` | Extract one Decision State. Convert saved per-view UI state and seats into explicit Presentation variants. Move source/device/controller settings into a separate suggested Layout; never silently activate old revisions or bots. |
| Bundled Situation with several distinct presentations/viewpoints | Preserve every distinct variant as a Situation sharing the Decision State. Keep the old ID on a documented primary variant, allocate deterministic IDs for others, and record the one-to-many mapping. Preserve original bytes in the migration backup; runtime uses only the new records. |
| Independently saved Presentation | Convert storage into supported User State and other UI fields into Session State. Preserve its ID as a template. Associate with a Situation only when an explicit reference exists; do not infer associations from matching names or timestamps. |
| Saved view setup/preset | Convert to a Layout, separating UI mode from arrangement and separating defaults from explicit overrides. Preserve explicit historical seats; expose them as overrides so users can choose Follow situation. |
| Historical review/report records | Clear at cutover as authorized. New Review definitions and Runs use the new model only. |

For ambiguous multi-view bundles, list the available variants in migration output.
Use recorded source/layout/renderer/slot relationships when identifying Presentation
variants. Surface a migration warning when intent cannot be recovered. Preserve
unknown fields as migration metadata and retain original bytes in the backup.

### Migration mechanics

1. Implement the new runtime schema and an explicit offline porting tool. Reject
   old-format runtime imports with a useful error rather than retaining old readers.
2. Provide a dry-run migration command. Inventory shared/local records separately;
   show conversions, variant expansion, ID/reference mappings, unsupported fields,
   ambiguities and errors. Validate IDs, paths and all referenced records.
3. Back up local records and write a migration manifest with source paths, schema
   versions, input/output hashes and reference mappings. Stage new records before
   atomically switching their index/references. Failed migration leaves original
   records usable. Repeated execution must be idempotent, including generated IDs.
4. Perform checkpoint extraction/copying in Python. Never round-trip engine data
   through JavaScript numbers; preserve large integers, RNG state and resumability.
   Only deduplicate checkpoints after lossless equivalence is established. Do not
   merge distinct Presentations merely because the game checkpoint matches.
5. Preserve shared/local ownership, folder structure, names, IDs where possible,
   provenance and promotion behavior. Do not publish ignored drafts or machine paths
   into the shared library. Commit curated conversions separately for review.
6. Clear existing report/review history at cutover as authorized. Preserve Situation
   backups and mappings independently of the report directory.
7. Verify restoration, then update factories/importers and new-save writers. Stop
   producing old bundles. Runtime and UI use only the new schema after conversion.

Porting a game-only Situation cannot recover menus or selections that were never
saved. Clearly report that limitation instead of implying the migration restored
missing information.

## Implementation phases

1. **Contracts:** finalize schemas, unset/reset semantics and precedence. Inventory
   old data and specify new-schema APIs. Add migration fixtures first.
2. **Storage and migration:** introduce Decision State records and composed
   Situations, offline porting, dry-run/apply tooling, manifests and rollback.
3. **Presentation:** split User/Session State and Viewpoint, implement deterministic
   scoped preference restore and semantic adapters. Preserve exact checkpoint copies.
4. **Workspace:** introduce Layout records, rename the UI-mode field, expose Follow
   situation/overrides, and update save/start/add/edit flows without losing progress.
5. **Reviews:** separate definitions/revisions from Runs; freeze explicit composed
   Situations; start fresh history and retain device/report safeguards.
6. **Rollout:** port curated and local situations, update documentation, repository
   skills, factories and API examples. Make terminology.md canonical for the new
   behavior only when it is implemented.
7. **Optional later work:** independent backend commits per View. This needs multiple
   isolated backend services and checkpoint/protocol compatibility checks. The
   current lab uses one backend service with separate game instances per View;
   per-view backend comparison is not a prerequisite for this refactor.

Keep orchestration and migrations in the lab. No production backend/frontend
changes are assumed. If a supported Presentation cannot be restored through existing
adapters, identify the missing bridge separately before expanding implementation
scope. Do not switch or reset the user's regular repository checkouts.

## Acceptance checks

- Two Situations share the same exact Decision State but restore distinct menus,
  selections or Viewpoints without changing engine state.
- Precedence, explicit resets and Follow situation work across desktop/mobile,
  supported 2D/3D renderers and a physical device with existing saved preferences.
- Migration covers game-only, single/multi-view bundles, independent Presentations,
  shared/local drafts, unknown fields and malformed or missing references. Old reports are cleared.
- Dry-run changes nothing; apply is idempotent; interrupted/failed migration and
  rollback preserve originals. Large integers and deterministic engine state survive.
- Ported Situation IDs remain usable. Old runtime formats are rejected. Variant mappings and
  migration warnings are inspectable; unsaved historical UI state is not invented.
- Review reruns preserve original frozen inputs and evidence. Edited revisions can
  add/remove Situations sharing a checkpoint, with stable entry attribution.
- Next/Previous restores every participating View, including devices; drafts block
  destructive navigation and failed staging preserves current views and progress.
- Default one-view startup, Add/Edit/Cancel, independent gameplay, reset, bots,
  synchronization and report capture retain their current guarantees.
- Run evidence records intended/effective Presentation, overrides, actual device
  environment and exact source provenance. Test through the existing Windows browser
  and configured WSL service workflow on this installation.

## Related documentation

- [Current terminology and state boundaries](../terminology.md)
- [Current review queues and evidence](../reviews.md)
- [Current device workflow](../device-testing.md)
- [Original comparison-tool plan](comparison-tool.md)

## Implementation verification (2026-10-22)

The runtime uses composed schema 2 records only. Existing Situations were ported;
report/review history was cleared rather than migrated. Original Situation IDs,
variant mappings and backups remain available. No production frontend or backend
source changes were required; changes are confined to the lab and its adapter.

| Check | Evidence |
| --- | --- |
| Exact checkpoint preservation | 158 resulting Situations checked against original content identities and restored engine hashes; repeat apply unchanged. Local proof: `.layout-lab/state-migration-final.json`. |
| Storage, imports and migration safety | 38 Python tests pass, including large integers, promotion, interrupted apply, rollback and later-edit protection. |
| JavaScript regressions | 54 pass; one native POSIX shutdown test is skipped on Windows. |
| Composed Presentation | `test/state-model-e2e.mjs`: shared Decision State, distinct panes, template copy, Follow/pinned Viewpoint, unchanged engine hash, actual 3D rendering and scoped phone preferences. |
| Workspace | `test/view-workspace-e2e.mjs`: default one View, interface presets, Start/Add/Edit/Cancel, independent clones, equal sizing and separate saves. |
| Review definitions and Runs | `test/review-history-e2e.mjs`: immutable frozen reruns, edited revisions and grouped history. |
| Reporting and navigation | `test/reviews-e2e.mjs`: every participating desk/device View, draft guards, four report types and capture-time entry attribution. |

Browser/device acceptance uses Windows Chromium with WSL services. The phone tests
use mobile/touch emulation against the real device-view server, including an existing
personal preference; they do not confirm a particular physical phone's hardware.
A long mixed 3D/device test run encountered a Vite stall serving game documents.
The focused 3D/preferences and Review suites pass separately. Actual-phone smoke
testing and investigation of prolonged mixed-renderer Vite sessions remain manual
follow-ups, not legacy-format compatibility work.
