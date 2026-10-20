# GoA2 comparison desk

Play two or three independent copies of one saved situation inside the desk.
Linux and macOS run the desk, Chromium, Vite and the isolated backend natively.
Windows runs the desk and emulated browsers locally and services in WSL. The regular
development servers on ports 3000/8000 are separate.

For agent work, start with [AGENTS.md](AGENTS.md) and the repository skills it links.

## Repository layout

```text
GitHub/
  goa2-layout-lab/          # this standalone tool, dependencies and local data
  goa2-frontend/            # Git revisions, models and live working tree
  goa2-backend/             # game engine
  goa2-mobile-2d-patch/     # optional userscript target
```

The lab does not need to be inside the frontend checkout. The shared situation library lives in tracked `situations/` folders. Local drafts,
reports and backend recovery files stay in this repo's ignored `.layout-lab/`
directory. Native Linux/macOS also keep service caches there. The Windows-to-WSL
adapter keeps service caches on WSL's Linux filesystem as described below.
Live-view Vite dependency caches use the frontend's ignored `node_modules/`.

## Start

From the layout-lab repository on Linux, macOS, Windows or WSL:

```sh
npm run compare
```

The launcher installs the tool's dev dependencies in
`node_modules`, separate from the frontend's dependencies.
The native desk downloads Electron for the current OS and architecture on first use.
Electron renders each game directly in its own Chromium view. Hardware WebGL is preferred;
software WebGL fallback is enabled for these local checkouts on VMs or systems without usable GPU acceleration.
For responsive desktop 3D comparisons, use hardware acceleration; software rendering can be slow under WSLg. Browser and separate-window
modes install Playwright Chromium when needed. To install that browser for tests explicitly:

```sh
node node_modules/playwright/cli.js install chromium
```

The VS Code task **Layout lab: Start** runs the same command.
The desk opens at **http://localhost:3200** with no situation loaded. Select a
situation and press **Load** when ready. Starting the desk alone does not prepare
frontend sources or create game clones. To load one explicitly at startup, use
`npm run compare -- --situation=<saved-situation-id>`; `--preset` selects its views.
The situation ID is in its JSON file or the desk catalog.

The first explicit load extracts the pinned Git
sources, verifies/copies model assets, and installs each version's locked
dependencies. Source caches are separated by runtime/platform/architecture.
Subsequent launches reuse those caches. Native Linux/macOS use
`.layout-lab/cache` and a backend uv environment under `.layout-lab/runtime`.

Committed sources with identical package files and npm settings reuse a completed
dependency installation from another cached commit, provided its platform,
architecture and Node ABI match. Live checkouts, local/workspace dependencies
and root install hooks keep separate installs. Each source retains its own Vite
optimization cache. Existing caches become eligible after their next load.

The backend's uv environment is already persistent; engine source changes are
picked up on restart. Chromium and the backend start concurrently. The lab backend
starts with an empty game registry instead of restoring old comparison clones.
Saved situations and old runtime recovery saves are retained, and active clones
still autosave normally. This avoids startup work growing with past comparisons.

Views load concurrently and share preparation when they use the same source.
The lab uses Vite directly with a same-origin HTTP/WebSocket proxy to its isolated
backend; it does not start Cloudflare worker emulators. Game-state, camera, font
and asset readiness checks still run before a view is ready. The desk catalog
contains situation metadata and saved presentation setup; full checkpoints are
loaded only for game operations and exports. Production Worker behavior should
be checked in the frontend project itself.

Prerequisites on Linux/macOS: Node 22.12+ and npm, Git, `tar`, uv, and the
`goa2-frontend`, `goa2-backend` and (for Target views) `goa2-mobile-2d-patch` checkouts alongside this repository.
Node/npm/uv are resolved through your PATH, including nvm or Homebrew installs.
Alternatively set `GOA2_LAB_FRONTEND`, `GOA2_LAB_BACKEND` and `GOA2_LAB_PATCH` to their checkout paths. Relative overrides resolve from the launch working directory.
Prepare missing frontend models with
`npm run models:prepare` in the frontend checkout before starting. The desk never downloads Git LFS
history or switches your working branch.

