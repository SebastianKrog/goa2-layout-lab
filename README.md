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
reports, source caches and backend runtime files stay in this repo's ignored
`.layout-lab/` directory. Only Vite dependency caches are written inside the
frontend's ignored `node_modules/`.

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

The VS Code task **GoA2: Open comparison desk** runs the same command.
The desk opens at **http://localhost:3200**. First use extracts the pinned Git
sources, verifies/copies model assets, and installs each version's locked
dependencies. Source caches are separated by runtime/platform/architecture;
the backend uses its own uv environment under `.layout-lab/runtime`.
Subsequent launches reuse those caches. Source preparation can
take several minutes on a Windows-mounted filesystem.

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
5. Open it later with **Restore saved viewpoints** enabled. With that
   option disabled, the selected preset controls the windows instead.

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

Stop with **Settings â†’ Stop desk**, Ctrl+C in its launch terminal, or:

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
