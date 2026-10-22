# Design records and follow-ups

Both plans below are implemented. They retain the decisions and scope that explain
the current design; operating instructions live in the linked reference docs.

| Completed work | Design record | Current reference |
| --- | --- | --- |
| Comparison desk | [Comparison tool](comparison-tool.md) | [README](../../README.md), [testing](../testing.md) |
| Composed Situations and Review Runs | [State-model refactor](situation-model-refactor.md) | [Terminology](../terminology.md), [storage](../state-model.md), [reviews](../reviews.md) |

See [the dated validation record](../validation/state-model-2026-10-22.md) for
coverage, evidence and the most recent verification gap. Completed implementation
steps are not an active backlog.

## Remaining follow-ups

| Follow-up | Scope and completion condition |
| --- | --- |
| Physical-phone confirmation | Check preference isolation across review steps, nested inspection restoration, reporting without controls, and hold/drag/vibration on an actual device. Browser emulation has coverage; hardware behavior remains unconfirmed. |
| Intermittent browser/service failures | Investigate the observed long mixed-renderer stall and the later blank-document `ERR_NO_BUFFER_SPACE` failure. Their cause has not been established. Rerun `test/review-history-e2e.mjs` on a stable Windows/WSL setup; retain diagnostics and confirm history UI, reruns and edited revisions. |
| Optional: backend revisions per View | Currently all Views use one configured backend service with independent clones. Supporting different backend commits requires multiple isolated services and checkpoint/protocol compatibility checks. This is outside the completed refactor. |