On Linux, Chromium also needs system libraries. If Playwright reports missing
libraries, install them using its supported distribution setup:

```sh
node node_modules/playwright/cli.js install-deps chromium
```

This may require sudo. On a server without a desktop, use
`npm run compare -- --headless --no-open`; access the desk using localhost or an
SSH port forward to port 3200. Browser mode needs no display on the service host. The default native desk and separate game windows require a desktop display.

On Windows, install Node and Git on Windows, and Node/npm/uv inside WSL.
The default WSL distribution is Ubuntu; override it with `GOA2_LAB_WSL_DISTRO`.
The local Linux Node installation at `~/.local/share/goa2-node/bin` remains
supported. Running from a **WSL terminal defaults to native Linux**, with no
Windows Node/browser dependency. To explicitly use the Windows browser runtime:

```sh
npm run compare -- --runtime=wsl
```

The Windows-to-WSL adapter automatically stores committed frontend sources,
their `node_modules` and Vite caches, backend source snapshots, the backend uv
environment and Python bytecode in:

```text
~/.cache/goa2-layout-lab/<lab-checkout-hash>/linux-<architecture>/
```

No configuration change is needed. Sources are extracted and dependencies
installed directly on the Linux filesystem on their first use, then reused.
Old Windows-mounted caches are left intact; they are not copied or deleted.
The first run builds the new cache, so subsequent runs show the full benefit.
Backend snapshots include current working-tree source bytes (including edits
and new source files), and refresh automatically when those bytes change at
desk startup. Original checkouts, saved situations, reports, recovery saves and
process logs remain in Windows. Live frontend editing continues to serve the
original working tree with polling. Native Linux/macOS cache behavior is unchanged.

That optional mode needs Windows `node.exe` on the WSL PATH, or
`GOA2_LAB_WINDOWS_NODE` set to its WSL executable path. `--runtime=native`
explicitly selects native Linux/macOS; `GOA2_LAB_RUNTIME` supplies a default
when no CLI override is given. Stop commands must use the same runtime as the
running desk.

The local VS Code task in the frontend checkout also points to this standalone launcher.
When opening this repository in VS Code, use **Layout lab: Start**. To load a
custom env file from a task, add `--env-file=.env.layout-lab` to its arguments.

## Launcher settings

Frozen references and startup defaults belong to the launcher. The desk's
**Settings** page shows them read-only. For example:

```sh
npm run compare -- --preset=desktop-3d --comparator-ref=mobile-migration
npm run compare -- --base-ref=<frontend-commit> --script-ref=<userscript-commit>
```

For a persistent local setup, copy `layout-lab.env.example` to
`.env.layout-lab` in the layout-lab root, then launch with:

```sh
npm run compare -- --env-file=.env.layout-lab
```

CLI reference/preset flags override environment values. Shell environment takes
precedence over the env file. `npm run compare -- --help` lists launcher options.

| Setting                  | Environment variable                                                                                                  | Default                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Display                  | `GOA2_LAB_DISPLAY`                                                                                                    | `embedded` (native); optional `browser`, `windows` |
| Frozen base              | `GOA2_LAB_BASE_REF`                                                                                                   | Original migration baseline below                  |
| Frozen userscript        | `GOA2_LAB_SCRIPT_REF`                                                                                                 | Pinned userscript below                            |
| Comparator branch/commit | `GOA2_LAB_COMPARATOR_REF`                                                                                             | `mobile-migration`                                 |
| Initial comparison       | `GOA2_LAB_PRESET`                                                                                                     | `mobile`; also `desktop-2d`, `desktop-3d`          |
| Service ports            | `GOA2_LAB_DESK_PORT`, `GOA2_LAB_BASE_PORT`, `GOA2_LAB_COMPARATOR_PORT`, `GOA2_LAB_LIVE_PORT`, `GOA2_LAB_BACKEND_PORT` | 3200, 3101, 3100, 3102, 8100                       |

