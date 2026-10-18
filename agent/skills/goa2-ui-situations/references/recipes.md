# UI situation recipes

Read the relevant recipe, then use lab-workflow.md to export/import and save the result. These are recipes for reaching a visual condition, not requests to add gameplay tests. Use real initialized heroes on a supported map. Backend paths are relative to goa2-backend and should be rechecked on the current revision.

The five basic recipes below were exercised using the repo's scripts/create-simple-situations.py and reopened in all three phone/2D sources. The Gydion, Snorri and Emmitt engine setups were also checked through Windows checkpoint round trips; their rendered UI and the menu variants still require verification when creating them. See lab-workflow.md for the verification scope.

## 1. Selecting a card in planning

**Moment:** the owner's hand is visible and a specific card is locally selected, before committing it.

- Start a seeded GameSetup, or use the lab's fixed starter when its four heroes are suitable. Leave phase PLANNING and keep the card in the owner's hand.
- Load the owning hero's seat in every layout intended to show that private hand. Open Hand where it is a panel; scroll to the inline hand on the legacy desktop layout.
- Wait until Hand is active and the actual card control is visible; native mobile mounts its panel asynchronously. Select a real hand card using the actual UI. Do not press Commit or send COMMIT_CARD. The canonical game hash should remain unchanged.
- Save situation after selection. The lab captures selectedCard from instrumented card controls where supported. Reopen and confirm the same card is selected. If a layout's selected state is not instrumented/restorable, record that it must be reapplied; do not claim full persistence.

If the request means an engine-issued card choice instead, identify its context and use the defense/discard/upgrade recipe. PLANNING selection and a SELECT_CARD prompt are different UI states.

## 2. Choosing the action for a played card

**Moment:** a real card is unresolved and the engine is waiting at CHOOSE_ACTION.

- Use the full-map pattern in lab-workflow.md: take an actual card from its hero's hand, set it UNRESOLVED and faceup as current_turn_card, set phase RESOLUTION and current_actor_id, and enqueue ResolveCardStep.
- Preserve the current turn and card zones coherently. For an isolated fresh chooser, there need not be other unresolved heroes. Do not copy a card into a second live zone.
- Call GameSession.advance() once and stop at CHOOSE_ACTION, before choosing ATTACK/MOVEMENT/SKILL. Choose a card with several legal actions if the point is comparing multiple action buttons.
- Save the waiting stack/context, then load the acting hero's seat. A pending backend choice should still exist after reload.

Source anchors: tests/engine/effects/runner.py::run_card; tests/engine/effects/cases/test_mortimer_effects.py; ResolveCardStep and its action-selection step. The full-map example uses Arien's noble_blade, but inspect the actual offered options rather than hard-coding their count.

## 3. Upgrading one tier II card

**Default moment:** one upgrade is pending and the UI offers the real tier II pairs. This is before selecting a replacement, not a hand that already contains the upgrade.

- Create a registered hero with normal tier I cards in hand and the paired tier II candidates still in its catalogue. Set up exactly one earned upgrade for that hero: a suitable level such as 2, pending_upgrades={hero_id:1}, phase LEVEL_UP and ResolveUpgradesStep on a fresh isolated stack.
- Let the engine produce UPGRADE_PHASE. It is a simultaneous request: the Python InputRequest stores the options and remaining count under request.context["players"][hero_id]. Its to_dict() representation and browser STATE_UPDATE.input_request expose players[hero_id] at the top level. Python request.players does not exist, and request.options is not the upgrade-pair collection. The Python player_id is "simultaneous"; focus the hero with the pending upgrade via the lab seat.
- Inspect that remaining is 1 and that the offered pairs have tier II (CardTier.II in Python, "II" in browser JSON). Do not take a tier II card into the hand first; that can change which tier the engine offers next.
- Save before answering. To fabricate the post-upgrade hand instead, submit the offered {hero_id,card_id} selection using the current InputResponse, then save a second named situation.

Sources: tests/engine/test_upgrades.py::test_resolve_upgrades_options and test_upgrade_loop_to_completion; src/goa2/engine/steps/cards.py::ResolveUpgradesStep. Use registered cards rather than the tests' synthetic r1/r2a names.

## 4. Choosing a defense card

**Moment:** the defender has a meaningful defense choice against a pending attack. It is not the attacker's target-selection screen.

