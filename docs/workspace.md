# Using the workspace

[Back to the lab overview](../README.md) · [Terminology](terminology.md)

## Sources and presets

- **Main**: the configured frontend mainline ref (default: `origin/HEAD`, then local `main`/`master`), resolved once at startup (`GOA2_LAB_MAIN_REF` / `--main-ref`).
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

The empty desk opens no Views. Working-tree quickstarts offer one desktop,
mobile portrait or physical-device game: RED is human-controlled, BLUE uses
ISMCTS bots, and autoswitch follows only the human heroes. Device shows a link
and QR without reserving space in the desk. The separate bot decision checkout is required.

Comparison shortcuts pair Main and the working tree in two desktop, portrait or
landscape Views. Choose a Situation, then Load. **Other Layouts…** retains the
custom setup controls and arrangements such as **Mobile migration**,
**Layout regression** and **3D regression**. Every slot
can independently select a source, player/spectator seat, device and renderer.
Duplicate sources are supported. Target is restricted to the legacy 2D shell;
the script activates on phone profiles and remains inactive on desktop.

Select **Native mobile** on Main/Comparator/Live 2D. The tool requests
`ui=mobile&3d=0`; the selected revision determines whether it supports the mobile
shell. If Main lacks it, the comparison keeps the phone viewport and shows
Main's desktop shell with a warning. The effective View settings and evidence
record that fallback. Base and Userscript target keep their original interfaces. Desktop comparisons explicitly choose the desktop shell and 2D/3D.

Each window has its own browser storage and game ID, including when two windows
use the same hero. Game actions reach matching clones in their game group by
default; menus and cameras remain independent. Changing a device,
renderer or seat keeps that window's game. **Reset** replaces only its game with
the saved checkpoint; **Reset all** does so for every window.

## Live updates and synchronization

Turn on **Live updates** in **Settings → Current build** to switch Current build views to the frontend working tree.
Vite hot reload picks up edits, including uncommitted changes. The game, seat, camera, Base and Userscript target stay in place.
Turn it off to return to the selected comparator commit. **Use latest commit** refreshes that pinned comparator separately.

**Synchronize**, in **Workspace tools**, defaults to **API requests**. Game
commands from any View are applied to every clone in its game group, including
linked device Views. UI menus, cameras and selections remain independent.
Separate play sessions keep separate groups even when they use the same saved
Situation. Bot policies belong to the group while synchronized: choose once in
any View, and one separate bot service supplies each decision for all clones.
Any view can drive the others:

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
The active synchronization mode is included in captures and saved Layouts;
loading a Layout applies its policy.

Cheats controls are hidden by default, including in development builds.
Use **Settings > Show Cheats controls** to reveal them for debugging. This visibility setting does not rewrite the saved game's engine state.

## Swap View positions

Use a View's **More…** menu and choose **Swap with View B** (or another View).
This swaps their positions on the desk without changing View letters, settings,
game progress or captures. The menu is also available in separate View windows;
those windows stay on their current screens. Position swaps last for the desk
page's session and do not change saved Layouts.

## Use a second screen

Press **Open in window** in a running View's footer, then move the new window to
another screen. The View's **Edit view**, **Fit / 100%**, capture-selection checkbox
and **Return to lab** controls move with it. Shared Situation, Review, reporting
and workspace controls stay in the main lab. The title bar moves with the View,
and the remaining desk Views share the freed space. If all Views are detached,
the main desk collapses to a compact Add view row.

**Edit view** overlays the View being edited. In a separate window, its editor
opens inside that window. It opens from the desk’s cached settings immediately;
additional roster details load afterward. Roster results and pending requests
are reused for the same game or Decision State. Lookups return only seat metadata
and bot availability, without downloading the checkpoint or querying Git. Closing or saving it returns to the
same game surface.

The window follows that View slot through Situation loads, resets and Review
steps. Moving it preserves the current game and Presentation. **Return to lab**
or closing the separate window brings it back without resetting it. Removing
its slot closes the window; stopping the lab closes all its View windows.

Native windows retain the original Chromium game surface and device dimensions.
The browser desk uses its existing interactive stream in a popup; allow popups
for the lab if prompted. Separate windows are session-only and are not saved in
Layouts. Browser popups close when their main lab page closes or reloads.

## Save and reproduce a situation

1. Select a Layout, Situation and optional Presentation in the toolbar, then **Load all views**. Import local saves or replays from **Situations** if needed. Replay index N applies exactly N recorded decisions.
2. Play to the desired prompt. Change Viewpoint to act for another hero.
3. Use **Save... > Situation**, enter a name and select the source View. This saves the exact game moment without Presentation or Layout.
4. **Save... > Presentation** saves one session change: the current panel, a card role or public spells. It excludes preferences, viewpoint and incidental camera/scroll state. Exact card IDs belong on Review entries. **Save... > Decision State** saves game-only state; **Create from Decision State** composes another Situation.
5. Save view arrangement, source/device/UI mode/controllers and synchronization independently with **Save... > Layout**. Add a view using the right-hand rail to inherit current game progress and UI state without resetting existing views.

Old Situations have been ported into game-only records and independent Presentation presets. Runtime accepts the new model only; see [state storage and porting](state-model.md). See [terminology and saved state](terminology.md) for the exact boundaries.

**Export** in Situations downloads a portable JSON bundle. Import it on another run
to restore the exact Decision State. Presentation instructions are independent. Source
seat credentials are excluded; clones receive new tokens. Portable exports include
the full developer checkpoint, including hidden game information, while the
normal game UI continues receiving player-scoped views.

Saved Layout overrides, Presentation templates and local drafts live under ignored `.layout-lab` and survive restart.

### Situation library and folders

Use **situations** throughout the lab. Shared fixtures belong in `library/situations/<folder>/<id>.json` and are included in the repository. New saves, imports and generated situations go to `.layout-lab/situations/` as local drafts. Older formats require the [offline porting tool](state-model.md#porting-older-situations); runtime imports accept schema-3 independent Situations only.

The **Situations** page supports search by name, hero or folder and groups entries
by folder and Library / Local drafts. **New situation** holds creation/import
actions; each row keeps **Open situation** visible and puts Export, Move, device
sharing and promotion under **More**. The folder filter includes subfolders; Compare also groups its situation picker by folder. **Move** accepts paths such as `cards/defense` or `heroes/snorri` and creates folders as needed. The same operation works on shared fixtures and local drafts.

Choose **Add to library** on a local draft to create a new shared copy in the selected folder. The draft is retained, machine-specific runtime provenance is removed, and nothing is committed automatically. Review the JSON and commit it alongside the implementation when ready. Ordinary saves never overwrite shared fixtures.

The library includes normal and timed planning under `library/situations/planning/`, plus five basic card examples under `library/situations/cards/`: selection, action choice, a tier II upgrade, defense and discard. See [the situation library](../library/README.md) for the saved moments and regeneration command. Each schema-3 Situation references an exact Decision State, with no Presentation or Layout. Decision States are stored separately; no running server or runtime game IDs are required to reopen the moment.

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
without an equivalent panel shows a nonblocking availability warning. The camera
bridge restores native 2D pan/zoom and 3D camera/OrbitControls state, without
clicking game tiles. **Copy camera to matching views** never copies between 2D
and 3D. Switching render modes restores that mode's remembered viewpoint.

Timed games retain clock UI but use frozen server/browser wall time. Ordinary
UI timers, animation frames and networking continue normally. No automatic
deadline worker advances the game. Imported save clocks are settled at their
file timestamp; replay clock values are labelled reconstructed. Running-clock
simulation is not part of the desk.