Frozen refs resolve once at startup and cannot be changed through the API.
The old `.layout-lab/references.json` is no longer read. Set its values in the
launcher/env file if you previously customized it. Use the same env/port settings
when stopping the desk. Runtime and checkout path overrides are described above.

## Sources and presets

- **Base**: frontend mainline `a3c5e0a46b35a42cd6e054512ce3dbc6a61a579c`.
- **Target**: exactly that Base plus userscript v1.3.0 at
  `ad1eed5427b91b8daaebb56c4ceafda01db5f7de`. Its original bundle checksum is
  included in capture metadata.
- **Comparator commit**: `mobile-migration` HEAD when the desk starts. Use
  **Use latest commit** to resolve the configured branch, or revisit an older
  commit from **Settings â†’ Current build**.
  Existing sessions never silently switch to a new commit.
- **Live working tree**: explicit mode for hot reload while editing. Reports
  indicate uncommitted changes. It does not alter the frozen references.

Start with **Mobile migration** (three phone 2D views), **Layout regression**
(two desktop 2D views), or **3D regression** (two desktop 3D views). Every slot
can independently select a source, player/spectator seat, device and renderer.
Duplicate sources are supported. Target is restricted to the legacy 2D shell;
the script activates on phone profiles and remains inactive on desktop.

Select **Native mobile** only on Comparator/Live 2D to compare M0/M1. The tool
sets `ui=mobile&3d=0` there; the frozen reference windows use `3d=0` without
`ui=mobile`. Desktop comparisons explicitly choose the desktop shell and 2D/3D.

Each window has its own browser storage and game ID, including when two windows
use the same hero. Playing in one never advances another. Changing a device,
renderer or seat keeps that window's game. **Reset** replaces only its game with
the saved checkpoint; **Reset all** does so for every window.

## Live updates and synchronization

Turn on **Live updates** below the views to switch Current build views to the frontend working tree.
Vite hot reload picks up edits, including uncommitted changes. The game, seat, camera, Base and Userscript target stay in place.
Turn it off to return to the selected comparator commit. **Use latest commit** refreshes that pinned comparator separately.

**Synchronize** defaults to **None**. Any view can drive the others:

- **None** keeps game actions and UI independent.
- **API requests** applies the same game command to every clone, using the originating hero even when the other views show different heroes.
- **API + clicks** also matches UI controls by card ID, tab, accessible label or unique text. Panels are adapted between layouts. Ambiguous or unavailable controls are skipped and counted in the status line; canvas coordinates, drags and keystrokes are not replayed between different layouts.

Game commands include commits, input selections, undo, starting positions and readiness.
Reads, Vite traffic, pointer broadcasts, shares and reports are not duplicated.
A click that sends a game command uses the API path once per game. Mirrored UI clicks cannot submit that command again.
Commands from different views are serialized. Opaque input and proposal IDs are mapped per clone, with stale-source checks retained.
Consensus proposals require the same connected-player viewpoints in every game.

Synchronization requires equal game states. If the games diverge, use **Reset all** before enabling it.
An error stops synchronization and appears in the desk; it does not silently reset your games.
Synchronization mode is session-only and is included in capture metadata.

Cheats controls are hidden by default, including in development builds.
Use **Settings > Show Cheats controls** to reveal them for debugging. This visibility setting does not rewrite the saved game's engine state.

## Save and reproduce a situation

1. Choose a situation on **Compare**, then **Load**. Import a local
   save or a replay from **Saved situations**. Replay index N applies exactly
   N recorded decisions.
2. Play a window to the desired prompt. Change seats to act for other heroes.
3. Set the desired player, panels, card/hero inspection and camera in each window.
4. Click **Save situation**, enter a name and choose **Game state from**.
   That game's full engine/rollback state is the checkpoint;
   presentation settings from all windows are saved with it.
5. Open it later with **Use saved view setup** enabled to restore saved view
   count, sources, player seats, devices, cameras, panels and inspection/selection.
   Turn it off to keep your current comparison setup. The saved game checkpoint
   loads in both cases; this option only controls its presentation.

