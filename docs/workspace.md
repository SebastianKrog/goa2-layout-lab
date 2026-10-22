# Using the workspace

[Back to the lab overview](../README.md) · [Terminology](terminology.md)

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

Old situations have been ported into composed Situations and separate suggested Layouts. Runtime accepts the new model only; see [state storage and porting](./state-model.md). See [terminology and saved state](./terminology.md) for the exact boundaries.

**Export** in Saved situations downloads a portable JSON bundle. Import it on another run
to restore the exact Decision State and composed Presentation. Source
seat credentials are excluded; clones receive new tokens. Situation files contain
the full developer checkpoint, including hidden game information, while the
normal game UI continues receiving player-scoped views.

Saved Layout overrides, Presentation templates and local drafts live under ignored `.layout-lab` and survive restart.

### Situation library and folders

Use **situations** throughout the lab. Shared fixtures belong in `situations/<folder>/<id>.json` and are included in the repository. New saves, imports and generated situations go to `.layout-lab/situations/` as local drafts. Older formats require the [offline porting tool](./state-model.md#porting-older-situations); runtime imports accept composed Situations only.

The **Situations** page supports search by name, hero or folder and groups entries
by folder and Library / Local drafts. **New situation** holds creation/import
actions; each row keeps **Open situation** visible and puts Export, Move, device
sharing and promotion under **More**. The folder filter includes subfolders; Compare also groups its situation picker by folder. **Move** accepts paths such as `cards/defense` or `heroes/snorri` and creates folders as needed. The same operation works on shared fixtures and local drafts.

Choose **Add to library** on a local draft to create a new shared copy in the selected folder. The draft is retained, machine-specific runtime provenance is removed, and nothing is committed automatically. Review the JSON and commit it alongside the implementation when ready. Ordinary saves never overwrite shared fixtures.

The library includes normal and timed planning under `situations/planning/`, plus five basic card examples under `situations/cards/`: selection, action choice, a tier II upgrade, defense and discard. See [the situation library](../situations/README.md) for the saved moments and regeneration command. Each schema 2 Situation references an exact Decision State and includes its Presentation. Decision States are stored separately; no running server or runtime game IDs are required to reopen the moment.

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
