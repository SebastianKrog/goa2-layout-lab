# Device views and reports

Start the layout lab normally with `npm run compare`. In **Compare**, select any
saved situation and click **Open on device**. The same action is available on
each card in **Situations**. You do not have to load or replace a comparison first.

Choose a frontend, layout and player, then **Start device website**. Scan the QR
code using a phone or tablet on the same Wi-Fi, or open the displayed LAN link.
The QR image is generated locally; no QR service receives the link.

Each device view gets an independent playable clone. It cannot advance the
original situation or any comparison window. Live working tree uses the current
frontend files with live updates. Current build uses the lab's configured
comparator commit; Base and Userscript target retain their existing lab meaning.
Native mobile stays explicitly selected. A supported saved presentation is
restored, including safe planning selection and native camera. Unsupported
presentation details are listed in `window.__GOA2_DEVICE_RESTORE_WARNINGS__`.

The lab injects the floating **Report** userscript itself. No browser extension,
frontend dependency, frontend source edit, or production backend change is needed.
Tap it to open the form immediately and write while the screenshot is prepared.
Both the floating button and report dialog are excluded from the screenshot.
Hold the button for about half a second, then drag it; a short vibration confirms
move mode when supported. Its position is remembered. **Close** keeps the current
form; **Discard** clears it for a new capture. Save report stores:

- `.layout-lab/situations/device-reports/<id>.json`: a validated, resumable lab
  situation, with the reporting seat and captured presentation.
- `.layout-lab/reports/device/<id>/`: `screenshot.png`, `report.json`, and a copy
  of `situation.json`.

Refresh **Situations** to see the report. Load it with saved viewpoints to compare
the reported moment, or use **Open on device** again. Canceling the form creates
no catalog entry. Unsaved captures expire after one hour or a desk restart.
Retrying a save keeps the same report ID. Reports stay on your PC and contain the
full engine checkpoint, including private cards; share them deliberately.

Use **Stop sharing** in the dialog to revoke a link and close its WebSockets.
Closing the dialog leaves the website running; stopping the lab stops all device
views. Opening another device link in the same browser profile replaces that
profile's selected device view. Use another browser/profile for independent tabs.

## Play one hero with bots

Bots also work in regular desk views. Select **Views: 1 view** or the **Play solo**
setup for one board, or use two/three views. Under each view's **Edit view**, choose
its human **Viewpoint** and set **Other heroes** independently. Apply changes to a
loaded view keeps its current game moment. Reset uses that view's chosen bots;
saved setups retain controller choices. Changing the viewpoint leaves bot assignments unchanged. Synchronization is disabled
while any view has bots; independently driven clones may diverge.

The desk's `POST /api/load` accepts one to three `slots`, each with an optional
`bots` mapping using the same hero IDs and policies as device shares. Use
`restoreViews:false` when supplying a custom setup rather than restoring saved
slots. `POST /api/configure` with `{index,update:{bots:{...}}}` updates controllers
on that existing clone; an empty mapping turns them off without rewinding moves.
A single view supports Capture, Save and Reset; extraction still requires two.

Regular desk views also offer **Auto switch after each action** in **Edit view**.
This follows a player with a pending decision, keeping the current player while
still eligible. It only changes the viewpoint, not the game or bot assignments,
and can view a bot without taking control from it. It preserves the camera and
drops the old player's card selection. Off keeps the viewpoint fixed. Saved
setups and Reset retain the option (`autoSwitch:true` in a slot/configure update).
Phone shares keep their selected seat.


Use a backend checkout on the
[`bots-upstream` branch](https://github.com/SebastianKrog/goa2-backend/tree/bots-upstream)
of the backend fork. The folder name below is a local checkout convention; a
separate `goa2-backend-bots` GitHub repository is not required. In the lab's ignored
`.env.layout-lab`, select it with:

```dotenv
GOA2_LAB_BACKEND=../goa2-backend-bots
```

Restart the lab after changing the backend path. Preserve any ongoing human games
before restarting; an already configured running desk can be reused directly.
This is a lab configuration change; the backend and frontend repositories need
no edits. Runtime startup omits development/training dependency
groups, so it does not install neural-network packages.

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
may fall back to Simple on a timeout or failure under the backend's existing
bounded runtime.
Configure both teammates and opponents when playing alone;
a Manual hero can leave the game waiting for another human. Your chosen hero
always remains human-controlled.
Bots are unavailable when watching as Spectator. A backend without bot support
keeps the ordinary manual device flow and shows an availability message.

Press **Start device website** and scan its QR code. Bots play the independent
clone until a human decision is needed, including upgrades and rune choices.
Timed situations still need the human's Ready confirmation; bots ready themselves.
The lab's usual frozen clocks remain in effect, so this does not verify production
timeouts. A lab-only transport shim tolerates already-closed sockets during rapid
device reconnects; backend source is unchanged.

**Stop sharing** also stops that device game's bot workers while retaining its
local recovery save. Reports record which bots were selected as provenance, and
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
- `POST /api/device-open` creates an independent clone and returns its link/QR
  metadata. Use real situation and hero IDs from the selected situation.
- `POST /api/device-stop` with `{"id":"<returned-device-id>"}` revokes a share
  and cancels its bot workers.

Example request body for a supported mobile frontend:

```json
{
  "situationId": "<saved-situation-id>",
  "restoreViews": true,
  "slot": {
    "source": "live",
    "seat": "<human-hero-id>",
    "render": "2d",
    "layout": "mobile",
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
also cover human-seat exclusion, invalid controllers, unsupported backends, timed
Ready handling, stopping workers while retaining recovery, and reconnects. This
coverage does not establish full-match, every-hero or physical-phone acceptance.
ISMCTS adapter tests verify default settings, heuristic-only policy/value, and
search with neural/training imports blocked, including the valid timeout path.

For autoswitch acceptance, `node test/autoswitch-e2e.mjs --env-file=.env.layout-lab --display=browser`
starts and owns a test desk. Set distinct `GOA2_LAB_*_PORT` values first so it does
not collide with a running desk. It commits QA cards explicitly, checks viewpoint
following and the off state, verifies that switching takes no extra actions and
leaves bot assignments unchanged, then closes its test desk. Evidence is under
`.layout-lab/reviews/autoswitch/`.