- Arrange two real opposing heroes on adjacent valid map hexes, with the attacker current and an appropriate attack card/context. Keep the defender's real candidate defense cards in hand; two visible choices are useful for layout comparison.
- Drive a normal attack effect, or use AttackSequenceStep with real actor/target context and the actual step fields. The executed simple factory uses Arien's faceup unresolved noble_blade, adjacent Brogan, context current_action_type=ActionType.ATTACK, action_type_stack=[], victim_id="hero_brogan", and AttackSequenceStep(damage=4, range_val=1, target_id_key="victim_id"). This skips the earlier target chooser and pauses at Brogan's real defense prompt. Use that factory or the existing defense-restoration fixture as the source pattern.
- Answer only the earlier attack/target prompts. Stop when the input is addressed to the defender and offers its cards. The current unified request is commonly SELECT_CARD_OR_PASS; DEFENSE_CARD is a legacy type, so identify the actual request rather than requiring that older name.
- Load the defender's seat for the chooser. The attacker's or spectator's view may correctly conceal the hand or show that another player is choosing.
- Save while defense is still pending. Do not answer PASS just to advance, because it consumes this visual moment.

Sources: tests/engine/effects/cases/test_defense_restoration.py and src/goa2/engine/steps/combat.py::AttackSequenceStep. A short source pattern is Xargatha's cleave to its target/defense prompt; adapt the setup to real GameSetup heroes, not generic empty-deck test heroes. Do not add assertions about damage totals, defeat or shield rules.

## 5. Discarding a card

**Moment:** the card owner is being asked which card to discard, with the intended subset visible.

- Give the victim a real hand with multiple eligible cards. Use a real discard-producing effect when that context matters; otherwise a fresh isolated ForceDiscardStep(victim_id=hero_id) is appropriate for the chooser's appearance.
- Set phase RESOLUTION and the acting context coherently; the victim/responder may be a different hero from current_actor_id.
- Use card_is_basic only if a filtered hand is part of the requested visual. No eligible cards can make the step complete without a prompt.
- Stop at the emitted SELECT_CARD for the victim before choosing a card. Save its pending step and focus the victim's seat.
- If the requested image is the discard pile after selection, answer once through GameSession and save a separate post-discard fixture.

Sources: tests/engine/test_filtered_force_discard.py; src/goa2/engine/steps/cards.py::ForceDiscardStep. Prefer real card IDs and images to that test's synthetic "basic"/"non_basic" cards.

## 6. Gydion's cast spells

**Moment:** the UI has several faceup cast spells to display/inspect, distinct from the private spellbook.

- Start with GameSetup using the registered Gydion, not a generic Hero named Gydion. Keep its initialized spells and spell metadata, including ranks and image IDs.
- Explicitly arrange the complete spell inventory. Registered Gydion currently initializes spells in CardState.OUTSIDE_SPELLBOOK. To show exactly two cast entries, put all other spells in CardState.SPELLBOOK with is_facedown=True, then put the two desired real spell objects outside the book with is_facedown=False. Merely changing two already-outside spells will leave the other outside spells visible too. Direct zone arrangement is enough for this display-only situation; play through a spell only when its casting prompt is the requested UI.
- Do not put SpellCard objects into the normal hand/deck or write a standalone cast_spells JSON field. cast_spells and spellbook are derived from the hero's specialized spell inventory.
- Include several distinct real spells to exercise wrapping/scrolling, with their names/IDs recorded. magic_missile is a concrete registry ID used by the visibility fixture; choose additional IDs from the current initialized hero.
- Show the Gydion HUD/inspection or spell display implemented by each layout. Mark older sources without the display as unsupported.
- Owner views may expose the full spellbook; opponents/spectators get a count for the private book but can see faceup cast_spells. Do not use reveal-all for the comparison.

Sources: tests/domain/test_spellbook_views.py, tests/domain/test_spell_card.py, tests/engine/effects/gydion_common.py and tests/engine/effects/cases/test_gydion_access.py. The domain visibility fixture demonstrates zone fields; its artificial board/inventory is not a full frontend scene to copy wholesale.

## 7. Snorri rune selection

**Moment:** Snorri is partway through arranging runes, with real remaining choices.

- Create registered Snorri and load goa2.scripts.snorri_effects. Resolve the real inscribe_the_runes card through CHOOSE_ACTION -> SKILL -> SELECT_OPTION.
- Stop at the first rune choice, or answer an offered rune such as axe and stop at the next SELECT_OPTION. Record which turn slot is being filled and which options remain.
- In-progress choices live in PlaceRunesStep.placed, not in hero.rune_slots. Save the actual waiting stack so partial progress survives restore. Do not pretend that setting the final rune_slots dictionary creates a selection prompt.
- The last remaining rune is auto-placed. Do not answer three sequential choices and then expect a fourth choice screen. Batch selection is also supported; do not submit the whole batch when the goal is viewing the chooser.
- Focus Snorri's owner seat and keep the pending prompt unanswered after saving.

