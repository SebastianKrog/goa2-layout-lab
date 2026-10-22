# State model and migration

The model uses schema 2 Situations, Presentations, Layouts, Reviews and Review Runs.
Decision State records have their own schema 1 and content-addressed identity; that
is a different record type, not support for old Situation versions.

```text
situations/<folder>/<situation-id>.json
  schema: 2, kind: situation
  decisionStateId: <SHA-256 of exact checkpoint>
  presentation: {schema: 2, viewpoint?, sessionState: {}, userState: {}}
decision-states/<hash>.json
  schema: 1, kind: decision-state, id: <hash>, checkpoint: {...}
layouts/<layout-id>.json
  schema: 2, kind: layout, views: [...], synchronization: none|api|api-clicks
```

Local records use `.layout-lab/situations/`, `.layout-lab/decision-states/` and
`.layout-lab/layouts/`. The name assigned to a game-only save is kept in that
Decision State store's `labels.json`; it does not change checkpoint identity.
Promotion copies the Decision State into the shared store and removes machine-only
metadata. Shared Situations cannot depend on ignored local Decision States.

Run `migrate_state.py` with the configured backend's Python environment. The default
command is read-only:

```powershell
& ../goa2-backend-bots/.venv/Scripts/python.exe migrate_state.py
& ../goa2-backend-bots/.venv/Scripts/python.exe migrate_state.py --apply
& ../goa2-backend-bots/.venv/Scripts/python.exe migrate_state.py --rollback <transaction-id>
```

Use `--shared <situations-directory>` and `--data <lab-data-directory>` for an
isolated copy. Avoid concurrent library edits while applying. The inventory shows
shared/local mappings, deterministic variant IDs, suggested Layouts, warnings and
validation errors. Game-only records have no recoverable historical UI selection;
that limitation is recorded. Supported preferences are extracted into User State;
unknown storage settings are reported, not activated.

Apply validates first, stages outputs, backs up changed records and journals their
hashes before publishing Decision States followed by atomic Situation reference
replacements. Failed applies roll back completed writes. A prepared journal left
by interruption blocks another apply until explicitly rolled back. Rollback checks
all output hashes first and refuses to overwrite subsequent edits. Repeated apply
is idempotent. Old-format input is handled only by this offline tool; the running
lab requires composed Situations.

The cutover converted the curated library and local drafts and verified that every
resulting variant retains its exact checkpoint and restores to the original
canonical engine hash. Evidence and transaction IDs are local in
`.layout-lab/state-migration-verification.json`, `state-migration-applied.json` and
`state-model-cutover.json`. These files and backups are not shared fixtures.
Report/review history was cleared as authorized; it is not migrated.

Factory outputs use `portable_situation()` to export composed records with inline
Decision State bundles and optional `additionalSituations`. Variants share the
checkpoint; executable settings are separate suggested Layouts. The importer copies
the bundle into the local stores. No factory or import should write old Situation
schemas into the runtime library.

For Live views on Windows, the lab serves existing public asset bytes and the
frontend's archived hero-model route directly from the checkout. The bounded cache
checks file timestamps/sizes so edits are refreshed. This avoids slow WSL file
transport for large 3D resources; product code and pinned-build assets are unchanged.

## Verification

- Python: `python -m unittest test.state_model_test test.situations_test test.backend_test`
- Node/browser regressions: `npm test`
- Owned desktop workflow: `node test/view-workspace-e2e.mjs`
- Owned review/device workflow: `node test/reviews-e2e.mjs`
- Review history/revisions: `node test/review-history-e2e.mjs`
- Composed model, 3D and phone preferences: `node test/state-model-e2e.mjs`

Set distinct `GOA2_LAB_*_PORT` values for acceptance instances and use Windows
browsers with the configured WSL services on this installation. These scripts close
only their owned services. Automated device checks use mobile/touch Chromium against the device-view server
with existing preferences. Confirm a particular physical phone separately. The
refactor plan records the observed long-session Vite limitation.