**Export** in Saved situations downloads a portable JSON bundle. Import it on another run
to restore the checkpoint, presentation settings and source provenance. Source
seat credentials are excluded; clones receive new tokens. Situation files contain
the full developer checkpoint, including hidden game information, while the
normal game UI continues receiving player-scoped views.

Named presets and local drafts live under ignored `.layout-lab` and survive restart.

### Situation library and folders

Use **situations** throughout the lab. Shared fixtures belong in `situations/<folder>/<id>.json` and are included in the repository. New saves, imports and generated situations go to `.layout-lab/situations/` as local drafts. Existing saves from the old storage folder are copied automatically with their IDs preserved; original backups stay intact.

The **Situations** page groups entries by folder and Library / Local drafts. The folder filter includes subfolders; Compare also groups its situation picker by folder. **Move** accepts paths such as `cards/defense` or `heroes/snorri` and creates folders as needed. The same operation works on shared fixtures and local drafts.

Choose **Add to library** on a local draft to create a new shared copy in the selected folder. The draft is retained, machine-specific runtime provenance is removed, and nothing is committed automatically. Review the JSON and commit it alongside the implementation when ready. Ordinary saves never overwrite shared fixtures.

The library includes normal and timed planning under `situations/planning/`, plus five basic card examples under `situations/cards/`: selection, action choice, a tier II upgrade, defense and discard. See [the situation library](situations/README.md) for the saved moments and regeneration command. Each JSON contains a schema-1 checkpoint, summary, name and optional per-view presentations; no running server or runtime game IDs are required to reopen it.

Automation uses `GET /api/catalog` (`situations`, each with `origin` and `group`), `POST /api/load {situationId, slots, restoreViews}`, and `POST /api/organize {id, group, shared}`. Setting `shared:true` promotes a local draft or moves a shared fixture. Setting it to false moves a local draft. Group paths are relative and validated on the service host.

Use **Edit view** for source/device/renderer/viewpoint changes. **View tools**
inside the editor contains panel controls, reset, phone rotation and camera copy.
The default desk is a small Electron desktop app. Each game is a native
Chromium WebContentsView with isolated storage and the selected viewport and
touch capabilities. Animations and 3D render directly; there is no screenshot
or video stream between the game and the desk. Mouse, keyboard and touch
input go to the game itself.

**Fit** scales the displayed surface without changing the emulated viewport.
**100%** shows CSS pixels at actual size with scrollbars. **Expand** uses the
whole desk; **Collapse** or Escape returns to the comparison. Opening an editor
hides the game surfaces so they cannot cover the dialog. Captures retain the
original selected viewport resolution.

Use `--display=browser` for the web desk, or `--headless --no-open` on a host
without a desktop. This optional browser mode streams interactive JPEG frames
and is intended for static layout work; use the native app for animations.
`--display=windows` shows separate game windows. `GOA2_LAB_DISPLAY` supplies
the startup default. Native Linux needs a desktop display (including WSLg);
macOS and Windows use their normal desktop. No Windows runtime is needed on
Linux or macOS.
Open panels from **View tools** or the real app. A layout
without an equivalent panel reports **Unavailable in this version**. The camera
bridge restores native 2D pan/zoom and 3D camera/OrbitControls state, without
clicking game tiles. **Copy camera to matching views** never copies between 2D
and 3D. Switching render modes restores that mode's remembered viewpoint.

Timed games retain clock UI but use frozen server/browser wall time. Ordinary
UI timers, animation frames and networking continue normally. No automatic
deadline worker advances the game. Imported save clocks are settled at their
file timestamp; replay clock values are labelled reconstructed. Running-clock
simulation is not part of the desk.

## Capture and adjust

Select at least two views with **Capture** checked, then **Capture
comparison**. The report contains original viewport screenshots, a full-size
strip, selectable pairwise overlays, pixel differences and reproduction metadata.
Different-size captures retain original dimensions and disable overlays. Reports
label different seats/cameras and independently diverged game states.

