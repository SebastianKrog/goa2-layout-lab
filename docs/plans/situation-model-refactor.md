# Completed design: Situations, Layouts and Review Runs

Status: implemented, including the follow-up code-review fixes. See
[validation](../validation/state-model-2026-10-22.md) for completed checks and gaps,
and [remaining follow-ups](README.md#remaining-follow-ups) for work still open.

## Purpose

The Decision State diagram discussed on 2026-10-22 prompted a separation between
a reproducible game moment, its presentation, the running view arrangement and
inspection evidence. The diagram's overlap represents defaults and explicit
overrides rather than duplicate ownership.

The default workflow is one Live working-tree View. Add View copies current
progress and Presentation into an independent clone. View setup uses Start/Cancel;
editing uses Save/Cancel. Existing games survive cancellation and failed staging.

## Decisions

- A Situation composes an exact Decision State reference and a Presentation.
  Multiple Situations may share a checkpoint while showing different menus,
  selections or Viewpoints. Python preserves checkpoint data losslessly.
- Presentation consists of Viewpoint, Session State and supported User State.
  Application defaults resolve below Layout defaults, then the Situation, then
  explicit View overrides. Missing fields inherit; explicit null resets. Follow
  situation removes a Viewpoint override.
- Layouts contain reusable View settings and synchronization, without game progress.
  Renderer and `uiMode` are distinct. Source selections and controller policies
  belong to Views; saved Situations do not start old builds or bots implicitly.
- Restoration seeds supported preferences before startup and applies Session State
  through semantic adapters. It does not submit game actions. Intended/effective
  Presentation and warnings are captured as evidence.
- Review definitions have immutable revisions and stable queue-entry IDs. Each
  Review Run freezes composed Situations, resolved Layout/source evidence, progress
  and reports. Checkpoint identity does not replace queue-entry identity.
- Reruns default to original frozen snapshots. Current-library inputs are explicit;
  edited queues create a new revision and Run. Reports retain capture-time entry
  attribution. Previous/Next updates all participating desk/device Views.
- Review controllers are manual, with synchronization and auto switch disabled.
  Draft reports block navigation. Source collection and persistence complete before
  startup replaces existing views; failures discard staged resources.
- Device links and QR codes remain stable across steps. Device settings are scoped
  to the session and review revision, preserving edits on reload and resetting to
  the next Situation's settings on navigation.

[Terminology](../terminology.md) defines the terms and user flow.
[State storage](../state-model.md) owns schemas, contracts, adapters and factories.
[Review queues](../reviews.md) owns history, navigation, APIs and evidence storage.

## Porting and cutover

The agreed scope retained existing Situations without supporting old runtime
formats. Old report/review history was cleared at cutover rather than migrated.
Legacy parsing is confined to the offline migration tool.

The migration extracted exact Decision States, retained original Situation IDs on
primary variants and allocated deterministic IDs for additional saved Presentations.
View arrangements became separate suggested Layouts. Game-only entries received
explicit Board defaults; missing historical UI state was not claimed as recovered.
Shared/local ownership, folder structure, provenance, original bytes and mappings
were preserved, with unknown data retained as migration metadata.

Dry-run, staged apply, backups, hash checks and rollback protect existing records.
Checkpoint conversion stays in Python to preserve large integers and deterministic
engine state. The cutover verified 158 resulting Situations against their original
checkpoints and restored engine hashes. Runtime imports, factories and examples now
produce only composed records.

See [porting commands and guarantees](../state-model.md#porting-older-situations)
and the [verification record](../validation/state-model-2026-10-22.md).

## Scope boundary

Orchestration, adapters, migration and evidence remain in the lab. No production
frontend/backend changes were required. The lab uses one backend service with
independent game clones; per-View backend revisions remain optional future work.
