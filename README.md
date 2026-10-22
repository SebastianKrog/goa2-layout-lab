# GoA2 comparison desk

Start with one current working-tree view, then add up to two independent views.
Saved game situations, UI presentations and view setups have separate responsibilities; see [Lab terminology and saved state](docs/terminology.md).
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
contains situation metadata and independent presentations/view setups; full checkpoints are
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

1. Press **Start** on the default view, choose a Situation and start it. Import local saves or replays from **Saved situations** if needed. Replay index N applies exactly N recorded decisions.
2. Play to the desired prompt. Change Viewpoint to act for another hero.
3. Use **Save... > Situation**, enter a name and select the source view. This saves the full engine/rollback checkpoint only.
4. To reproduce an open menu, selected card or camera, use **Save... > Presentation** separately. Choose that Presentation in the view settings overlay when reopening the Situation.
5. Save source/device/layout/controller configurations independently with **Save... > View setup**. Add a view using the right-hand rail to inherit current game progress and UI state without resetting existing views.

Historical combined fixtures can still restore their bundled sources, seats and UI state via **Comparison tools > Restore legacy bundled setup**. Normal loading leaves this unchecked. See [terminology and saved state](docs/terminology.md) for the exact boundaries.

**Export** in Saved situations downloads a portable JSON bundle. Import it on another run
to restore the checkpoint (plus legacy presentation/source metadata when present). Source
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

Open **Crop image capture to an element**, enable **Crop screenshots**, enter a
CSS selector, then use **Capture** normally. The same selector and match policy
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