Sources: tests/engine/effects/cases/test_snorri_effects.py::test_inscribe_places_four_runes_with_choice, test_inscribe_invalid_batch_preserves_previous_choices and test_place_runes_step_survives_serialization_mid_prompt; src/goa2/engine/steps/markers.py::PlaceRunesStep.

## 8. Snorri's runes displayed during a turn

**Moment:** a completed rune arrangement is displayed, with the active turn/rune distinguishable. This is separate from the selection dialog.

- Start registered Snorri on the real map. Seed a completed arrangement, or finish Inscribe in the isolated factory. A concrete arrangement is {1:RuneType.AXE,2:RuneType.BIRD,3:RuneType.ANVIL,4:RuneType.HORN}.
- Set the intended turn, for example turn 2, and prepare an ordinary Snorri card's CHOOSE_ACTION in RESOLUTION if the request is "during his turn". Use the real card/actor setup from recipe 2; runic_dagger was checked at turn 2 with the bird rune. Do not leave the PlaceRunesStep chooser pending.
- The base active rune derives from the card owner's turn slot, not necessarily the current actor. The helper also unions ultimate runes in context["snorri_ult_rune_action"] and context["snorri_ult_rune_defense"] when present. Inspect the backend's active_runes(state,card,context) usage and current view fields rather than adding an active_rune flag to frontend state.
- Open or scroll to Snorri's hero/turn display. Save the turn number, arrangement, current card and viewpoint. Include other turn slots so the active marker has visual contrast.
- If testing different active turns, make separate named checkpoints; scrolling or opening a menu must not change the game's turn.

Sources: src/goa2/scripts/snorri_effects.py::active_runes; rune_slots in src/goa2/domain/views.py; the Snorri effect fixtures. Verify availability separately in frozen Base, migrated mobile, userscript and 3D.

## 9. Emmitt's ultimate and two-card planning

Registry spelling is Emmitt; the hero ID is hero_emmitt. Use that registered hero when interpreting shortened or misspelled references to Emmitt.

- Start GameSetup with Emmitt, an opponent such as Wasp, and seed/normal hands. Register goa2.scripts.emmitt_effects and set Emmitt's level to 8 as in tests/engine/test_emmitt_ultimate.py. Keep at least two playable hand cards.
- **Before either commit:** leave PLANNING, focus Emmitt, open Hand. Useful for the initial two-card affordance.
- **Choosing the second card (usual default):** call session.commit_card(HeroID(emmitt.id), card) with the actual Card object from Emmitt's hand, not a card-ID string. Leave PLANNING and the second commit pending. Other heroes can remain uncommitted; even after the opponent commits, Emmitt can still have a second-card decision. Select the desired second card locally in the UI without committing it, then save.
- Do not manually set pending_cards, pending_second_cards or planning_done. The actual commit/finish-planning methods establish those fields. Do not call finish_planning when preparing the second-card choice: that closes the optional second commit.
- **After reveal, retrieving one:** commit both Emmitt cards and close other heroes' planning. Stop at the mandatory SELECT_CARD retrieve-one prompt addressed to Emmitt, before returning either revealed card. This is a different fixture, not the planning selector.
- For the retrieve prompt, retain current_turn_card/extra_turn_card and their faceup state through normal session methods. Owner and opponent views can both show the revealed pair; the planning hand remains private.

Sources: tests/engine/test_emmitt_ultimate.py::TestTwoCardCommit and TestPostRevealRetrieve. Concrete registered IDs in its example are reverse_time and unstable_timeline. Do not finish that test's whole flow when the desired visual is an earlier prompt.

## 10. Hand, Deck and Heroes panels

These are presentation variants of a saved game, not engine phases.

1. Start from the same checkpoint for all compared layouts. Choose a seat that can see the requested contents.
2. Request the pane through the lab adapter or actual UI. Record both whether the menu exists and whether its content is available inline.
3. Set scroll and any hero/card inspection explicitly. Save situation after the panels are arranged; saving only a preset does not store this presentation.
4. Reopen with Restore saved viewpoints. A backend hash change while merely opening Hand/Deck/Heroes is unexpected and should be investigated as fixture contamination.

| Requested feature | Presentation intent | Legitimate layout differences |
| --- | --- | --- |
| Hand menu | Native mobile/userscript pane hand | Legacy desktop can have an always-visible inline hand with no Hand menu. |
| Deck menu | Pane deck for the owning hero | A View Deck modal may be the equivalent. Opponents/spectators may not have private deck contents. |
| Heroes menu | Pane heroes or the relevant hero inspection | Legacy desktop/3D may show hero boards inline or offer a different inspection UI. |

Use supported, inline-equivalent, unsupported or not-verified in the handoff. Name the missing control/content precisely. Do not replace unavailable old UI with temporary markup, switch the frozen source, advance the game or change seats silently just to make every column look successful.
