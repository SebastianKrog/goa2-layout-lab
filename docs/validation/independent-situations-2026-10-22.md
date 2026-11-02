# Independent Situations: validation, 2026-10-22

The current [model](../terminology.md) separates game-only Situations, Layouts and
optional Presentation instructions. This supersedes the earlier composed-Situation
validation record.

- Node: 88 passed, 1 intentionally skipped (89 total).
- Python: 52 passed, plus 32 subtests. Exact checkpoint hashes remain unchanged.
- Native surfaces: separate-window controls, input, resize, capture and return pass.
- Real frontend/backend: mixed desktop/mobile Hand intent, clean default reload,
  retained Views, and Main vs working tree pass on an isolated verification desk.
- UI: desktop/390px controls, Review setup and repeated inspections checked.
- Library port: 83 records consolidated to 37 exact game moments; 50 distinct
  Presentation presets preserved separately. Generated suggested Layouts replaced
  by curated primary choices. No new Reviews were generated.
- Separate ID lookup lets explicit current-library reruns find consolidated
  Situations without rewriting historical Review definitions. A regression test
  verifies the original definition bytes remain unchanged.

Original port backups/mapping and test logs live in ignored `.layout-lab/`.
The comparison smoke owns and closes its services; it does not change the frontend
or game-backend branches. Physical-phone hardware was not revalidated in this run.