Captures wait for the actual game, camera, fonts, model/artwork requests and a
stable rendered image. Missing assets, a lost WebGL context, page exceptions or
failed viewpoint restoration are surfaced rather than silently accepted.
Restoration warnings are visible in the desk and included in metadata.

Reports are stored under `.layout-lab/reports` and can be reopened through their
desk URLs. Pixel differences are an inspection aid, not automatic layout parity
pass/fail tests.

## Processes and troubleshooting

| Process              | Port |
| -------------------- | ---- |
| Committed Comparator | 3100 |
| Base / Target        | 3101 |
| Optional Live source | 3102 |
| Isolated backend     | 8100 |
| Comparison desk      | 3200 |

The desk starts only the sources required by the selected configuration. It
reports occupied ports without killing their owners. **Settings â†’ Diagnostics &
process logs** shows exact log paths; failures also write diagnostic JSON/PNG files
in `.layout-lab/runtime`. Change frozen references in launcher options or env vars
and restart; they are not editable in the desk.

Stop with **Stop desk** in the top bar (also available while loading), Ctrl+C in its launch terminal, or:

```sh
npm run compare -- --stop
```

Shutdown closes browser contexts and only the process groups launched by
this desk. It leaves existing normal development servers alone.

## Verification

```sh
npm test
python test/situations_test.py
```

Backend integration checks use the sibling backend environment:

```sh
cd ../goa2-backend
uv run --locked python ../goa2-layout-lab/test/backend_test.py
```

For browser automation/CI diagnostics without opening desktop windows:

```sh
npm run compare -- --headless --no-open --no-auto-load
```

The explicit browser acceptance suite requires a separately marked instance:

```sh
npm run compare -- --headless --no-open --no-auto-load --verification
# In a second terminal on the same host/runtime:
node test/e2e.mjs
```

It refuses to attach to an ordinary interactive desk. It creates clearly named
acceptance situations, exercises real phone and desktop 3D views, and writes its
evidence to `.layout-lab/acceptance.json`. Its Live CSS probe restores the exact
original content afterward.

With that instance still running, check the dashboard and standalone report controls:

```sh
node test/desk-ui.mjs
node test/presentation-e2e.mjs
```

The upgrade Confirm tap-target regression owns a separate headless verification desk
(default ports 3500-3503 and 8500) and tests the configured frontend working tree:

```sh
npm run test:mobile-confirm
```

It loads the shared tier-II upgrade situation in mobile and desktop 2D shells at
390x844, 360x800 and 844x390. It stages a card, checks the enabled Confirm button
receives hits at its center and corners at both scroll extremes, then submits one
real touch tap and verifies exactly one accepted upgrade. Failures save a browser
screenshot under `.layout-lab/runtime/`. The suite closes only its owned services.
Runtime/checkout overrides use the usual `GOA2_LAB_*` variables.

The M2 gameplay acceptance suite also owns its instance (default ports 3600-3603
and 8600) and tests the frontend working tree:

```sh
npm run test:mobile-gameplay
```

It uses the shared simple situations and runs
`scripts/create-mobile-gameplay-situations.py` to fabricate real Gydion spell,
Snorri inscription and Emmitt second-card checkpoints. Python resolves from
`GOA2_LAB_PYTHON`, the sibling backend environment, or `uv run --project` as a
fallback with an isolated environment under `.layout-lab/runtime/`. Checks cover inspection without submission, selected-card/inspection
capture and restore, accepted core actions, sequential rune confirmations with
the automatic fourth rune, spell-action follow-up, and Emmitt take-back, second
commit and Done. Screenshots and `evidence.json` go under ignored
`.layout-lab/reviews/m2-*/`; generated situations remain local drafts.

The M3 presentation suite owns ports 3700-3703 and 8700 by default:

```sh
npm run test:mobile-presentation
```

