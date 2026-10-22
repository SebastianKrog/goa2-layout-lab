# Changelog

Notable changes to GoA2 Layout Lab are recorded here.
Release names use the short display form; [release tracking](docs/releases.md)
defines the corresponding package versions and tags.

## Unreleased

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
