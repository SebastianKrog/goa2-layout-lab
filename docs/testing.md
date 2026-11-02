# Testing the layout lab

Run commands from the lab root. Use the configured host/runtime: on this Windows
installation, Windows Chromium/native desk with the configured WSL services.
Preserve developer games. Real acceptance checks submit QA actions/reports; use
an owned desk with the [complete isolated port configuration](setup.md#isolate-an-acceptance-desk)
and stop only its services. Never treat a command listed here as a recorded pass.

## Core checks

```sh
npm test
```

This includes isolated desk UI tests using real public files and mocked API data,
plus contracts, storage, controllers, report management and orchestration. They do
not establish real game rendering or physical-device acceptance.

Run Python checks with the lab source and regular backend available on the import
path. The full suite also needs the maintained bot checkout's classic dependencies
and pytest; use its installed environment rather than adding neural dependencies.
For the default sibling layout, PowerShell:

```powershell
$env:PYTHONPATH = "$PWD/src;$PWD/../goa2-backend-bots/src"
../goa2-backend-bots/.venv/Scripts/python.exe -m pytest test -q
```

On POSIX use `:` between import paths and the configured Python executable.
The full suite needs the bot checkout’s `goa2` package as well as `automata`; do not
put the regular backend ahead of it on this process’s import path.
The regular-backend integration can be checked without the bot environment:

```sh
cd ../goa2-backend
uv run --locked python ../goa2-layout-lab/test/backend_test.py
```

For documentation changes, check relative links, Markdown formatting, code examples
against current routes, and skill frontmatter. Runtime suites are needed when
behavior changes, not to certify prose edits.

## Real workspace and state checks

These scripts start their own desks unless marked **attached** below. Supply
isolated ports even for runners with older built-in port defaults. Use browser
mode for automation; native checks need a display. Preparation can be slow on a
cold cache: check logs before starting another instance.

| Command                                               | Scope                                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `node test/view-workspace-e2e.mjs`                    | Start/Cancel, Add/Edit, current-state copies, Reset and sizing.                                                       |
| `node test/independent-comparison-e2e.mjs`            | Game-only Situation loading, mixed interfaces, separate inspection instructions and Main comparisons.                 |
| `node test/session-changes-e2e.mjs`                   | Generic Gold selection, Open Hand in place, unavailable targets and public spells.                                    |
| `node test/quickstarts-e2e.mjs`                       | Desktop/mobile/device quickstarts and the three Main vs working-tree Layouts; `--comparisons-only` limits scope.      |
| `node test/detached-bots-e2e.mjs`                     | Regular game backend, one separate bot service, shared decisions and desk/device human actions.                       |
| `node test/device-autoswitch-e2e.mjs`                 | Five real phone reloads and planning-commit navigation on one owned game; use the regular backend and isolated ports. |
| `node test/autoswitch-e2e.mjs --display=browser`      | Viewpoint following without extra game actions.                                                                       |
| `node test/reviews-e2e.mjs`                           | Review navigation and report attribution.                                                                             |
| `node test/review-history-e2e.mjs`                    | History, frozen/current-library reruns and edited revisions.                                                          |
| `node test/element-report-e2e.mjs --display=embedded` | Native picker, div images, HTML/CSS and report persistence; browser mode also supported.                              |
| `npm run test:native`                                 | Native surfaces, input, animation, storage isolation and separate-window control relay.                               |
| `npm run test:native-e2e`                             | Real game pages in the native desk.                                                                                   |
| `npm run test:streams`                                | Streamed input using isolated browser fixtures; no game backend.                                                      |

Quickstarts now use BLUE ISMCTS opponents with heuristic policy/value and default
search settings. Set `GOA2_LAB_BACKEND` to the regular checkout and
`GOA2_LAB_BOT_BACKEND` to the separate maintained bot checkout. Supplying the bot
checkout as the frontend's game backend no longer describes the architecture.
Main without a native mobile shell retains phone dimensions, falls back to desktop
and records a warning. Game synchronization defaults to API; menus remain independent.

### Attached acceptance runners

The following checks use an already running owned desk and may replace its games.
For marked verification runners start it with:

```sh
npm run compare -- --headless --no-open --no-auto-load --verification
```

Use the same ports/runtime in the second terminal. `npm run test:e2e`,
`npm run test:embedded` and `npm run test:sync` attach to that verification desk.
The general acceptance writes `.layout-lab/acceptance.json`; its temporary Live CSS
probe restores the original bytes. `npm run test:ui` now runs the isolated desk UI
suite and requires no game services.

`node test/device-e2e.mjs`, `npm run test:device-bots` and
`node test/play-bots-e2e.mjs` also use an owned running desk. They submit QA reports
or moves and can leave a test share ready. The play-bots runner requires an empty
desk and covers one View, mixed policies, manual switching and independent games.
Use [device verification](device-testing.md#verification) for their exact effects.

## Frontend regression runners

These use real checkpoints and the configured frontend, usually Live versus the
pinned userscript Target. Each owns its diagnostic services. Source settings and
Presentation instructions belong to the runner; shared Situations store game only.
Inspect output images before claiming parity. Commands use `npm run <name>`.

| Script name                     | Focus                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `test:mobile-confirm`           | Upgrade Commit/legacy Confirm hit targets and one accepted submission.                    |
| `test:mobile-gameplay`          | Real card actions, Gydion spells, Snorri runes and Emmitt second-card planning.           |
| `test:mobile-presentation`      | Public spells, counters, nested inspection, runes and piece markers.                      |
| `test:mobile-deck`              | Tree/List/Grid, local plans, selection and owner/spectator visibility.                    |
| `test:mobile-visual`            | Deck/shared-card readers and original-size paired screenshots.                            |
| `test:mobile-roster-visual`     | Hero boards, rune slots/history and crowded public indicators.                            |
| `test:mobile-spells-visual`     | Large/Image spell readers; `--rank4` focuses public Wish.                                 |
| `test:mobile-ready-visual`      | Ready controls and clock UI.                                                              |
| `test:mobile-shell-visual`      | Paused, suspended and completed match displays.                                           |
| `test:mobile-special-visual`    | Emmitt, starting positions, reconnect and long-card content.                              |
| `test:mobile-card-fallback`     | Intentional missing-artwork faults, explicitly labelled in evidence.                      |
| `test:mobile-status-visual`     | Ten-hero waiting ticker, reduced motion and Board rows; `--status-only` focuses status.   |
| `test:mobile-decision-visual`   | Defense, discard, spell/gold choices and supplementary details.                           |
| `test:mobile-resolution-visual` | Teammate initiative choice, order labels and Board/Heroes inspection.                     |
| `test:mobile-library-reopen`    | Explicit runner sources/seats/instructions and restored pending decisions.                |
| `test:mobile-turn-state-visual` | Completed/unqueued/off-board heroes; `--case=emmitt-two-commits` focuses Emmitt.          |
| `test:mobile-batches`           | Hypothetical Preview, batch upgrade/rune staging, Commit and recovery.                    |
| `test:mobile-upgrade-parity`    | Small-card visual states, artwork/styles, hover/focus and pixel evidence.                 |
| `test:mobile-card-visual`       | Artwork/mask/blur and selected-source animations; `--selected` focuses sheen.             |
| `test:mobile-camera`            | Native 2D focus, gestures, rotation, fit and one real movement target.                    |
| `test:mobile-utilities`         | Preferences, fullscreen, Decisions route and layered inspection.                          |
| `test:mobile-elements`          | Focused mobile element auditing.                                                          |
| `test:element-tools`            | Selector crops, Individual/Combine, focused/whole-page source export and offline viewers. |

Use `-- --help` only where implemented; read each runner's argument parser before
assuming a common filter. Batch/upgrade parity support `-- --profile=portrait`
(or `compact,landscape`). Several visual runners accept `-- --case=...`; these
filters are runner-specific. Whole-page CSS collection is reserved for concrete
whole-document questions. The deliberate artwork-fault runner uses its own raw
capture path; ordinary exporters still reject missing assets.

## Evidence and limits

Generated files live under ignored `.layout-lab/reviews/`, `.layout-lab/reports/`
and `.layout-lab/runtime/`. Retain exact source revisions/dirty status, effective
settings, checkpoint hashes, warnings and intended inspection alongside images.
UI snapshots captured as evidence are broader than reusable Presentation changes.
Frozen wall time does not stop animation frames or networking. Native mode is the
reference for interactive animations; browser desk previews are streamed JPEGs.

[Validation records](plans/README.md#validation-records) preserve dated results,
including the earlier Simple/attached-backend quickstarts. They are not current
instructions or evidence that later defaults were exercised end to end. Browser
phone emulation does not establish physical iOS/Android gestures, haptics or
network acceptance. Open gaps are tracked in [remaining follow-ups](plans/README.md#remaining-follow-ups).