It generates real-map display fixtures with
`scripts/create-mobile-presentation-situations.py`, then checks owner/opponent/
spectator public spell access, counters 0/1/3/9/10, scoped embedded spell readers,
sorting, nested/public presentation save and restore, portrait/compact/landscape
bounds, shared image painting, rune history and markers on Razzle's pieces.
The rune flow also covers a real reload, Board peek, Undo and acknowledgment of
the automatic fourth rune. `--runes-only` runs just that recovery flow.
Screenshots and evidence go to ignored `.layout-lab/reviews/m3-*/`. Factories do
not overwrite the curated library. Run these browser checks on Windows on this
installation; normal WSL services are used without running Linux UI test suites.

For paired visual reports against the pinned userscript target:

```sh
npm run test:mobile-roster-visual
npm run test:mobile-spells-visual
npm run test:mobile-ready-visual
npm run test:mobile-shell-visual
npm run test:mobile-special-visual
npm run test:mobile-card-fallback
npm run test:mobile-status-visual
npm run test:mobile-decision-visual
```

The roster runner uses ports 4600-4603/9600 and accepts a focused filter such as
`-- --case=snorri` or `-- --case=brogan`. It includes empty and occupied rune slots,
masked and public active history, discard piles and crowded public indicators.
The spell runner uses 4700-4703/9700 and compares selected Large/Image readers
at all three sizes, including rotation and closing the browser afterward.
The ready runner uses 4500-4503/9500, checks the Ready tap target at all three
sizes and submits readiness on both clones before comparing running clocks.
The shell runner uses 4800-4803/9800 and captures paused, suspended and completed
match states from real-model fixtures, without consuming their pending readiness.
The special runner uses 4900-4903/9900 for Emmitt's second-card selection,
starting-position adjustment, an actual routed WebSocket outage/recovery, and a
long Snorri card. The fallback runner uses the same ports; run it separately.
It intentionally returns HTTP 404 for native Snorri card backgrounds, records the
routed failures, and saves labeled raw originals/combined images for Large and
Image readers. The target retains its normal Large text view. This fault check
bypasses the clean-asset report exporter, whose normal missing-asset rejection
remains unchanged. Its manifest names the intentional fault and source settings.
The status runner uses 5100-5103/10100 for a real ten-hero waiting message,
collapsed/expanded ticker behavior, reduced motion, fixed-height Board rows and
reopening the shared history fixtures. The decision runner uses 5200-5203/10200
for defense/discard/spell/gold choices and supplementary hero details. It labels
native staged choices versus immediate-submit target choices explicitly; discard
selection is aligned on both sides. Embedded spell inspection also verifies
parent bounds and safe capture/restore without sending a game choice.
These runners produce original screenshots, combined images, diffs and HTML reports under
`.layout-lab/reports/`, with manifests under `.layout-lab/reviews/`. They use Live
working-tree sources; review the images before making a visual-parity claim.

The frontend remains unchanged in production: camera/presentation bridges are
injected only by the lab Vite config. The backend helper lives in this tool and
is never imported by the normal backend entrypoint.

Embedded-view checks (real Chromium, no game services required):

```sh
npm run test:streams
```

On the marked verification desk, test embedded input against real phone and desktop 3D games:

```sh
npm run test:embedded
```

Native desktop checks (a display is required, or Xvfb on Linux):

```sh
npm run test:native
# Stop any existing desk first; this suite owns its instance:
npm run test:native-e2e
# Focused synchronization / live-update checks:
npm run test:sync
```

The native suite checks all three phone versions, the userscript, direct input,
modal layering, scaling, save/capture/reload, two desktop 2D views and two desktop
3D views with camera controls. It also verifies that no screenshot stream is used.

### Mobile Deck browsing and plans (M4)

```sh
npm run test:mobile-deck
```

This focused Windows Chromium check owns diagnostic ports 3800-3803 and 8800.
It uses the shared Arien card-selection and Gydion public-spells-3 situations to
check Tree/List/Grid, local plan persistence after reload, preview selection,
390x844 / 360x800 / 844x390 layouts, and owner/spectator visibility. Browsing and
planning must preserve the authoritative state hash and scoped live view.
It records working-tree screenshots/evidence in ignored `.layout-lab/reviews/m4-*/`
and closes only its own desk/services. The frontend's M4 integration notes own
plan/preference migration and later M5/M6 upgrade submission scope.

