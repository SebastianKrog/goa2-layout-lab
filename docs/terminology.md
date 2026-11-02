# Lab terminology and flow

Choose a quickstart to play, or choose a **Layout** and then a **Situation** to
compare interfaces. Optional **Presentation** instructions describe what to open
or select. Loading another Situation keeps the chosen View configuration.

## State and inspection

| Term           | One responsibility                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Decision State | Exact resumable engine checkpoint, including pending requests, execution stack and deterministic state.    |
| Situation      | Named game moment referencing a Decision State, with description and tags. Contains no UI state or Layout. |
| Viewpoint      | Player or spectator whose information a View displays. Does not identify who must act.                     |
| Actor          | Hero performing the current game action.                                                                   |
| Responder      | Hero eligible to answer a pending request; can differ from the actor, or include several heroes.           |
| Session State  | Temporary UI state: open panel, selection, inspection, camera and scroll.                                  |
| User State     | Supported UI preferences such as card size, brightness and sound.                                          |
| Presentation   | Small, explicit Session State changes, such as Open Hand, select Gold Card or View public spells.          |

Selecting a planning card locally changes Session State; committing it changes
Decision State. A defense prompt can have an attacker as actor and defender as
responder. Viewpoint determines which private information the user can see.
Auto switch follows eligible responders by changing Viewpoint; it never plays moves.

## Views and execution

| Term                 | One responsibility                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Source               | Frontend code selection: Main, Base, Comparator commit, Live working tree or Base plus userscript Target.              |
| Interface            | Desktop or native mobile UI, configured by `uiMode`.                                                                   |
| Renderer             | 2D or 3D game rendering, independent of Interface and viewport dimensions.                                             |
| Device profile       | Emulated viewport dimensions and input capabilities, such as portrait phone or desktop.                                |
| View                 | One isolated browser context and game clone with its own Viewpoint and UI state. Game commands synchronize by default. |
| View settings        | Source, Interface, Renderer, Device profile, Viewpoint and configured controller policies.                             |
| Layout               | Reusable configured Views and synchronization policy. Contains no Situation or checkpoint.                             |
| Game group           | Runtime identity linking clones that receive the same game commands and bot decisions while synchronized.              |
| Bot decision service | Separate, lazy service computing one command from a checkpoint. The regular game backend applies it.                   |
| Quickstart           | Launch action creating a fresh working-tree game with predefined controllers and display settings.                     |
| Comparison           | Inspection of a Situation in a chosen Layout, optionally with Presentation instructions.                               |

Browser storage and menus remain isolated when game commands synchronize. The same
Situation can start multiple unrelated game groups; Situation ID does not identify
a live game. Controller changes apply to the group in synchronized modes and to one
View in None mode. A saved Layout stores controller choices, not running bot workers.

A separate window or physical device is another place to display a View. Detaching
a desk View retains its identity and controls; swapping positions changes arrangement.
Neither action changes the game. A device share joins matching current progress by
default; an independent share or quickstart creates a new group.

## Reviews and evidence

| Term         | One responsibility                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Review entry | One inspection with its own identity: Situation reference, optional Viewpoint and Presentation instructions.         |
| Review       | Named ordered entries with immutable revisions.                                                                      |
| Review Run   | One execution freezing game snapshots, entry instructions, Layout, source evidence, progress and reports.            |
| Report       | Capture-time evidence and comment, including game state, actual UI state, View settings, revisions and warnings.     |
| Lab session  | Reporting activity group for reports outside a Review Run. Created when the desk starts; New session is in Settings. |

A Lab session groups reports; a game group synchronizes gameplay; Session State
belongs to the UI. These are separate identities. Repeated Review entries may use
the same Situation with different inspection instructions. Previous/Next restores
the frozen step across desk and shared-device Views. Reviews use manual controllers
and disable auto switch while retaining the selected synchronization mode.

## Default flow

The empty desk opens no Views. It offers working-tree **2v2 quickstarts** for
Desktop, Mobile portrait and Device: RED is manual, BLUE uses ISMCTS, and auto
switch follows manual teammates. Device returns a link and QR code.

Comparison shortcuts pair **Main vs working tree** in two desktop, mobile portrait
or mobile landscape Views. Choose a Situation before loading. **Other Layouts…**
provides saved/custom arrangements. Opening a library Situation uses the chosen
Layout, falling back to Current, one desktop working-tree View, when none is chosen.

**Add view** copies current progress and UI into another clone in the same group.
Selecting a different Situation explicitly starts a separate game. View editors use
Start/Cancel for new Views and Save/Cancel for changes; staging failures preserve
existing games. Separate windows retain their controls and follow the same slot.

## Presentation resolution

Presentations contain only requested changes. Viewpoint is a separate View setting
or inspection `viewpoint` field. Full UI snapshots remain internal cloning/report
evidence; reusable presets exclude preferences, renderer, camera and game URLs.

Reusable presets target roles: `selectedCard: {role: "gold"}` or
`inspectedCard: {role: "upgrade", tier: 2, branch: "A"}`. Add `color` when several
upgrade paths match. `publicSpells: true` uses the viewing hero when applicable,
otherwise the sole spellcaster. Exact card IDs are allowed on Review entries and
ad hoc requests, rather than reusable presets.

Common, interface-specific and per-View instructions merge in that order. Fresh
loads begin with normal View defaults; applying a preset to a running View changes
it in place. Missing controls/cards and ambiguous targets warn without failing the
load or submitting a decision. Warnings appear on Views/devices and in evidence.
Preset values are copied into entries so later preset edits do not change a Review.

## Saving

- **Situation:** name an exact game moment, without menus or preferences.
- **Decision State:** save the checkpoint alone.
- **Presentation:** save one reusable session change.
- **Layout:** save configured Views and synchronization, without game state.

**Create from Decision State** names an existing checkpoint. Tags describe records
without changing checkpoint identity. See [storage and API contracts](state-model.md),
[workspace controls](workspace.md), [Reviews](reviews.md) and [tags](tags.md).
