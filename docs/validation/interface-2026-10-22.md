# Interface review — 2026-10-22

The review covered Compare, Situations, Reviews, Settings and their setup/reporting
dialogs. Baseline: `496e273`. This record describes the working-tree cleanup and
its observed coverage; it does not establish visual parity between game frontends.

## Changes

| Area | Result |
| --- | --- |
| Compare | A compact toolbar keeps reporting, device sharing, Save and Capture available. Workspace tools consolidates Layout loading, synchronization, capture crops, HTML/CSS extraction, reset and closing. Closing tools cancels unapplied Layout changes. |
| Views | Common settings are Situation, Source, Device, Interface and Viewpoint. Optional names, renderer/UI overrides and templates are under Advanced settings. Controllers and individual bot assignments expand on demand. Removal lives in View tools. |
| Situations | Search matches name, hero or folder and composes with existing filters. Selection survives filtering. Rows keep Open visible; More holds secondary actions. Creation/import is grouped under New situation. |
| Reviews | The latest Run is visible; Earlier runs expands history. Core statistics remain visible, with detailed evidence and rerun input choice under Run details and options. A current-library choice remains visible in the summary. |
| Settings | Current build and Live updates come first. Frozen references and runtime/checkout metadata are collapsed. |
| Responsive/native | Narrow windows scroll multiple Views within the workspace. Native surfaces clip to that area while expanded Views retain the full window. Stop remains available while loading. |

Unneeded capture fields and the per-View selector for Layout saves are hidden.
Element-focused CSS extraction is the default; it is enabled only with two Views
selected. Failed operations show feedback inside the active dialog. Reporting drafts, game checkpoints
and production frontend/backend behavior are unchanged.

## Verification

- Full Node suite: 68 passed; one platform-specific skip (69 total).
- Isolated browser checks cover search/selection, secondary menus, crop/extraction
  request bodies, controller settings, rerun inputs, import, recovery and accessibility.
- Screenshots reviewed at 1440, 768 and 390 pixels; reviewed pages/dialogs had no
  horizontal overflow. Save was visible in simplified View settings at each width;
  it was below the fold in the baseline.
- Owned Windows native/WSL workspace acceptance passed Start, Add/Cancel, copying
  and Reset, Edit, saving, equal sizing and removal. Game captures and native surface
  placement were checked separately from the desk's root screenshot.
- Native compositor checks passed isolated storage, device emulation, native input,
  animation (57 frames/second sampled), 100% scrolling and full-size captures.
- Targeted native geometry coverage checks horizontal clipping and expansion.
- After the final dialog-feedback and Layout-cancel adjustments, all 15 focused
  interface, extraction, startup and native-geometry checks passed.

UI fixtures serve the actual public files and shared Situation metadata with mocked
API responses; they leave user games untouched. The old standalone UI command now
runs this maintained suite. Real native acceptance used owned services on distinct
ports and closed them afterward. No production backend/frontend source was edited.

Local evidence: `.layout-lab/reviews/interface-before/`, `interface-after/index.html`,
`interface-after/review.json`, `view-workspace/native/`, and
`.layout-lab/declutter-all-final.log`, `declutter-targeted-final.log`,
`declutter-native-workspace.log`, `declutter-native-clip.log` and
`declutter-native-compositor.log`. Generated evidence is ignored.
