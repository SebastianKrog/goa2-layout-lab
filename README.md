# GoA2 comparison desk

Start with one current working-tree view, then add up to two independent views.
Situations combine Decision State and Presentation; reusable Layouts configure Views; see [Lab terminology and saved state](docs/terminology.md).
Linux and macOS run the desk, Chromium, Vite and the isolated backend natively.
Windows runs the desk and emulated browsers locally and services in WSL. The regular
development servers on ports 3000/8000 are separate.

For agent work, start with [AGENTS.md](AGENTS.md) and the repository skills it links.

## Situation reviews

Select multiple entries in **Situations**, use **Select filtered** to toggle the
visible entries, then **Start review**. Previous/Next above the views and in the
movable device Report bubble restore every view together. Captures and reports
collect under one review folder. The **Reviews** tab lists past runs and statistics;
use **Run again** or **Edit and run** to create a fresh run while preserving the
original evidence. See [Review queues and evidence](docs/reviews.md).

## Documentation

- [Terminology and desk flow](docs/terminology.md)
- [State storage, contracts and offline porting](docs/state-model.md)
- [Reviews and report collections](docs/reviews.md)
- [Devices and bots](docs/device-testing.md) · [Element reporting](docs/element-reporting.md)
- [Testing](docs/testing.md) · [Completed plans and remaining follow-ups](docs/plans/README.md)

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

| Setting                  | Environment variable                                                                                                  | Default                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Display                  | `GOA2_LAB_DISPLAY`                                                                                                    | `embedded` (native); optional `browser`, `windows` |
| Frozen base              | `GOA2_LAB_BASE_REF`                                                                                                   | Original migration baseline below                  |
| Frozen userscript        | `GOA2_LAB_SCRIPT_REF`                                                                                                 | Pinned userscript below                            |
| Comparator branch/commit | `GOA2_LAB_COMPARATOR_REF`                                                                                             | `mobile-migration`                                 |
| Initial comparison       | `GOA2_LAB_PRESET`                                                                                                     | `current` (one Live View); also `mobile`, `desktop-2d`, `desktop-3d`          |
| Service ports            | `GOA2_LAB_DESK_PORT`, `GOA2_LAB_BASE_PORT`, `GOA2_LAB_COMPARATOR_PORT`, `GOA2_LAB_LIVE_PORT`, `GOA2_LAB_BACKEND_PORT` | 3200, 3101, 3100, 3102, 8100                       |

Frozen refs resolve once at startup and cannot be changed through the API.
Set references in the launcher/env file. Use the same env/port settings when
stopping the desk. Runtime and checkout path overrides are described above.

## Sources and presets

- **Base**: frontend mainline `a3c5e0a46b35a42cd6e054512ce3dbc6a61a579c`.
- **Target**: exactly that Base plus userscript v1.3.0 at
  `ad1eed5427b91b8daaebb56c4ceafda01db5f7de`. Its original bundle checksum is
  included in capture metadata.
- **Comparator commit**: `mobile-migration` HEAD when the desk starts. Use
  **Use latest commit** to resolve the configured branch, or revisit an older
  commit from **Settings → Current build**.
  Existing sessions never silently switch to a new commit.
- **Live working tree**: explicit mode for hot reload while editing. Reports
  indicate uncommitted changes. It does not alter the frozen references.

The empty desk starts with one Live View. Optional Layouts include **Mobile
migration** (three phone 2D views), **Layout regression** (two desktop 2D views),
and **3D regression** (two desktop 3D views). Every slot
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

Turn on **Live updates** in **Settings → Current build** to switch Current build views to the frontend working tree.
Vite hot reload picks up edits, including uncommitted changes. The game, seat, camera, Base and Userscript target stay in place.
Turn it off to return to the selected comparator commit. **Use latest commit** refreshes that pinned comparator separately.

**Synchronize**, in **Workspace tools**, defaults to **None**. Any view can drive the others:

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