### Deck/shared-card visual parity

```sh
npm run test:mobile-visual
```

This isolated Windows comparison uses ports 3900-3903/8900 and the configured
frozen Base/userscript refs against the frontend's Live working tree. It captures
28 native/target pairs for Arien/Gydion: Tree/List/Grid and card previews at
390x844, 360x800 and 844x390, plus Large/Image spell readers. Each report contains
originals, a combined PNG, pairwise diff and standalone HTML overlay viewer.
State hashes, panel geometry, compact-card heights and actual canvas pixels are
checked; rendering and asset failures fail the run. Captures wait for native card
paint readiness so a temporarily transparent canvas cannot count as finished.
The helper stops only its own desk and leaves artifacts under ignored
`.layout-lab/reviews/parity-*/` and `.layout-lab/reports/`. Set `GOA2_PARITY_TAG` to
label a run. These are working-tree comparisons, not immutable commit evidence.
The match header/camera and native localized card text are outside this focused
Deck/shared-card visual comparison; full device/app acceptance remains separate.

### Resolution order parity (M3)

```sh
npm run test:mobile-resolution-visual
```

This Windows Chromium comparison owns ports 5300-5303/10300. Its factory
`scripts/create-mobile-resolution-situations.py` uses real planning commits on
the full map: Arien/Hanu/Tigerclaw at initiative 13, Brogan at 11, with the
initial coin on RED. It saves the actual teammate-choice prompt and the next
action prompt after choosing Hanu. Both checkpoints are restored twice and
checked for stable canonical state. These are generated drafts under ignored
`.layout-lab/situation-recipes/mobile-resolution/`.

The browser uses each view's Board-peek control without answering the pending
game choice, compares Board and Heroes at 390x844, 360x800 and 844x390, and
checks order labels, visible badge bounds and matching game hashes. Reports
under `.layout-lab/reviews/resolution-*/` describe Live versus the frozen target;
they are working-tree evidence. The frontend retains server-provided initiative
ordering, including Reverse Time; unit coverage verifies the ascending case.
The helper closes only its owned diagnostic desk and services.

### Library defaults and remaining card/turn states

```sh
npm run test:mobile-library-reopen
npm run test:mobile-turn-state-visual
npm run test:mobile-turn-state-visual -- --case=emmitt-two-commits
npm run test:mobile-status-visual -- --status-only
npm run test:mobile-spells-visual -- --rank4
```

Library reopening uses diagnostic ports 5400-5403/10400 and the regular desk
`restoreViews:true` endpoint. It checks the shared long-status, Takahide gold,
team-tie and selected-teammate entries with their saved Base/Comparator/Target
sources, seats, layouts, hashes and actual pending decisions. Three-column
reports are restore checks, rather than evidence of Live source parity.

Turn-state comparisons own ports 5500-5503/10500 and generate normalized real
checkpoints with the resolution factory: Hanu's accepted HOLD/confirmation,
a hero without a queued or completed card, and an off-board hero. They compare
Board/Heroes at all three phone sizes. Assertions distinguish completion from
absence, retain the just-resolved card, and check fixed row/column bounds.
The Emmitt case uses the gameplay factory, commits his second card through
native UI and mirrors the real command with API synchronization before taking
paired images. Opponent masking remains covered by frontend integration tests.
Generated display variants are local drafts; the off-board variant deliberately
removes Brogan and discards his unresolved card without claiming a natural play
sequence. No production saves or engine rules are modified.

`--status-only` limits the existing status runner to its ten-hero long-status
case and verifies horizontal as well as vertical row bounds. The spell runner's
`--rank4` mode uses a fabricated public Wish with all other prepared spells still
masked. It checks a spectator can inspect Large/Image at three sizes and the
Tiny row has solid rank-IV end accents without an initiative rail. It uses the
usual spell-runner ports 4700-4703/9700. These remain Live-versus-frozen-target
comparisons, and each owned diagnostic desk closes after capture.
