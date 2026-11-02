# Completed design: state separation and porting

This historical design began with the Decision State diagram on 2026-10-22.
Use [terminology](../terminology.md) and [storage contracts](../state-model.md)
for the current implementation.

## Original cutover

The initial refactor separated exact Decision States, executable View settings,
Layouts and Review Run evidence. At that stage a Situation combined a checkpoint
with Viewpoint, Session State and supported User State. It produced 158 composed
Situations, with original bytes, ID mappings, backups and restored-hash checks.
Reports and Review history were cleared at the authorized cutover. These are
historical results, not the current schema or library count.

## Subsequent decisions

- Situations became game-only named Decision State references. Equal-checkpoint
  variants were consolidated into 37 game moments; UI state was extracted separately.
- Presentations became eight small, reusable session changes. Viewpoint is separate;
  preferences, renderer and incidental camera/scroll snapshots are excluded.
- Review entries add optional Viewpoint and Presentation instructions to a Situation.
  Runs freeze snapshots and source evidence; repeated Situations have distinct entries.
- Layouts choose Views before a Situation is loaded. Empty startup offers quickstarts
  and comparisons without opening games. Start/Cancel and Save/Cancel stage changes.
- API synchronization is the default. Browser/UI isolation remains; game groups share
  commands and controller policies. Reviews use manual controllers and disable auto
  switch while retaining the chosen synchronization mode.
- Bot inference moved to a separate lazy service. Normal game backends apply commands;
  stale computations are rejected. No production frontend/backend edits were required.

## Porting boundary

Runtime accepts only the current model. Older inputs are handled offline, with
dry run, backups and exact-state checks. Current ports emit independent Situations
and optional Presentation presets, never new Review entries. Historical definitions
and report evidence are not rewritten by the game-only port. See
[porting commands](../state-model.md#porting-older-situations).

[Validation records](README.md#validation-records) preserve each stage's observed
coverage. [Remaining follow-ups](README.md#remaining-follow-ups) is the active list;
completed migration steps are not a backlog. Multiple backend revisions per View
remain outside this work; all regular clones currently use one configured service.
