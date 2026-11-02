# Design records and follow-ups

Both plans below are implemented. They retain the decisions and scope that explain
the earlier design; operating instructions and the current Layout-first model live in the linked reference docs.

| Completed work                              | Design record                                       | Current reference                                                                        |
| ------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Comparison desk                             | [Comparison tool](comparison-tool.md)               | [README](../../README.md), [testing](../testing.md)                                      |
| Earlier composed Situations and Review Runs | [State-model refactor](situation-model-refactor.md) | [Terminology](../terminology.md), [storage](../state-model.md), [reviews](../reviews.md) |

## Validation records

These are dated observations, not current operating instructions or proof about
later revisions. Test counts and earlier controller defaults retain their original scope.

- [Original state-model cutover](../validation/state-model-2026-10-22.md)
- [Interface cleanup](../validation/interface-2026-10-22.md)
- [Game-only Situations](../validation/independent-situations-2026-10-22.md)
- [Small Presentation changes](../validation/session-changes-2026-10-22.md)
- [Initial quickstarts](../validation/quickstarts-2026-10-22.md)
- [Detached bot decisions and default synchronization](../validation/detached-bots-2026-10-22.md)

Completed implementation steps are not an active backlog.

## Remaining follow-ups

| Follow-up                             | Scope and completion condition                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical-phone confirmation           | Check preference isolation across review steps, nested inspection restoration, reporting without controls, and hold/drag/vibration on an actual device. Browser emulation has coverage; hardware behavior remains unconfirmed.                                                                  |
| Intermittent browser/service failures | Investigate the observed long mixed-renderer stall and the later blank-document `ERR_NO_BUFFER_SPACE` failure. Their cause has not been established. Rerun `test/review-history-e2e.mjs` on a stable Windows/WSL setup; retain diagnostics and confirm history UI, reruns and edited revisions. |
| Optional: backend revisions per View  | Currently all Views use one configured backend service with independent clones. Supporting different backend commits requires multiple isolated services and checkpoint/protocol compatibility checks. This is outside the completed refactor.                                                  |
