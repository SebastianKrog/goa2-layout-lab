# Device views and reports

Start the layout lab normally with `npm run compare`. In **Compare**, select any
saved situation and click **Open on device**. The same action is available on
each card’s **More** menu in **Situations**. You do not have to load or replace a comparison first.

Choose a frontend, Interface preset and Viewpoint, then **Start device website**. Scan the QR
code using a phone or tablet on the same Wi-Fi, or open the displayed LAN link.
The QR image is generated locally; no QR service receives the link.

Each device View gets a playable clone. By default, a matching running game
shares its current progress and synchronization group, so device actions also
reach the desk Views. A new game starts its own group; saved Situations never
change. API callers can set `independent:true` to start a separate device game. Live working tree uses the current
frontend files with live updates. Current build uses the lab's configured
comparator commit; Base and Userscript target retain their existing lab meaning.
Native mobile stays explicitly selected when supported by that source. A share
can copy the current View UI snapshot, including safe planning selection and
native camera; the Situation itself contains no UI state. Unsupported
presentation details are listed in `window.__GOA2_DEVICE_RESTORE_WARNINGS__`.

The lab injects the floating **Report** userscript itself. No browser extension,
frontend dependency, frontend source edit, or production backend change is needed.
Tap it to open the form immediately and write while the screenshot is prepared.
Both the floating button and report dialog are excluded from the screenshot.
Hold the button for about half a second, then drag it; a short vibration confirms
move mode when supported. Its position is remembered. **Close** keeps the current
form; **Discard** clears it for a new capture. Save report stores:

- `.layout-lab/situations/device-reports/<id>.json`: a validated, resumable lab
  game-only Situation. The report stores the captured Presentation separately.
- `.layout-lab/reports/device/<id>/`: `screenshot.png`, `report.json`, and a copy
  of `situation.json`.

Refresh **Reports** to see the evidence. Load the saved Situation and reconstruct
the desired sparse Presentation instructions from its captured UI evidence. Choose
Viewpoint and display settings separately; a full report snapshot is not a preset. Canceling the form creates
no catalog entry. Unsaved captures expire after one hour or a desk restart.
Closing an empty report discards the unused capture. A report with a comment is kept when closed, resuming autoswitch while preserving its screenshot and comment across viewpoint changes and reloads in the same browser tab. An open form defers navigation; only screenshot capture pauses bots. Retrying a save keeps the same report ID. Reports stay on your PC and contain the
full engine checkpoint, including private cards; share them deliberately.

Use **Stop sharing** in the dialog to revoke a link and close its WebSockets.
Closing the dialog leaves the website running; stopping the lab stops all device
views. Opening another device link in the same browser profile replaces that
profile's selected device view. Use another browser/profile for independent tabs.
A player token owns one active game socket: opening the same player link in another
browser can disconnect the phone. Create a separate device View for simultaneous
clients; its clone has fresh tokens and can join the same synchronized group.

## Quickstart a 2v2 game

On the empty desk, choose **Desktop**, **Mobile portrait** or **Device** under
Working tree quickstarts. Each starts the shared opening with two manual RED
heroes, two ISMCTS BLUE bots and autoswitch between the human teammates. Device
shows its link and QR immediately; it does not reserve a View in the main desk.
The separate bot decision checkout below is required. Each start creates a fresh
game group and leaves the Situation library unchanged.

`POST /api/quickstart` accepts `{id:"desktop"}`, `{id:"portrait"}` or
`{id:"device"}`. The response contains `comparison` or `device`, respectively.

## Play one hero with bots

Bots also work in one to three regular desk Views. Start one View from
**Other Layouts…**, or load a saved Layout and Situation. Use **Add view** for more. Under each view's **Edit view**, choose
its human **Viewpoint**, expand **Controllers and auto switch**, and set
**Other heroes** for the game group. Expand **Individual heroes** for mixed controllers. Applying changes to a
loaded View keeps its current game moment. Reset uses that view's chosen bots;
saved setups retain controller choices. Changing viewpoint leaves assignments
unchanged. API synchronization is the default and supports bots: one decision is
computed and replayed across the group. Choose None explicitly for independent
games and per-View controllers.

The desk's `POST /api/load` accepts one to three `slots`, each with an optional
`bots` mapping using the same hero IDs and policies as device shares. Choose Viewpoint and display settings in `slots`; Situations have no saved
View configuration. `POST /api/configure` with `{index,update:{bots:{...}}}` updates controllers
for its synchronized game group (or that View in None mode); an empty mapping
turns them off without rewinding moves.
A single view supports Capture, Save and Reset; extraction still requires two.