1. Press **Start** on the default view, choose a Situation and start it. Import local saves or replays from **Saved situations** if needed. Replay index N applies exactly N recorded decisions.
2. Play to the desired prompt. Change Viewpoint to act for another hero.
3. Use **Save... > Situation**, enter a name and select the source view. This saves the exact engine/rollback checkpoint plus the captured Viewpoint, Session State and supported User State.
4. Menus, selected cards, camera and preferences are part of the saved Situation. **Save... > Presentation template** also makes these values reusable. **Save... > Decision State** saves game-only state; **Create from Decision State** composes another Situation.
5. Save view arrangement, source/device/UI mode/controllers and synchronization independently with **Save... > Layout**. Add a view using the right-hand rail to inherit current game progress and UI state without resetting existing views.

Old situations have been ported into composed Situations and separate suggested Layouts. Runtime accepts the new model only; see [state storage and porting](docs/state-model.md). See [terminology and saved state](docs/terminology.md) for the exact boundaries.

**Export** in Saved situations downloads a portable JSON bundle. Import it on another run
to restore the exact Decision State and composed Presentation. Source
seat credentials are excluded; clones receive new tokens. Situation files contain
the full developer checkpoint, including hidden game information, while the
normal game UI continues receiving player-scoped views.

Saved Layout overrides, Presentation templates and local drafts live under ignored `.layout-lab` and survive restart.

### Situation library and folders

