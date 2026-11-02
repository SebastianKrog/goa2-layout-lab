# Small session changes: validation, 2026-10-22

- Shared Presentation presets reduced from 50 snapshots to 8 reusable actions.
- Presets use panels, card roles and View public spells. No named hero/card,
  preferences, renderer, game URL, incidental camera or scroll is captured.
- Review setup/editor and API allow exact card IDs per inspection. Viewpoint is separate.
- Applying a change preserves the existing page/context/game. Unsupported, missing
  or ambiguous targets warn in the lab, separate window/device and report evidence.
- Node suite: 92 passed, 1 skipped (93 total).
- Focused Python factory/port checks: 12 passed, plus 18 subtests.
- Native separate-window/input/capture/animation checks passed.
- Real desktop/mobile frontends: generic Gold selection, in-place Open Hand,
  missing-card warnings and generic public-spell viewing passed.

Logs and the original preset backup are under ignored `.layout-lab/`.
Historical Review definitions and report files were not rewritten. Physical-phone
hardware was not revalidated; browser device emulation was exercised.
