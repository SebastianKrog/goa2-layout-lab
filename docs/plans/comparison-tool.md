# Completed design: GoA2 comparison desk

Status: implemented in the standalone `goa2-layout-lab` repository. This record
summarizes the original comparison design; use the [README](../../README.md) for
current setup, ports, launch options and operation. The later
[state-model refactor](situation-model-refactor.md) supersedes bundled Situation
and saved-preset concepts from the original design.

## Decisions

- Support one to three independent playable Views, including duplicate sources,
  different player/spectator Viewpoints and desktop/mobile device profiles.
- Keep committed Base and Comparator builds in ignored caches without switching
  working branches. Target is pinned Base plus the pinned userscript. Live uses
  the current working tree with hot reload and records its mutable provenance.
- Resolve Comparator to an exact commit at launch or refresh; existing sessions
  do not silently follow branch updates. Frozen references are launch settings.
- Use isolated browser contexts and game clones, fresh tokens, normal game pages
  and player-scoped APIs. Reset replaces only the selected View's starting moment.
- Keep tooling, dependencies and lab adapters in this repository. The default
  Windows workflow uses a local native Chromium desk with WSL services; native
  Linux/macOS and optional browser/separate-window modes remain available.
- Render native game surfaces directly for animation and input. Fit/100%/Expand
  changes display scale without changing emulated viewport dimensions. Browser
  JPEG streaming is an alternative for static layout work.
- Capture and restore camera/UI state through lab-only instrumentation and
  semantic controls. Frozen wall time preserves networking, animation frames and
  UI timers. Unsupported features and missing assets produce visible failures.
- Export original screenshots, combined images and compatible pairwise overlays/
  diffs with state, Viewpoint, device and source attribution. Unequal viewports,
  intentional camera/seat differences and divergent game states remain explicit.
- Launch only required sources on dedicated configurable ports. Stop only owned
  processes and preserve regular development servers.

Situations now reference separate Decision States and include one composed
Presentation. Reusable arrangements are Layouts; Reviews and Runs collect ordered
inspection evidence. See [canonical terminology](../terminology.md) and
[storage contracts](../state-model.md).

## Original reference selection

The initial comparison froze frontend Base
`a3c5e0a46b35a42cd6e054512ce3dbc6a61a579c` and userscript
`ad1eed5427b91b8daaebb56c4ceafda01db5f7de` (v1.3.0). The first Comparator used the
M0/M1 migration work originating from frontend commits
`a973ade16d3c408e9b3aa5fefaf0e951c6625117` and
`4ba668e01282c6d299a5059869dbabacc0d404e2`. These identify the original design's
baseline, not a promise about future defaults. Configuration and each report's
resolved source evidence determine what a current session actually uses.

The original Mobile migration, Layout regression and 3D regression arrangements
remain available as reusable choices. Empty startup now defaults to one Live View;
loading a saved Situation does not silently restore a historical arrangement.

## Verification and subsequent work

The [testing guide](../testing.md) describes runnable checks and evidence locations.
The [state-model validation record](../validation/state-model-2026-10-22.md)
distinguishes observed results from coverage gaps. Open work is listed once under
[remaining follow-ups](README.md#remaining-follow-ups).
