# State-model refactor validation — 2026-10-22

This is a dated verification record, not an operating guide or a claim about
later source revisions. See [the current contracts](../state-model.md),
[testing instructions](../testing.md) and [remaining follow-ups](../plans/README.md#remaining-follow-ups).

## Cutover

The curated library and local drafts were ported into 158 composed Situations.
Checkpoint identities and restored engine hashes matched the originals; repeat
apply was unchanged. Original IDs, variant mappings and backups were retained.
Local evidence includes `.layout-lab/state-migration-final.json`,
`state-migration-verification.json`, `state-migration-applied.json` and
`state-model-cutover.json`. These ignored files are optional evidence, not shared
fixture dependencies. Report/review history was cleared at the authorized cutover.

Focused composed-model checks exercised distinct Presentations on a shared Decision
State, templates, Follow/pinned Viewpoint, unchanged engine hashes, actual 3D
rendering and scoped phone preferences. A longer mixed-renderer run stalled while
serving game documents; this does not establish a cause for later network errors.

## Follow-up fixes

The follow-up review fixes the following state boundaries:

| Area                    | Behavior and regression coverage                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout persistence      | Local edits override file-backed Layouts after restart, preserve identity and store only edited overrides. `test/state-model.test.mjs`.                                                           |
| Device preferences      | A reload retains edits within one revision; each review step starts with its saved settings and defaults. Personal preferences remain separate. Same test file.                                   |
| Current-state copies    | Add View captures the effective Viewpoint alongside UI state; Reset retains that starting Viewpoint. `test/view-workspace-e2e.mjs`.                                                               |
| Frozen device inputs    | New device views and roster options use the active Run snapshot. Missing frozen inputs fail instead of falling back to the library. `test/backend_test.py`, `test/mobile-restoration.test.mjs`.   |
| Mobile restoration      | Desktop and device transports share one ordered plan for public spells, parent/child inspection and decision-context inspection. `test/mobile-restoration.test.mjs`.                              |
| Presentation validation | Both runtimes use shared contract fixtures, reject obsolete versions and invalid envelopes, and enforce storage boundaries including renderer-specific states. `test/presentation-contract.json`. |
| Review startup          | Provenance, definition and Run persistence complete before replacing views. Failed starts clean up staged views, snapshots and new definitions. `test/reviews.test.mjs`.                          |
| Migration resolution    | Local Situations resolve local or shared Decision States through the runtime resolver; inventory remains read-only. `test/state_model_test.py`.                                                   |
| Asset concurrency       | Concurrent misses share a read and keep cache byte accounting exact. `test/state-model.test.mjs`.                                                                                                 |
| Report evidence         | Image, element, device and HTML/CSS reports share intended/effective Presentation evidence, overrides and warnings. `test/source-inspection.test.mjs`.                                            |

Legacy per-view factory assembly and the preset mutation alias were removed.
The offline converter lives in `src/state_migration_legacy.py`; factories and their
workflow examples use canonical inputs. Older acceptance recipes now use explicit
View overrides instead of legacy Situation bundles. The workspace regression also
covers status polling while a new View's roster is loading, preserving its draft.

## Final results

- Node suite: 61 passed; one POSIX service-shutdown test skipped on Windows.
- Python integration suite: 42 passed; shared contract and rollback regressions
  also passed after final validation/cleanup adjustments.
- All four factories generated 32 bundles / 48 Situation variants and round-tripped
  through the runtime store and read-only migration inventory.
- Windows Chromium: workspace workflow (including delayed roster polling and
  copied Viewpoint Reset), shared mobile restoration, and the full review/device
  workflow with all four report types passed against owned services.
- The separate review-history browser attempt received a blank document with
  Chromium `ERR_NO_BUFFER_SPACE` before game state arrived. It rolled back the
  attempted Run. Frozen reruns and edited revisions pass the unit regressions;
  that browser attempt does not establish history UI acceptance for this change.

Local logs are `.layout-lab/fix-all-node-final.log`, `fix-all-python.log`,
`fix-contract-final.log`, `fix-review-rollback-final.log`, `fix-workspace.log`,
`fix-mobile.log`, `fix-history.log` and `fix-reviews.log`. Acceptance services were
closed after each run; the regular development servers were left running.
