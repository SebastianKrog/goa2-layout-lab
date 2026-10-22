---
name: goa2-ui-situations
description: Fabricate and save reproducible GoA2 game moments and presentation states for comparing frontend UIs in goa2-layout-lab. Use for specific decision prompts, hero-specific displays, selected cards, or open menus; game-rule testing and comparison-image production are separate tasks.
---

# GoA2 UI situations

Produce a reusable saved situation that shows the requested UI condition, with the correct player viewpoint and per-layout presentation. The backend supplies real game state and prompts; the frontend supplies panels, selection, inspection, scrolling and camera state. Success means the intended UI can be reopened and compared, not that a game rule has been tested.

## State boundaries and current desk

Follow [the canonical terminology](../../../docs/terminology.md): Decision State = exact game checkpoint; Presentation = Viewpoint + Session State + supported User State; Situation = Decision State + Presentation; View = playable instance; Layout = configured view arrangement and synchronization. Save Situation captures the complete moment. Save Decision State is game-only; Presentation templates and Layouts are reusable independently. Use `uiMode` for desktop/mobile, distinct from 2D/3D renderer. Viewpoint follows the Situation unless an explicit `overrides.viewpoint` pins it. Runtime accepts only the new model; old fixtures are ported with the offline migration tool, not a restore checkbox. The empty desk defaults to one Live working-tree View. Start/Add/Edit preserve existing progress on cancellation or failed staging.

## Choose the stopping point

Translate the request into a short visual contract before building anything:

- Heroes and visible content: card IDs/names, spells, runes, hand size, counters.
- Exact moment: before choosing, after local selection but before submission, after the first of two commits, or after resolution. These are different fixtures.
- Engine condition when relevant: phase, actual pending request type, responder and meaningful offered options.
- Presentation: owner/opponent/spectator, panel, selected/inspected card or hero, scroll and camera, device, 2D/3D, source and shell.
- Availability: which layouts have the feature, show the content inline instead, or do not implement it.

Infer a useful default from the request and record it. Ask only when alternatives would produce materially different requested comparisons. For "Emmitt selecting two cards", normally prepare planning with his first card committed and the second still choosable; do not confuse this with the post-reveal retrieve-one prompt.

## Find the current implementation

Locate the sibling repositories or configured checkout overrides. Read the lab's README, src/config.mjs, src/backend.py and src/presentation.mjs as needed. Defaults are siblings named goa2-layout-lab, goa2-backend, goa2-frontend and goa2-mobile-2d-patch; do not bake a Windows drive path into factories.

Use [references/lab-workflow.md](references/lab-workflow.md) for creation, import, saving, reload and handoff details. Read only the matching sections of [references/recipes.md](references/recipes.md) for the requested situation. Source paths there are search starting points: confirm fields, IDs and request shapes in the checked-out backend.

For the five basic card examples, first inspect the shared library/situations/cards/ library and library/README.md. The repo script scripts/create-simple-situations.py is the executed factory for planning selection, action choice, one tier II upgrade, defense and discard. Reuse those situations or adapt that script instead of reconstructing their setup from memory. See lab-workflow.md for what was actually verified.

The lab's starter endpoint currently makes the fixed Arien/Hanu versus Brogan/Tigerclaw game. Passing a hero roster to that endpoint does not customize it. For Snorri, Gydion or Emmitt, use a real custom GameSetup, an appropriate existing save, or a replay.

## Fabricate the game moment

Use the shortest reliable route:

1. Reuse/import an existing checkpoint or replay stopped at a known decision if it already matches.
2. Otherwise create a seeded GameSetup on a real supported map with registered heroes. Arrange the required levels, card zones, runes, spells and positions in this new isolated state.
3. For a pending decision, enqueue the relevant real engine steps or drive the normal card/session flow. Stop as soon as the requested prompt is emitted, before answering it.

Use existing backend fixtures as construction references, not as rule-test assignments. EffectScenarioBuilder makes generic heroes and synthetic boards; its hero named hero_gydion is not automatically a fully initialized registry Gydion. For frontend fixtures, normally keep a full-map GameSetup and adapt only the useful step sequence/context from a test.

Use registered cards and enum values. Maintain live card zones, actor/turn and context consistently; keep the master card catalogue as the model expects. Directly setting setup data such as level or rune_slots is appropriate for a display fixture. Do not manufacture a frontend STATE_UPDATE, overwrite window.**GOA2_LAB_STATE**, invent an input_request, or change production engine/card implementations to make a prompt appear.

Load effects through goa2.bootstrap.register_all_effects() before constructing/resolving custom hero situations.

Keep the waiting step and execution context in the checkpoint. A prompt object on its own is not a resumable game. Use GameSession.advance(InputResponse(...)) for answering prior prompts, with the current request's ID. Planning uses commit_card/pass_turn/finish_planning instead of advance(). Re-read IDs after restore; never reuse another clone's opaque request ID.

