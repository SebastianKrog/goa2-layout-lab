# Commit selection, situation loading and live handoff

## Discover and pin sources

Resolve the lab root, frontend checkout, backend and optional userscript checkout from src/config.mjs and GOA2_LAB_FRONTEND / GOA2_LAB_BACKEND / GOA2_LAB_PATCH. TOOL is the lab, ROOT is the frontend, DATA is ignored .layout-lab. Do not copy this installation's absolute paths into portable scripts.

Resolve A and B in the frontend repository using Git argument arrays, without switching the user's branch:

```javascript
import { execFileSync } from "node:child_process";
const resolve = (repo, ref) =>
  execFileSync("git", ["rev-parse", "--verify", ref + "^{commit}"], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
const baseSha = resolve(frontendRoot, requestedA);
const compareSha = resolve(frontendRoot, requestedB);
const scriptSha = resolve(patchRoot, requestedScriptRef); // when using Target
```

Confirm the requested revisions exist locally. Do not silently substitute HEAD, fetch another remote, or change the checkout. If the request says newest comparator, resolve the configured branch (normally mobile-migration) once and record that SHA. Base and Comparator exports are immutable Git archives cached by the lab. Model assets are copied from the working checkout only when their checksum matches that commit's scripts/model-assets.json. Missing model bytes or unsupported instrumentation are real preparation failures; inspect the supplied error and repo asset preparation command rather than drawing an incomplete scene.

Target loads dist/goa2-mobile-2d.user.js from the pinned userscript repo commit. It always overlays Base A. There is no public arbitrary userscript-file upload or target-on-B slot. Script refs are resolved at startup; no Target slot is needed for a plain two-commit comparison.

## Launch or reuse

Read GET /api/status and /api/catalog if a desk is already running. Frozen Base/script refs are startup settings. Comparator can be switched with POST /api/refresh {ref:compareSha}. The API preserves existing game clones while reopening affected committed-comparator views, but these are still the user's views: prefer an owned instance if replacing their workspace is unnecessary.

From the lab root, in a persistent terminal:

```sh
npm start -- --base-ref=BASE_SHA --comparator-ref=COMPARE_SHA --script-ref=SCRIPT_SHA --preset=desktop-2d --no-auto-load
```

Use --preset=desktop-3d for two desktop 3D defaults or --preset=mobile for the three migration defaults; explicit load slots below determine the actual views when --no-auto-load is used. Omit --script-ref for two views when no script ref was requested. Defaults still resolve the configured script SHA but no script is injected without Target. For automated static capture, add --headless --no-open --verification. These flags are not a live human viewer.

Windows defaults to a Windows desk/browser and WSL services. Linux/macOS default to native services. Use the existing configured environment; do not run Linux/WSLg acceptance suites on this installation. To isolate an instance set all five GOA2*LAB*\*\_PORT variables in its process environment, for example DESK=3300, BASE=3301, COMPARATOR=3302, LIVE=3303, BACKEND=8300. Also use that desk port in every subsequent request. Do not kill occupied-port owners.

For a detached Windows human viewer, set those environment variables and launch hidden with logs; the Electron app itself is the visible interface:

```powershell
$labNode = (Get-Command node).Source
$viewer = Start-Process -FilePath $labNode -ArgumentList @('launch.mjs', "--base-ref=$baseSha", "--comparator-ref=$compareSha", '--no-auto-load') -WorkingDirectory $labRoot -WindowStyle Hidden -RedirectStandardOutput "$labRoot/.layout-lab/runtime/viewer.stdout.log" -RedirectStandardError "$labRoot/.layout-lab/runtime/viewer.stderr.log" -PassThru
```

Ensure the log directory exists first. Add --script-ref when requested. Keep the owning process/terminal alive through handoff. Preparation can take minutes on a cold cache; check status/logs and keep the user informed instead of launching duplicate instances.

## Public API and slots

Use the public local desk API, without extracting the private backend credential:

```javascript
const origin = "http://127.0.0.1:3300";
async function request(name, body) {
  const response = await fetch(origin + "/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || JSON.stringify(value));
  return value;
}
const catalog = await request("catalog");
const situation = catalog.situations.find((s) => s.id === requestedSituationId);
if (!situation)
  throw Error("Requested situation is not in this desk's library");
const seat = "hero_arien"; // use the actual chooser, e.g. hero_brogan for defense/discard
const slots = [
  {
    label: "Commit A",
    source: "base",
    profile: "desktop",
    render: "2d",
    uiMode: "desktop",
    seat,
  },
  {
    label: "Commit B",
    source: "comparator",
    profile: "desktop",
    render: "2d",
    uiMode: "desktop",
    seat,
  },
];
await request("load", { situationId: situation.id, slots });
await request("synchronize", { mode: "none" });
await request("cheats", { show: false });
const status = await request("status"),
  views = await request("views");
```

Loading retains the supplied View settings and applies the Situation's composed Presentation. Use `overrides` to pin an intentional Viewpoint, panel or camera, and record such overrides when judging parity.

A two-phone comparison can use portrait/2d with desktop Base and a supported mobile Comparator. A third script view is {label:"A + userscript",source:"target",profile:"portrait",render:"2d",uiMode:"desktop",seat}. For three comparable phone columns set the other profiles to portrait too. Use render:"3d" and desktop layout/profile on both A and B for two desktop 3D views. The current slot validator accepts one, two or three entries, Base desktop shell, and Target desktop/2d. Two different commits with both native mobile shells are not currently expressible via Base/Comparator; report that limit if requested rather than passing both through the one Comparator source.

## Preserve saved presentation when changing the slot set

A Situation contains one explicit Presentation. Distinct saved player/UI variants are separate Situations sharing a Decision State. To adapt a comparison, keep that Decision State, choose Views with the required sources/devices/interfaces, and set explicit Presentation overrides when needed. For example:

```js
const slots = [
  {
    source: "base",
    profile: "desktop",
    render: "3d",
    uiMode: "desktop",
    seat,
    overrides: {
      viewpoint: seat,
      sessionState: { render: "3d", pane: "board", camera: null },
    },
  },
  {
    source: "comparator",
    profile: "desktop",
    render: "3d",
    uiMode: "desktop",
    seat,
    overrides: {
      viewpoint: seat,
      sessionState: { render: "3d", pane: "board", camera: null },
    },
  },
];
await request("load", { situationId: situation.id, slots });
```

Use Save Situation to capture a new moment; Save Layout stores View settings independently. Presentation templates can be applied without changing the game. There is no bundled legacy restore mode.

## Synchronization

POST /api/synchronize {mode:"none"|"api"|"api-clicks"}. Any interacted view can drive the others. API mode mirrors game actions using the actor's seat while UI stays independent. API + clicks also mirrors matching semantic UI controls without submitting the game action twice. Unmatched controls are skipped. Neither mode guarantees camera/drag/keyboard parity. Reset/load the same checkpoint before enabling sync if games diverged. Use None while arranging different UI states, API when matching game progression, and API + clicks when the human wants matching supported controls.

POST /api/reset {} resets all clones to the loaded checkpoint; {index:0} resets one and can leave it different from other windows. Save the intended checkpoint/presentation before exploring if exact restoration matters. Preserve each distinct window's game with POST /api/save {index,name}; one save contains that window's game plus all presentations, not every independently advanced game. Do not assume one save preserves several different live checkpoints.

A human-ready handoff includes the active native app, desk URL, exact A/B/script SHAs, situation, slot intents, sync mode, any missing UI and instructions to reset. Leave the process running. Stop only its owned instance later with npm start -- --stop from an environment using the same desk port, or POST /api/shutdown. A report's static directory remains usable after shutdown; localhost desk/report URLs do not.

## Physical device views

Use the desk's **Open on device** action to start an independent clone of any
saved situation. It returns a LAN link and locally generated QR code, without
replacing comparison windows. The injected report userscript saves a screenshot,
comment and resumable situation into the lab. See [device testing](../../../../docs/device-testing.md)
for setup and limits. The private desk API exposes GET /api/device/options?situationId=ID,
GET /api/device/views, POST /api/device-open {situationId,slot,bots?}, and
POST /api/device-stop {id}. Keep returned capability links private. A stopped desk
revokes all links. No frontend or production-backend edits are required.

For a playable human hero with Random/Simple/ISMCTS opponents or teammates, use
[goa2-play-bots](../../goa2-play-bots/SKILL.md). Its device clone can run alongside
the comparison; automation belongs to that clone only.