Regular desk views also offer **Auto switch after each action** in **Edit view**.
This follows a player with a pending decision, keeping the current player while
still eligible. It only changes the viewpoint, not the game or bot assignments,
and can view a bot without taking control from it. It preserves the camera and
drops the old player's card selection. Off keeps the viewpoint fixed. Saved
setups and Reset retain the option (`autoSwitch:true` in a slot/configure update).
Phone shares can also set `autoSwitch:true` on their slot. Quickstarts use
`autoSwitchManualOnly:true` to exclude bot-controlled heroes; ordinary autoswitch
still permits viewing bot decisions. The same game continues when device
credentials change. An unfinished device report defers switching.

Keep the regular game backend and the bot checkout separate:

```dotenv
GOA2_LAB_BACKEND=../goa2-backend
GOA2_LAB_BOT_BACKEND=../goa2-backend-bots
GOA2_LAB_BOTS_PORT=8110
```

The bot checkout uses the maintained `bots-upstream` branch. One lab-only service
starts when a bot needs a decision; it never hosts frontend games. It receives
an isolated checkpoint and returns one command. The lab checks for stale state
before applying it through the regular backend. Game clones have no autonomous
bot workers. Each service uses its own cached Python environment; neither product
repository needs edits and no neural/training packages are needed. Restart after
changing checkout paths, preserving any ongoing human games first.

Open any saved situation with **Open on device**. For current phone edits,
choose **Live working tree** and **Mobile 2D**. Choose **Your hero**, then use
**Set all others** to select **Random**, **Simple**, **ISMCTS** or **Manual**, or choose each
other hero's controller individually. Individual differences show **Mixed**.
Random picks legal actions; Simple uses the fork's basic heuristic policy.
ISMCTS uses heuristic policy and heuristic evaluation without a neural network.
The lab leaves numerical search settings at backend defaults (currently 200
iterations, a two-second decision limit, `bounded_continuation`, and horizon 2
rounds). No model artifact or training dependency is loaded, and the lab accepts
only the `ismcts` policy string, not custom search/learned configuration. Search
falls back to Simple if the default search deadline is exceeded or its output
is invalid. The fallback is recorded as a View warning.
Configure both teammates and opponents when playing alone;
a Manual hero can leave the game waiting for another human. Your chosen hero
always remains human-controlled.
Bots are unavailable when watching as Spectator. A missing bot checkout
keeps the ordinary manual device flow and shows an availability message.

Press **Start device website** and scan its QR code. A synchronized share inherits
its group's controllers and current progress. Otherwise it starts from the saved
Situation. Bots answer their decisions, including upgrades and rune choices,
and wait for human choices.
Timed situations still need the human's Ready confirmation; bots ready themselves.
The lab's usual frozen clocks remain in effect, so this does not verify production
timeouts. A lab-only transport shim tolerates already-closed sockets during rapid
device reconnects; backend source is unchanged.

**Stop sharing** removes that device from the group and future bot decisions,
while retaining its local recovery save. Other Views continue playing. Reports record which bots were selected as provenance, and
the saved source situation itself stays unchanged. Reopening a report/saved
situation does not automatically restart those bots; select controllers again.

Agents should use the versioned [goa2-play-bots skill](../agent/skills/goa2-play-bots/SKILL.md)
for setup and handoff.

### Desk API

Use the localhost desk origin (default `http://127.0.0.1:3200`) for orchestration.
These endpoints work alongside comparison windows and existing device sessions:

- `GET /api/device/options?situationId=<id>` returns actual hero IDs in `seats`
  and supported policies in `botKinds` (`random`, `heuristic`, `ismcts`, or empty if absent).
- `GET /api/device/views` lists active shares; avoid creating duplicates when a
  suitable session is already running.
- `POST /api/device-open` creates a clone and returns its link/QR metadata. It
  joins the matching current game group unless `independent:true` is supplied.
  Omit `bots` to inherit controllers; conflicting policies are rejected.
- `POST /api/device-stop` with `{"id":"<returned-device-id>"}` revokes a share
  and removes that View from future group commands.

Example request body for a supported mobile frontend:

```json
{
  "situationId": "<saved-situation-id>",
  "slot": {
    "source": "live",
    "seat": "<human-hero-id>",
    "render": "2d",
    "uiMode": "mobile",
    "profile": "portrait"
  },
  "bots": {
    "<other-hero-id>": "random",
    "<another-hero-id>": "heuristic"
  }
}
```

**Simple** is `heuristic` and **ISMCTS** is `ismcts` in the API. Omit Manual heroes and the human seat from
`bots`; do not send `manual` as a policy. Spectator plus bots is rejected. To play
alone, include every other hero. No private lab/backend credential extraction is
needed; call the desk rather than private clone endpoints. Treat the returned
LAN URL as a temporary player capability, not a permanent join link.

## LAN setup

The desk stays on localhost. Only the device gateway listens on the LAN, on port
3300 by default. On Windows this gateway runs on Windows and proxies to the lab's
existing WSL services, so it needs **no Windows-to-WSL port forwarding**.

Once, from **Administrator PowerShell** in the lab checkout:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/device-access.ps1
```

This allows port 3300 only on private networks from the local subnet. Use
`-Remove` to undo it. A custom port uses `-Port <port>` on the helper.
Linux/macOS users should allow the chosen port in their local firewall if needed.
Guest Wi-Fi/client isolation can prevent devices from reaching one another.

`GOA2_LAB_DEVICE_PORT` changes the gateway port. `GOA2_LAB_DEVICE_HOST` overrides
the IP/hostname printed in the link and QR code if automatic Wi-Fi detection picks
the wrong interface. Restart the desk after changing these. Existing frontend,
backend and source overrides remain unchanged.

The LAN link is a temporary capability for that clone. It grants the selected
player's ordinary controls plus report capture for that game. It does not expose
the desk, private lab credential, full checkpoints, other games or report files.
Use it only on a trusted LAN; normal LAN HTTP is unencrypted.

## Verification

`node --test test/device-server.test.mjs` checks QR generation, HTTP/WebSocket
scoping, link revocation, insecure-HTTP compatibility, and screenshot/report flow
in Windows Chromium. `node test/device-e2e.mjs` checks an existing shared situation
through an owned running desk, saves a report and reopens its selected card.
It leaves one device link ready and writes evidence under
`.layout-lab/reviews/device-testing/`. Browser emulation does not establish
physical iOS/Android acceptance. Screenshot and checkpoint capture start together;
an incoming game update can fall between them.

Device-report situation cards also offer **View report**, showing the full
comment and screenshot together. Screenshot preparation yields regularly so typing
stays responsive, shares repeated icon requests, and avoids encoding
full-resolution offscreen card canvases.

For bot integration acceptance, run against an owned running test desk:

```powershell
npm run test:device-bots -- --env-file=.env.layout-lab
```

This exercises Random and Simple through the real device dialog, gateway and
phone-sized Chromium. It submits QA human moves to check progression, stops its
test clones, and leaves a fresh Random game ready. Evidence, including a local QR,
is written under `.layout-lab/reviews/device-bots/`. This runner is for verifying
the feature; ordinary play should use **Open on device** directly.

`node test/play-bots-e2e.mjs --env-file=.env.layout-lab` checks the regular desk's
single view, mixed Random/ISMCTS controllers, Simple in a second view, switching
to Manual without resetting, single-view
capture, and independently configured two-view games. Run it only against an
owned empty desk: it rejects existing loaded views, then clears its test clones.
Evidence is saved under `.layout-lab/reviews/play-bots/`.

The device integration was checked with Random and Simple committing the three other heroes,
then advancing a real human card commit into resolution. The focused lab tests
also cover human-seat exclusion, invalid controllers, missing bot checkouts, timed
Ready handling, detaching Views while retaining recovery, and reconnects. This
coverage does not establish full-match, every-hero or physical-phone acceptance.
ISMCTS adapter tests verify default settings, heuristic-only policy/value, and
search with neural/training imports blocked, including the valid timeout path.

For autoswitch acceptance, `node test/autoswitch-e2e.mjs --env-file=.env.layout-lab --display=browser`
starts and owns a test desk. Set distinct `GOA2_LAB_*_PORT` values first so it does
not collide with a running desk. It commits QA cards explicitly, checks viewpoint
following and the off state, verifies that switching takes no extra actions and
leaves bot assignments unchanged, then closes its test desk. Evidence is under
`.layout-lab/reviews/autoswitch/`.