Prepare a comparison normally, then open **Compare HTML & CSS** below the views.
Select exactly two views using their **Capture** checkboxes and choose:

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
Factory outputs remain local drafts; curated turn-state, two-card Emmitt and
public rank-IV Wish copies are indexed in [the shared library](situations/README.md#completed-turns-off-board-heroes-and-final-card-variants). The off-board variant deliberately
removes Brogan and discards his unresolved card without claiming a natural play
sequence. No production saves or engine rules are modified.

`--status-only` limits the existing status runner to its ten-hero long-status
case and verifies horizontal as well as vertical row bounds. The spell runner's
`--rank4` mode uses a fabricated public Wish with all other prepared spells still
masked. It checks a spectator can inspect Large/Image at three sizes and the
Tiny row has solid rank-IV end accents without an initiative rail. It uses the
usual spell-runner ports 4700-4703/9700. These remain Live-versus-frozen-target
comparisons, and each owned diagnostic desk closes after capture.

### Staged mobile upgrades and runes (M6)

```sh
npm run test:mobile-batches
```

This regression owns ports 5910-5913/10910 and tests the configured frontend
working tree with shared situations `3fd1f952c1a6` (three upgrades) and
`0601f17bbdab` (Snorri inscription). The backend must advertise upgrade
`supports_preview` plus batch capabilities. Native mobile is checked against
real engine offers at 390x844, 360x800 and 844x390; the pinned userscript Target
is captured as a visual reference, not assumed to share native batch semantics.
Checks cover separate hypothetical Preview, Reset, Board peek/camera, immutable
staging, one accepted complete Commit, and viewport/navigation/five-point tap
bounds. A recovery flow covers legacy single-rune acknowledgment, actual reload,
Undo, reconnect and explicit batch confirmation without automatic replay.
Reports and images are written under ignored `.layout-lab/runtime/mobile-batches-*`.
Only owned services are closed. Normal checkout/ref/port overrides apply.

`test:mobile-confirm` supports both the new single-upgrade Commit and the legacy
Confirm picker, and continues testing desktop at all three sizes. Run it against
an older backend checkout with `GOA2_LAB_BACKEND` to verify capability fallback.
The gameplay and presentation regressions support batch rune staging while
retaining legacy single-choice transport coverage.

### Upgrade card visual states

```sh
npm run test:mobile-upgrade-parity
```

Uses isolated ports 5920-5923/10920 and the Live frontend versus frozen Base plus
userscript. At portrait, compact and landscape sizes it exports original-size
paired small-card crops, pixel diffs, viewport images and `cards.json` containing
focused computed styles. Initial, staged, hypothetical Preview, hover and keyboard
focus are compared. A local six-upgrade draft is restored through the engine and
advanced with legacy single confirmations to verify observed item-history states.
The runner asserts dimensions, icon geometry, border/background/shadow and opacity;
it does not assume that arbitrary screenshot differences prove a regression.
Animation is reduced consistently for stable viewed-card comparisons. The draft
stays local under ignored data. No whole-page CSS traversal is performed.
Evidence is under `.layout-lab/reviews/m6-parity-*`; owned services close on exit.

For focused reruns use `npm run test:mobile-upgrade-parity -- --profile=portrait`
(or `compact,landscape`). Each viewport also exports the standard combined-image,
pixel-diff and overlay viewer report; its report metadata is saved in
`<profile>-viewer.json`. `test:mobile-batches` accepts the same profile filter.

### Shared card artwork and blur comparison

`npm run test:mobile-card-visual` compares the live mobile renderers with the
frozen baseline plus userscript in Windows Chromium. It opens independent clones
of library situations for Arien Large upgrade/Deck readers, Small/Tiny Hand rows,
Brogan history/Nano discards, and Gydion Large/Image public spells including
rank IV as spectator. Use `-- --case=deck-large,spell-large --profile=portrait`
for a focused rerun. Generic card Image rendering has no equivalent target mode;
it is not presented as an equal-mode image comparison.

Evidence is saved under `.layout-lab/reviews/cards-*`: viewport report links,
per-card HTML/computed styles, artwork/mask/bar layers, and element crops. Hand,
history and discard crops combine visible matches individually without resizing.
The runner checks unchanged game hashes, native render errors and equal artwork
filter/scale/mask/opacity for text cards. Large headers/footers must use 5px
backdrop blur. No whole-document CSS is collected. The current crop helper cannot
resolve some fixed target previews in landscape; the manifest records that gap
and retains the full viewport report. Full images and reported source identities
remain the evidence; passing sampled checks does not establish universal parity.
Add `--selected` with `--case=deck-large,hand-small,spell-large` to compare the
selected-source sheen. It verifies the reduced-motion gradient and deterministic
1-second animation frames against Target, including 4s/4.2s timings and pointer
pass-through, then captures the selected rows. History/Nano/upgrade cases are
excluded in this mode.


### Native 2D camera and hero focus (M7)

`npm run test:mobile-camera` uses owned Windows Chromium views and the configured
backend services. Existing library situations cover Arien/Hanu focus, Razzle’s
owned-piece focus and movement target selection. It checks keyboard inspection
separately from centering, anchored pinch/twist, cancellation, portrait/compact/
landscape centering in the unobscured Board area, fit/reset and camera restore.
The final isolated clone submits a real movement target after a gesture. Paired
reference captures are saved under `.layout-lab/reviews/m7-camera-*`. This is
synthetic browser touch coverage; physical-device gestures remain M9 acceptance.

Native camera presentations now include an optional `angle`. Older saves without
it restore at zero rotation. The userscript continues using its separate saved
rotation adapter. Frozen frontend revisions lacking native rotation reject an
unsupported rotated camera copy explicitly. Equal viewports and matching panes
are still required before judging visual differences.


### Native mobile utilities (M8)

Run `npm run test:mobile-utilities` for the focused Windows Chromium check against
the configured frontend working tree. It owns ports 5980–5983/10980 and reuses
shared planning, Gydion public-spells and six-upgrade situations. It checks live
appearance/audio/language settings, reload persistence, fullscreen, the scoped
Decisions route and retry, layered spell/Deck navigation and upgrade preview
dismissal. Portrait, compact and short-landscape captures compare Live/mobile
with the pinned userscript Target. A separate native commit checks actual history
and spectator card masking after the paired captures. Generated evidence stays
under `.layout-lab/reviews/m8-utilities-*` and `.layout-lab/reports/`.

No native Linux tests or automatic phone activation are included. Browser touch
and fullscreen checks do not establish physical-device acceptance.

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

The default is one Live/Desktop view. Use **Add view** for a second or third view; the **Play solo** setup under Comparison tools remains available for one Live/mobile view.
In any regular view, open **Edit view**, choose the human **Viewpoint**, then
set **Other heroes** to **Random**, **Simple**, **ISMCTS**, **Manual**, or mixed choices.
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
