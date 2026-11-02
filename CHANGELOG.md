# Changelog

Notable changes to GoA2 Layout Lab are recorded here.
Release names use the short display form; [release tracking](docs/releases.md)
defines the corresponding package versions and tags.

## Unreleased

- Layout-first loading with curated desktop/mobile comparisons and a Main frontend source.
- Game-only Situations, independent Presentation presets, explicit Review entries and comparison CLI.
- Ported the library to 37 game moments, preserving old UI setups separately without creating Reviews.

Planned for **1.0.1**.

### Changed

- Bot policies are detached from frontend game backends. One separate service
  computes each decision and the lab applies it across synchronized clones.
- API synchronization is the default, including bot games and linked devices;
  separate play sessions keep distinct groups. Stale bot results are discarded.

- Presentation presets are small session changes, with eight curated actions including
  generic card roles and View public spells. Exact cards remain available on Review entries.
- Applying a Presentation preserves the running View and game; unsupported targets show warnings.

### Added

- Empty start screen with Desktop, Mobile portrait and Device working-tree 2v2
  quickstarts, ISMCTS opponents and human-team autoswitch, including on devices.
- Main vs working tree comparison shortcuts for two desktop, mobile portrait or
  mobile landscape Views; choose a Situation before opening them.

- Reports tab with search, activity/type filters, capture timestamps, Review Run
  and Lab session groups. New session controls stay in Settings.
- Persistent archives and Restore/Archive all actions for Reports and Reviews;
  confirmed Delete/Delete archive actions keep Review counts and links in sync.
- Compact Review history rows and timestamps in new and existing device viewers.

- Compact Situation rows with content-based names, expandable descriptions, and
  thin category-colored tags beside each name. Tags collapse only when needed.
- Full-roster hero tags, including opponents and off-board heroes.
- View editors positioned over their View, including inside separate windows;
  detached titles move with the View and no desk space is reserved for them.
  Editors open from cached desk data while roster details load in the background.
  Roster requests are shared/cached and use lightweight checkpoint metadata.

- Per-View **More… → Swap with View …** actions to rearrange the desk without
  restarting games or moving separate windows.

- Separate View windows for multiple screens, retaining View-specific controls,
  game state and Review navigation. Closing a window returns the View to the lab.

- Repository skill for preparing UI-change Review Runs from existing library
  Situations, with verified additions for missing coverage.

- Tags for Situations, Decision States, saved View settings, and Layouts.
- Combined Situation tag filters, tag search, compact chips, and metadata editing
  in existing dialogs. Filters include inherited Decision State tags and retain
  Review selections outside the current filter.
- Initial factual tags throughout the library, with a repeatable dry-run/apply
  helper. Checkpoint contents and Decision State IDs are unchanged.
- Tag validation, storage, export/import, promotion, and UI regression coverage.

### Fixed

- Device auto-switch repairs stale player URLs and resumes polling after phone
  background/history restoration, preserving the current game and report drafts.
- Preserve runtime game groups across Reset, restrict mirrored UI clicks to their
  group, and keep frontend services used by active device shares.
- Reject conflicting controllers before Add View and apply controller edits only
  after successful staging, preserving existing games on failure.
- Carry exact engine JSON through bot/device transports without rounding large
  integers. Review Runs now freeze and restore their synchronization policy.

## 1.0 — 2026-10-22

First stable release, including the complete 1.0-preview feature set.

### Changed

- Group shared Situations, Layouts, and Decision States under `library/` and
  replace the long Situation catalog README with a concise library guide.
- Move lab implementation and the shared state contract into `src/`.
  Keep the small root launcher compatible with npm and sibling VS Code tasks.
- Update runtime paths, factory scripts, tests, documentation, and repository
  skills for the new structure. Saved library JSON content is unchanged.
- Track the stable package version as `1.0.0`.

### Verification

- 68 Node tests passed; one platform-specific test skipped.
- 43 Python tests passed.
- Native workspace acceptance and the five-example Situation factory passed.
- All 155 moved library JSON files retained identical contents.

## 1.0-preview — 2026-10-22

First tracked preview release. Earlier development is included in this baseline.

### Added

- One to three independent Views with live frontend updates, pinned revisions,
  userscript comparisons, 2D/3D renderers, and device profiles.
- Reproducible Situations composed from exact Decision States and Presentation,
  with separate Layouts and reusable Presentation templates.
- Physical-device links and QR codes, movable reporting controls, and Random,
  Simple, or ISMCTS bot controllers without neural-network setup.
- Ordered Review queues, frozen Runs, history, reruns, and edited queue revisions.
- Screenshots, element selection across Views, HTML/CSS extraction, comments,
  revision evidence, and report collections per Review Run.
- Native Chromium game surfaces, browser desk mode, and isolated lab services.
- README images of the current interface and approved Decision State diagram.

### Changed

- Simplified the workspace toolbar, View settings, Situation actions, Review
  history, and responsive layouts.
- Separated saved game moments from executable View settings; ported the existing
  Situation library to the composed state model.
- Split the detailed README instructions into setup, workspace, and capture guides.

### Fixed

- State isolation, report/review attribution, persistence, and Presentation
  restoration issues found during the state-model review.
- Native View clipping at workspace bounds and visibility of controls on narrow
  screens.

### Preview scope

- Up to three desk Views share one configured backend service with isolated games.
- Backend bot support is required for bot controllers.
- Native mode is the intended environment for animation and interactive rendering;
  browser mode uses streamed previews.
- Runtime accepts the current state model. Older Situations use the offline
  porting tool; legacy report formats are not supported.
