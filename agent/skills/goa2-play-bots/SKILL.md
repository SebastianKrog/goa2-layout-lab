---
name: goa2-play-bots
description: Set up GoA2 lab play against Random, Simple or ISMCTS bots in synchronized desk/device Views, with phone links, QR codes and lab reporting.
---

# Play GoA2 against bots

Keep orchestration, bot inference and reporting in this repository. Follow
[terminology](../../../docs/terminology.md), [device setup](../../../docs/device-testing.md)
and [runtime setup](../../../docs/setup.md). Preserve ongoing human games;
use an owned desk with the [complete isolated ports](../../../docs/setup.md#isolate-an-acceptance-desk)
for acceptance tests.

## Separate the two services

Views use the regular `GOA2_LAB_BACKEND` checkout. One separate decision service
uses `GOA2_LAB_BOT_BACKEND` (default `../goa2-backend-bots`, `bots-upstream`) and
`GOA2_LAB_BOTS_PORT` (default 8110). It starts lazily, uses its own Python/cache
environment and computes one command per checkpoint. It has no persistent games
or autonomous workers. Neither product repository needs modification.

Read `GET /api/device/options?situationId=ID` for actual seats and `botKinds`.
Random is `random`, Simple is `heuristic`, and ISMCTS is `ismcts`. Search uses a 10-second decision budget and two-game-turn continuation horizon,
with other numerical defaults unchanged,
heuristic policy/value, and no learned artifacts. The lab value evaluator adds
small printed-range attack setup, friendly minion cover and enemy ranged-minion
exposure preferences; see the search budget section in runtime setup.
Deadline/invalid-search output can fall back to Simple with a warning. Do not
install neural or training dependencies for this workflow.

## Choose the game and controllers

The empty desk offers Desktop, Mobile portrait and Device working-tree 2v2
quickstarts. `POST /api/quickstart {id:"desktop"|"portrait"|"device"}` clones the
shared opening without Situation drafts. RED is manual, BLUE uses ISMCTS, and
autoswitch follows the manual teammates. Device returns a link and QR directly.
Quickstarts create a fresh game group, unrelated to reporting Lab sessions.

For other rosters/moments reuse a game-only Situation, or use the
[situation skill](../goa2-ui-situations/SKILL.md) to create one. Layout chooses
Views; Presentation instructions only alter menus/card selections. Leave at
least one hero manual. Device creation requires a manual selected seat.

Game synchronization defaults to API requests. Every View in a game group,
including linked devices, receives the same human and bot commands; UI state and
camera remain independent. The bot service computes each decision once for that
group. Controller changes in a View apply to the group and keep its current game.
Explicit None mode keeps games/controllers independent. Do not disable sync merely
to arrange different menus or cameras.

`POST /api/load` accepts one to three `slots` with optional `bots` maps. Matching
policies merge across synchronized slots; conflicting policies fail. Use
`POST /api/configure {index,update:{bots:{...}}}` to change controllers; `{}` stops
automation without rewinding moves. These are lab policies, never game-backend bot
configuration. State/controller changes invalidate in-flight results before apply.

## Phone and viewpoint following

Use Open on device or `POST /api/device-open {situationId,slot,bots?}`. A matching
running game joins the current progress/group; omit `bots` to inherit controllers.
`independent:true` creates a separate device game. Use actual hero IDs, omit Manual
entries and never automate the selected device seat. Keep capability URLs private.
Return the generated LAN link and QR; localhost access does not establish LAN
access. See the device guide for gateway/firewall setup.

`autoSwitch:true` follows eligible responders without playing their moves.
`autoSwitchManualOnly:true` skips bot-controlled heroes. Device shares support both;
an open report form defers navigation. Closing it resumes play and keeps the draft across viewpoint changes in the same browser tab. Capturing briefly pauses bots and autoswitch; writing comments does not. The movable Report userscript captures the
screenshot without its controls, comment, Situation and revision/controller evidence.
Closing its form preserves the draft. Stop sharing revokes just that link and removes
its View from the group; other Views continue. Stop only task-owned resources.

## Verify and hand off

Check actual controllers, shared hashes, source revisions and restore warnings.
Do not open a diagnostic browser on a human's active player link: a seat token owns
one socket, so that browser supersedes their phone. Use HTTP status checks or an
owned clone for diagnostics and reload tests.
Do not submit human moves merely to leave a session ready. Timed games may wait for
manual Ready; clocks are frozen for UI testing. Return the desk/device link, QR,
human heroes, policies and what was actually verified. Keep the owning desk running.

`node test/detached-bots-e2e.mjs` owns a test desk, uses regular and bot backends,
checks one computation across Views and human actions from desk/phone, and closes
its own services. Supply distinct desk/backend/bots/frontend/device ports. It
submits QA moves only in its owned games. Node controller tests and
`test/bot_decisions_test.py` cover stale results, session separation and classic-only
policy inference. Browser phone emulation does not establish physical-device acceptance.