## Add the viewpoints and UI state

Load the same checkpoint into independent lab clones. Use Synchronize None while arranging different presentations; API requests may be used when deliberately advancing every clone together. API + clicks is optional convenience, not a fixture-generation dependency: it skips unmatched controls.

Use an owning player seat for private hands, deck contents and decision choices. During defense or forced discard, the responder can differ from the active attacker. Use the responder's seat for the chooser, and separate opponent/spectator views when useful. Do not enable reveal-all to disguise a wrong viewpoint.

Save those slots as provenance.slots, with seats that exist in the checkpoint; a provenance.seat hint alone is not a saved comparison setup. This matters for custom rosters that omit the default hero_arien. The loader repairs absent preset seats while preserving valid independent seats and spectators.

Configure one, two or three slots deliberately. The userscript target uses the legacy desktop shell with a phone profile and 2D; the migrated comparator/live source may use the native mobile shell. Two desktop 2D or 3D slots are also valid.

Open supported panels using the lab's pane/hero adapters or the actual UI. Local planning-card selection is presentation state, not a backend commit. Wait for the panel and real card control to mount before selecting; a navigation click alone is not proof that the panel has rendered. Save the Situation after opening the correct hand and selecting the card, and verify `presentation.sessionState.selectedCard`. Save a Presentation template too when useful for reuse. The current adapters handle Windows CRLF checkouts and asynchronous mobile panels; inspect adapter warnings before classifying absent markers as a missing frontend feature. Capture per-view camera, scroll, inspection and panel state through Save... > Presentation.

A missing Hand menu does not necessarily mean a missing hand: a desktop layout may show it inline. Record supported, inline-equivalent, unsupported or not-verified for each requested feature/source/shell. Preserve the same game checkpoint even when a layout cannot show the requested panel. Do not add temporary frontend markup or claim a menu opened when the adapter only scrolled to inline content.

Cheats controls stay hidden by default. Setup data can be fabricated without displaying that panel.

## Save and check reproducibility

Import the checkpoint through the lab, which validates and normalizes it. In standalone factories, restore/checkpoint once to normalize a waiting step, then restore that normalized checkpoint again and confirm the prompt and canonical hash are stable. Initial restoration can initialize transient context defaults; compare clones and presentation-only changes against the normalized state. Save the situation from the intended game window after setting its Presentation, with a useful name such as "Snorri - second rune choice - owner". A saved Layout contains view configuration; it does not contain a Decision State.

Reopen the saved Situation and verify its composed Presentation; use explicit View overrides for intentionally different player viewpoints. Check only the observable fixture contract:

- Correct phase/prompt, responder, hero and representative options/content.
- Same canonical game hash across slots intended to share the checkpoint; local menu/selection changes do not advance it.
- Pending choice or display data survives checkpoint restoration.
- Supported panels and local selections reopen; unavailable or non-persisted features are stated explicitly.

Do not consume the final choice just to demonstrate it works. For a post-choice UI, save a second named checkpoint rather than overwriting the pre-choice one. Avoid broad game-rule or platform test suites for this work. On this installation, validate through the Windows desktop app or Windows Chromium with the configured WSL backend services; do not run native Linux/WSLg acceptance suites unless requested.

Prefer an isolated lab session with distinct ports when setup/reload would replace the user's current comparison. If the user wants the new situation in their desk, preserve unsaved game moments and viewpoints before replacing them. Never call a standalone script's startDesk default auto-load against an existing session.

## Store and group situations

Use **situation** consistently. The lab exposes catalog.situations and situationId in load requests. Reuse the shared repo library in library/situations/<group>/ before fabricating another copy. New user- or agent-generated checkpoints go to ignored .layout-lab/situations/; factory scratch files go to .layout-lab/situation-recipes/.

Choose a focused folder such as cards/defense, cards/upgrades, heroes/gydion, heroes/snorri, heroes/emmitt or menus. Grouping is a real directory tree, not a naming prefix. Move a draft with POST /api/organize {id,group,shared:false}. After reopening and confirming the visual contract, add reusable fixtures to the shared library with {id,group,shared:true}. Promotion returns a new ID and keeps the local draft. Review that repo-visible JSON; commit only when authorized. Never put the curated library inside ignored runtime data.

## Deliver the situation, not images

Return the saved situation ID/name, factory or import file, exact visual condition, slots/seats and availability notes. Preserve enough setup detail to regenerate it. Use the small handoff record in lab-workflow.md when another task will generate images. State what was actually reopened and verified.

Stop here when only situation preparation was requested. Use the available goa2-compare-views skill for commit selection, screenshot framing, combined images, overlays/diffs, static report exports or a live human viewer. Pass it the saved situation and verification notes.
