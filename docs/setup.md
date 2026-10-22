# Setup and runtime

[Back to the lab overview](../README.md)

## Repository layout

```text
GitHub/
  goa2-layout-lab/          # this standalone tool, dependencies and local data
  goa2-frontend/            # Git revisions, models and live working tree
  goa2-backend/             # game engine
  goa2-mobile-2d-patch/     # optional userscript target
```

The lab does not need to be inside the frontend checkout. The shared situation library lives in tracked `library/situations/` folders. Local drafts,
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
situation through the view's **Start** overlay when ready. Use the right-hand **Add view** rail to clone its current state without resetting it. Starting the desk alone does not prepare
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
contains situation metadata and Presentation templates and Layouts; full checkpoints are
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

| Setting                  | Environment variable                                                                                                  | Default                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Display                  | `GOA2_LAB_DISPLAY`                                                                                                    | `embedded` (native); optional `browser`, `windows`                   |
| Frozen base              | `GOA2_LAB_BASE_REF`                                                                                                   | [Pinned Base](workspace.md#sources-and-presets)                      |
| Frozen userscript        | `GOA2_LAB_SCRIPT_REF`                                                                                                 | [Pinned Target](workspace.md#sources-and-presets)                    |
| Comparator branch/commit | `GOA2_LAB_COMPARATOR_REF`                                                                                             | `mobile-migration`                                                   |
| Initial comparison       | `GOA2_LAB_PRESET`                                                                                                     | `current` (one Live View); also `mobile`, `desktop-2d`, `desktop-3d` |
| Service ports            | `GOA2_LAB_DESK_PORT`, `GOA2_LAB_BASE_PORT`, `GOA2_LAB_COMPARATOR_PORT`, `GOA2_LAB_LIVE_PORT`, `GOA2_LAB_BACKEND_PORT` | 3200, 3101, 3100, 3102, 8100                                         |

Frozen refs resolve once at startup and cannot be changed through the API.
Set references in the launcher/env file. Use the same env/port settings when
stopping the desk. Runtime and checkout path overrides are described above.

## Processes and troubleshooting

| Process              | Port |
| -------------------- | ---- |
| Committed Comparator | 3100 |
| Base / Target        | 3101 |
| Optional Live source | 3102 |
| Isolated backend     | 8100 |
| Comparison desk      | 3200 |

The desk starts only the sources required by the selected configuration. It
reports occupied ports without killing their owners. **Settings → Diagnostics &
process logs** shows exact log paths; failures also write diagnostic JSON/PNG files
in `.layout-lab/runtime`. Change frozen references in launcher options or env vars
and restart; they are not editable in the desk.

Stop with **Stop desk** in the top bar (also available while loading), Ctrl+C in its launch terminal, or:

```sh
npm run compare -- --stop
```

Shutdown closes browser contexts and only the process groups launched by
this desk. It leaves existing normal development servers alone.
