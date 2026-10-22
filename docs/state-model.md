# State storage and contracts

Use [terminology and desk flow](terminology.md) for the vocabulary and user-facing
behavior. This document owns persistence, Presentation adapters and offline porting.

## Records and ownership

Situations, Presentations, Layouts, Reviews and Review Runs use schema 2. Decision
States have their own schema 1; this is a separate record type.

```text
library/situations/<folder>/<situation-id>.json
  schema: 2, kind: situation
  decisionStateId: <SHA-256 of exact checkpoint>
  presentation: {schema: 2, viewpoint?, sessionState: {}, userState: {}}
library/decision-states/<hash>.json
  schema: 1, kind: decision-state, id: <hash>, checkpoint: {...}
library/layouts/<layout-id>.json
  schema: 2, kind: layout, views: [...], synchronization: none|api|api-clicks
```

Local records use corresponding folders inside ignored `.layout-lab/`. Local
Situations may reference local or shared Decision States. Shared Situations may
reference only shared Decision States. Promotion copies the checkpoint into the
shared store and removes machine-specific provenance. Python owns lossless
checkpoint serialization, including large integers.

Game-only save names live in the Decision State store's `labels.json`; labels do
not change checkpoint identity. Presentation templates live in
`.layout-lab/presentation-templates.json`. Shared `library/layouts/` and local `.layout-lab/layouts/` files supply
Layouts; `.layout-lab/layouts.json` stores local overrides loaded last. Editing a
file-backed Layout retains its identity and persists only the override.

See [Review storage and evidence](reviews.md#evidence-collection) for immutable
Review revisions, frozen Run inputs and report attribution.

## Presentation contracts and restoration

`src/state-contract.json` defines supported User State keys and temporary Session State
storage prefixes. Python and JavaScript normalize the same fixtures in
`test/presentation-contract.json`. Canonical envelopes reject obsolete versions,
invalid state/value types and storage keys outside those boundaries, including
renderer-specific Session States.

Clone the exact Decision State, resolve the effective Viewpoint, seed supported
preferences before frontend startup, then restore Session State through semantic
controls. Desktop and device transports share `src/presentation-plan.mjs` for ordered
spell-browser and nested inspection restoration. Unsupported controls produce
warnings; restoration must not submit game actions.

Device settings are scoped to the session and review revision. Reloading one step
retains edits; changing steps starts with that Situation's settings and application
defaults. Personal preferences remain separate. Reports share
`presentationResolution` evidence with intended/effective Presentation, explicit
overrides and restoration warnings.

Factory scripts use `portable_situation()` with an explicit canonical
`presentation`, optional `additionalPresentations`, and a separate `suggestedLayout`
from `make_layout()`. Portable exports include one inline Decision State and
optional `additionalSituations` referencing it. The importer persists these in
separate stores. Factories do not assemble legacy per-view bundles.

For Windows Live views, the lab serves existing checkout assets directly to avoid
WSL file-transport overhead. The bounded cache observes file changes, coalesces
concurrent reads and accounts for cached bytes once.

## Porting older situations

The running lab accepts composed Situations only. Older bundles are handled by
`src/migrate_state.py` and its offline `src/state_migration_legacy.py` converter. Run with
the configured backend's Python environment; for example:

```powershell
& ../goa2-backend-bots/.venv/Scripts/python.exe src/migrate_state.py
& ../goa2-backend-bots/.venv/Scripts/python.exe src/migrate_state.py --apply
& ../goa2-backend-bots/.venv/Scripts/python.exe src/migrate_state.py --rollback <transaction-id>
```

The default inventory is read-only. Use `--shared <situations-directory>` and
`--data <lab-data-directory>` for an isolated copy. Close the lab before applying
or rolling back, and avoid concurrent library edits.

The converter preserves exact checkpoints, original IDs on primary variants,
folders and provenance. Distinct saved Presentations become deterministic Situation
variants sharing a Decision State; executable settings become suggested Layouts.
Game-only entries use documented Board defaults without inventing historical UI
state. Unsupported settings and ambiguous variants are reported. Current records
use the runtime Decision State resolver during validation.

Apply validates and stages outputs, backs up changed records, journals hashes,
and publishes Decision States before atomic Situation replacements. Failed applies
roll back completed writes. An interrupted prepared journal blocks another apply
until rolled back. Rollback refuses to overwrite later edits; repeat apply is
idempotent. Backups and mappings live under `.layout-lab/migrations/`.

The completed cutover ported the existing curated library and local drafts.
Report/review history was cleared rather than migrated; no historical report reader
is maintained. See the [dated validation record](validation/state-model-2026-10-22.md)
for results and local evidence locations.

## Verification

- `python -m unittest test.state_model_test test.situations_test test.backend_test`
- `npm test` — includes storage contracts, shared mobile restoration and report fixtures.
- `node test/view-workspace-e2e.mjs` — Start/Add/Edit/Cancel, copies and Reset.
- `node test/reviews-e2e.mjs` — desk/device navigation, drafts and all report types.
- `node test/review-history-e2e.mjs` — history UI, frozen reruns and edited revisions.
- `node test/state-model-e2e.mjs` — composed Presentations, 3D and phone preferences.

Acceptance scripts own and close their services. Use distinct `GOA2_LAB_*_PORT`
values and the configured Windows browser/WSL service workflow on this installation.
See [the testing guide](testing.md) for other runners and
[recorded coverage and gaps](validation/state-model-2026-10-22.md#final-results).
