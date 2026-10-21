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
Tap it to open the form immediately and write while the screenshot is prepared. Both the floating button and report dialog are excluded
from the screenshot. Save report stores:

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

Device-report situation cards also offer **View report**, showing the full comment and screenshot together.

Hold the Report button for about half a second, then drag it. A short vibration confirms move mode when the browser supports it. Its position is remembered. Close keeps the current form; Discard clears it for a new capture. Screenshot preparation yields regularly so typing stays responsive, shares repeated icon requests, and avoids encoding full-resolution offscreen card canvases.