Use **situations** throughout the lab. Shared fixtures belong in `situations/<folder>/<id>.json` and are included in the repository. New saves, imports and generated situations go to `.layout-lab/situations/` as local drafts. Older formats require the [offline porting tool](docs/state-model.md#porting-older-situations); runtime imports accept composed Situations only.

The **Situations** page supports search by name, hero or folder and groups entries
by folder and Library / Local drafts. **New situation** holds creation/import
actions; each row keeps **Open situation** visible and puts Export, Move, device
sharing and promotion under **More**. The folder filter includes subfolders; Compare also groups its situation picker by folder. **Move** accepts paths such as `cards/defense` or `heroes/snorri` and creates folders as needed. The same operation works on shared fixtures and local drafts.

Choose **Add to library** on a local draft to create a new shared copy in the selected folder. The draft is retained, machine-specific runtime provenance is removed, and nothing is committed automatically. Review the JSON and commit it alongside the implementation when ready. Ordinary saves never overwrite shared fixtures.

The library includes normal and timed planning under `situations/planning/`, plus five basic card examples under `situations/cards/`: selection, action choice, a tier II upgrade, defense and discard. See [the situation library](situations/README.md) for the saved moments and regeneration command. Each schema 2 Situation references an exact Decision State and includes its Presentation. Decision States are stored separately; no running server or runtime game IDs are required to reopen the moment.

Automation uses `GET /api/catalog` (`situations`, each with `origin` and `group`), `POST /api/load {situationId, slots}`, and `POST /api/organize {id, group, shared}`. Setting `shared:true` promotes a local draft or moves a shared fixture. Setting it to false moves a local draft. Group paths are relative and validated on the service host.

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

Select one or more views with **Capture** checked, then **Capture**. A single
view produces an original screenshot and reproduction metadata without pairwise
diffs. With multiple views, the report contains original viewport screenshots,
a full-size strip, selectable pairwise overlays, pixel differences and reproduction metadata.
Different-size captures retain original dimensions and disable overlays. Reports
label different seats/cameras and independently diverged game states.

Captures wait for the actual game, camera, fonts, model/artwork requests and a
stable rendered image. Missing assets, a lost WebGL context, page exceptions or
failed viewpoint restoration are surfaced rather than silently accepted.
Restoration warnings are visible in the desk and included in metadata.

Reports are stored under `.layout-lab/reports` and can be reopened through their
desk URLs. Pixel differences are an inspection aid, not automatic layout parity
pass/fail tests.

### Crop captures to elements

Open **Workspace tools → Crop screenshots**, enable cropping, enter a CSS
selector, then use **Capture selected Views**. The toolbar shows **Capture crop**
while cropping is enabled. The same selector and match policy
are applied independently to every selected view (one, two or three).

- **Require one visible match** (default): exactly one match must have a visible
  area in the current viewport. Multiple matches fail instead of choosing one.
- **Specific visible occurrence**: select a one-based occurrence in DOM order
  among visible matches. An out-of-range occurrence fails. Numbering is not visual
  left-to-right order and does not guarantee the same semantic item across layouts.
- **All visible matches**: capture the bounding rectangle of all visible matches.
  This includes gaps and any other content within that rectangle.
- **Individual**: save one image per visible match, numbered in DOM order.
  Each view's occurrence 1 is compared with occurrence 1 in other views, and so
  on. Unmatched extra occurrences remain available as individual images.
- **Combine**: save those same individual images plus a horizontal strip per view,
  in DOM order without resizing or the original viewport gaps. Shorter crops leave
  transparent space below them. Different match counts disable the strip's diff.

Hidden, transparent, zero-area, fully clipped and offscreen matches are ignored.
No remaining visible matches in any selected view fails the capture. Partial
matches are clipped to the viewport and rectangular ancestor scroll/overflow
bounds. The page is not scrolled, resized or restyled. These are actual screenshot
pixels: overlapping content stays visible, occlusion is not used to exclude
matches, and shadows/pseudo-elements extending outside the element box are not
included. Complex transforms, rounded clipping and clip paths retain their
painted appearance inside the rectangular crop; they are not shape masks.
Selectors inspect the main document's light DOM.

Reports include the selector, matching policy, match counts, selected DOM
occurrences, CSS bounds and screenshot pixel bounds. Crops retain device scale
and are never stretched; unequal crop sizes disable that pair's diff/overlay.
The original capture files in a cropped report are the cropped images; turn the
option off for full viewport evidence. Game and presentation metadata remain.

API: `POST /api/capture {indexes:[0,1],crop:{selector:".card",match:"nth",occurrence:2}}`.
Omit `crop` for full viewport captures. The portable comparison helper accepts
`--selector ".card" --match nth --occurrence 2`; `--match unique` is the default,
and `--match union` selects the combined rectangle. Use `--match individual` or
`--match combine` for separate crops or their compact strip. Individual files are
`window-N-match-M.png` (view N, visible occurrence M); Combine additionally writes
`window-N.png`. The report/export helper includes every individual image.

## Compare rendered HTML and CSS

Prepare a comparison normally, then open **Workspace tools → Compare HTML & CSS**.
Select two Views with **Include Views** in the dialog (or the Capture checkboxes
on the Views) and choose:

Start with **Element HTML + active CSS** and a narrow selector for routine styling
reviews. Use full-page **Full** or **Active** only when explicitly needed for a
whole-document investigation. Both collect styles for every element; Active is
not a lightweight shortcut. Skip CSS collection for image-only comparisons.

- **Full HTML + CSS**: the rendered document and every stylesheet exposed by
  Chromium, including imported sheets, inline stylesheets and injected userscript
  styles. Inline element styles remain in the HTML and matched declarations.
- **Active CSS**: resolved computed properties for every element in the document,
  plus Chromium's matched rules, inline declarations, inheritance, pseudo-element
  rules, cascade layers and conditional-rule metadata.
- **Element HTML + active CSS**: enter a standard CSS selector. Every matching
  element and its descendants are included in both views. A missing or invalid
  selector fails explicitly, rather than returning an empty comparison.

This reads the already-open views without reloading or advancing their games.
Open the resulting side-by-side source viewer to switch between HTML, loaded CSS,
computed CSS and matched rules. The viewer displays markup as text; it does not
execute exported scripts. It works offline when the entire report folder is copied.

For agents or terminal use:

```sh
npm run extract -- --indexes=1,2 --mode=element --selector="[data-pane='hand']" --out=./hand-review
```

For a whole-document investigation when needed:

```sh
npm run extract -- --indexes=0,1 --mode=full --out=./html-css-review
npm run extract -- --indexes=0,1 --mode=active --out=./active-css-review
```

Use `--origin=http://127.0.0.1:3200` to select another running desk. The output
folder must be new. Omit `--out` to retain the export only under
`.layout-lab/reports/source-<id>/`. The API equivalent is
`POST /api/extract {indexes:[0,1],mode:"element",selector:".your-selector"}`;
indexes are zero-based, with exactly two distinct open views.

`comparison.json` (schema 3) records revisions, source configuration, viewport
dimensions, userscript activation, game-state hashes, diagnostics and the full
extraction. Each view's `computedCSSFile` links to its standalone computed CSS;
the viewer reconstructs that display on demand rather than embedding duplicate
CSS text. Machine JSON is compact; no computed properties or matched declarations
are omitted.
`view-N.html.txt` contains inert HTML (full/element modes), `view-N.computed.css`
contains resolved values, and `view-N.active.json` contains per-element computed
values and matched-rule information. Large repeated protocol structures use
`{$ref:"matched-N"}` entries, resolved through that view's `matchedDefinitions`
table (schema 2). The viewer has a **Matched rule definitions** tab. Full mode also exports individual
`view-N.sheet-M.css` files; their source URLs and sheet IDs are in the JSON.
`changes.json` lists computed-property changes aligned by structural CSS paths.
These paths describe DOM positions, so different component trees need human
interpretation rather than automatic semantic matching.

“Active” describes the current viewport and interaction state, including hidden
DOM elements; it is not just CSS for pixels currently on screen. Computed values
are the resolved result. Matched rules also contain overridden declarations and
conditional metadata, and must not all be interpreted as winning declarations.
Animations/transitions are sampled, not frozen; HTML/CSS cannot reproduce canvas
or WebGL pixels. Extraction currently covers the main document's light DOM;
child frames and open shadow roots are flagged instead of silently claimed as
captured. A game-state change or detected structural DOM change during extraction
requires a retry. Live sources are labelled mutable. No platform services or
browser sessions are started by the extraction command.

### Verify element capture and CSS extraction

`npm run test:element-tools` starts an isolated headless browser desk on ports
5700–5703/10700 and tests the shared card-selection, action-choice and discard
situations against committed Comparator and the userscript Target. It exports
Individual/Combine images, checks portable offline viewers, tests selector failures
and Nth/Union crops, and exports full/active/element HTML/CSS. It checks game hashes
remain unchanged and closes only its own services. Reports and a verification
manifest stay under `.layout-lab/reviews/element-tools-<timestamp>/`.
Use `npm run test:element-tools -- --case=discard-card` for a focused rerun.
Full/active source exports traverse the complete document and can take substantially
longer and produce larger files than selector-focused exports.

### Collect mobile HTML/CSS review evidence

`npm run test:mobile-elements` collects paired viewport images and selector-focused
HTML/CSS exports for the committed Comparator's native mobile UI and the pinned
Base + userscript Target. It uses shared situations and checks that both clones
start with equal game hashes and remain unchanged by presentation collection.
The userscript is a comparison reference; assess either implementation against
intended behavior rather than assuming the Target is correct.

The cases cover shell/pane frames, clock/setup/connection states, selected Hand
cards, action/defense/discard/upgrade/spell/rune/team choices, hero/Board states,
public spell counts and privacy viewpoints, nested readers, and Arien/Gydion
Tree/List/Grid with color-sorted plans and Large/Image previews. Default sizes
are 390×844, 360×800 and 844×390. This collects M1–M4 review evidence; complete
milestone acceptance and pixel equality are separate questions.

```bash
npm run test:mobile-elements -- --case=m2-defense,m4-arien
```

`--case=` accepts comma-separated case-name prefixes. Use `--profile=landscape`
or a comma-separated subset of `portrait,compact,landscape` for a focused rerun;
omitting it collects all three. The runner uses isolated
ports 5900–5903 and backend port 10900 by default; the corresponding
`GOA2_LAB_*_PORT` environment variables can override them. Other checkout/ref
settings come from the normal launcher configuration. It starts a headless
browser desk and closes its owned services after collection.

The local `.layout-lab/reviews/m1-m4-elements-<timestamp>/evidence.json` records
revisions, situations, hashes, selectors, observations, diagnostics and report
references. Images and HTML/CSS viewers are under `.layout-lab/reports/`.
Inspect the exported images and styles together. Collection errors are recorded
per case/viewport and must be checked even when the process exits successfully;
missing selectors are collection gaps, not evidence of a product defect.
Short-landscape decision cases also record scrolling/trial-tap reachability without
submitting choices. Obstructed centers retain hit-test geometry and a screenshot;
these findings do not automatically fail the evidence collector. Offscreen
controls need this reachability check before being called inaccessible. Manifests
include the executing lab HEAD/dirty state and runner SHA-256 alongside source
revisions. Generated artifacts remain local and ignored by Git.

### Loading and capture performance

Situation loads fetch just the selected checkpoint and cache parsed situation
files with filesystem-change invalidation. Restarting the lab clears these
in-memory caches. File edits, moves, additions and deletions remain visible without
a restart. Game clones receive isolated copies of cached checkpoints.

Browser captures settle independent views concurrently; native embedded capture
keeps its required serialization. New situations still open fresh game views and
wait for their game state, camera, fonts and assets. The first load also starts and
prepares its required frontend services, so it can take longer than later loads.

For routine work, keep the desk running, use selector-focused CSS exports, and
reuse the exported offline viewer while reviewing the same snapshot. Collect a
new export after relevant UI, state or stylesheet changes.

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

## Testing

See the [testing guide](docs/testing.md) for unit tests, owned acceptance desks,
mobile comparison runners and evidence locations. Use distinct service ports and
close only the instance a test owns. The [state-model validation record](docs/validation/state-model-2026-10-22.md)
records the latest refactor checks and remaining verification gaps.

## Report a div across lab views

Click **Report an element** to activate a crosshair picker in every view. Hover
shows a glowing blue div outline; click opens the comment popup. **Enter** sends,
**Shift+Enter** adds a line, and Close keeps your draft. The report gathers the
selected div's image, outer HTML, computed/matched CSS, and a resumable situation
from each view, with source/commit and view configuration metadata. Picker
controls are excluded from captures. **Situations → View report** reopens it.
See [element reporting](docs/element-reporting.md) for matching, files and limits.

## Open a situation on another device

Choose **Open on device** from Compare or a situation card, then **Start device
website**. Scan the locally generated QR code on your phone. The device gets an
independent clone plus an injected floating Report userscript. Reports save a
screenshot without reporting controls, your comment, and a resumable situation
back into the lab. Frontend and production backend code are untouched.
See [device setup and reporting](docs/device-testing.md) for the private-LAN
firewall helper, live updates, report locations and stop controls.

### Play against Random, Simple or ISMCTS bots

**ISMCTS** searches ahead using heuristic policy and evaluation, with no neural
network, model artifact, or training setup. The lab uses backend defaults: 200
iterations, a two-second decision timeout and two-round continuation horizon.
There are no search tuning controls. Backend timeout/failure handling may fall
back to Simple for an individual decision.

The default is one Live/Desktop view. Use **Add view** for a second or third view; the **Play solo** setup under **Workspace tools** remains available for one Live/mobile view.
In any regular view, open **Edit view**, choose the human **Viewpoint**, expand
**Controllers and auto switch**, then set **Other heroes** to **Random**, **Simple**, **ISMCTS**, **Manual**, or mixed choices.
**Save** updates that clone's controllers without resetting its game.
Before loading, these choices become part of that view's setup.

In **Edit view**, enable **Auto switch after each action** to follow a player
with a pending decision. It keeps the current viewpoint while that player still
has a choice, so simultaneous decisions do not bounce between players. Switching
reuses the same game/page, preserves the camera, and takes no game actions or
controller changes. It can view bot-controlled players without taking them over.
The option is per desk view, off by default, and retained in saved setups/Reset.
Turn it off to keep a fixed viewpoint.

Bot choices are independent per view and retained on Reset and in saved setups.
Changing the viewpoint only changes the viewed player; bot assignments stay unchanged.
Bots disable synchronization because each clone advances independently. Turn all
bots off and reset divergent games before enabling synchronization again.

Point `GOA2_LAB_BACKEND` in ignored `.env.layout-lab` at a backend checkout with
bot support, such as `../goa2-backend-bots` on `bots-upstream`, and restart the lab
when changing that setting. This is the `bots-upstream` branch of the backend
fork, not a separate required GitHub repository. Serving omits development and
training dependency groups.

In **Open on device**, select **Your hero**, then set the **Other heroes** to
**Random**, **Simple**, **ISMCTS**, or individual choices. Choose **Live working tree** and
**Mobile 2D** to test current phone edits, then **Start device website** and scan
the QR. Bots control the other selected heroes on both teams; your hero stays
manual. Timed situations may need your **Ready** confirmation, and lab clocks
remain frozen. **Stop sharing** also stops that clone's bot workers.

See [playing against bots](docs/device-testing.md#play-one-hero-with-bots) for
configuration, reporting, API setup and verification. Agents should load
[goa2-play-bots](agent/skills/goa2-play-bots/SKILL.md) for this workflow.
