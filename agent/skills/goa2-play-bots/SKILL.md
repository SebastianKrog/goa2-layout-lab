---
name: goa2-play-bots
description: Set up a playable GoA2 layout-lab device session with one human hero and Random or Simple bots, including a phone link, QR code and lab reporting. Use for playing or mobile testing against bots, rather than bot training or search benchmarks.
---

# Play GoA2 against bots

Leave a playable independent device clone ready for the human, with the requested hero and bot controllers. Keep orchestration and reporting in goa2-layout-lab.

## Prepare the lab

Locate the lab checkout and read its [README](../../../README.md) and [device workflow](../../../docs/device-testing.md). Resolve these links from this versioned skill directory. Check current configuration and running desk before starting another instance; retain existing device sessions and comparison views.

The backend must support the existing RandomAgent and HeuristicAgent lifecycle. The maintained branch is `bots-upstream` in the backend fork; `../goa2-backend-bots` is a checkout convention, not a separate required GitHub repository. Select that checkout through ignored `.env.layout-lab` using `GOA2_LAB_BACKEND`. Check actual capability through device options: `botKinds` must include the requested `random` or `heuristic`. A different directory or branch is fine if it provides that capability.

Reuse an already configured running desk. If a configuration change requires restarting a desk with human games, preserve the user's session or use a separate owned instance with distinct ports as described in the README. Do not rewrite backend code to enable this workflow. Serving uses `uv run --locked --no-default-groups`; neural-network, training and search dependencies are unnecessary.

## Choose the game and controllers

Use a saved situation matching the requested heroes and moment. Inspect its actual seats; do not infer hero IDs from display names. If a new moment must be fabricated, use the lab's [situation skill](../goa2-ui-situations/SKILL.md), then return here.

Open **Open on device** from Compare or the situation card. Choose **Live working tree** for current frontend edits, **Mobile 2D** for the phone layout, and the human's **Your hero** seat. Native mobile is available on supported Live/Comparator sources; Base/Userscript target require their supported desktop layouts.

Under **Other heroes**, use **Set all others** or individual controls:

- **Random** maps to `random` and chooses legal actions.
- **Simple** maps to `heuristic` and uses the fork's basic rule-based policy.
- **Manual** omits that hero from automation and may leave the game waiting for another human.

Automate the other heroes on both teams when the user wants to play alone. The selected human seat must never appear in the bot mapping. Spectator cannot be combined with bots. Bots follow normal engine decisions, including upgrades and runes; they stop where a human response is required.

Click **Start device website**. It clones the situation without advancing the saved source or replacing comparison windows. For API automation, use the desk endpoints and request schema in the device documentation; read options first, omit Manual heroes, and use the returned capability URL and QR. Do not bypass the desk by extracting its private backend credential.

## Verify and hand off

Check the selected seat, frontend/layout and returned roster/controller mapping. Inspect the loaded game for restore or connection errors. A fresh Planning situation can show the bots committing while the human remains uncommitted; other saved phases may correctly wait for a human immediately. Do not submit the human's moves merely to leave a session ready.

Return the phone URL, a usable QR image or open QR dialog, human hero, bot choices, and situation/source. Keep the owning process running. Use the generated LAN address rather than a remembered PC IP; the phone must reach the gateway on the same LAN. The device documentation covers port overrides and the Windows firewall helper. Localhost connectivity alone does not prove phone access.

Timed situations may need the human to press **Ready**. Lab clocks are frozen, so this is interactive UI testing rather than production timing verification. State what was actually verified; browser phone emulation does not establish physical-device acceptance or full-match coverage.

The lab injects the movable **Report** userscript. Holding the button enables dragging, with vibration where supported. Reports save the comment, screenshot without the button/dialog, and resumable situation. Bot configuration is recorded as provenance; opening a saved report requires selecting bots again. Keep capability links and private checkpoints out of tracked documentation.

**Stop sharing** revokes that link and cancels that clone's bots while preserving its recovery save. Closing the dialog leaves it running. Stop only sessions owned by the requested task; shutting down the desk invalidates all of its device links.

For feature acceptance work, `npm run test:device-bots -- --env-file=.env.layout-lab` exercises both policies through a phone-sized browser. It submits QA human moves, creates/stops test clones, and leaves a fresh Random game plus local evidence. Use it on an owned test desk when verification is requested, not as the ordinary launch path. See the device documentation for coverage and evidence locations.
