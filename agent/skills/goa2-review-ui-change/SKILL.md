---
name: goa2-review-ui-change
description: Create and start a focused GoA2 layout-lab Review Run to evaluate a UI change. Reuse tagged library Situations and existing Decision States wherever possible, create verified Situations only for coverage gaps, and prepare the Views and human handoff. Use for review queue preparation or execution across several UI states; use goa2-compare-views for a single-state comparison or evidence export.
---

# Review a UI change

Turn the requested change into a reproducible Review Run with a small, purposeful
queue. Preparing a Run and evaluating its entries are separate outcomes: leave
it ready for the user unless they also asked you to perform the review.

## Define coverage

Read the UI change, relevant diff and acceptance notes. Identify observable
behaviors to inspect, affected components, and meaningful variants: pending
choices, open panels, selected cards, long content, owner/opponent/spectator,
viewport, UI mode and renderer. Include adjacent regression coverage when the
change affects shared controls. Avoid multiplying cases across unrelated heroes
or devices that exercise the same behavior.

Use [canonical terminology](../../../docs/terminology.md). A Situation names a
game-only Decision State; Review entries add optional Viewpoint and sparse
Presentation instructions. Layouts supply configured Views.
A Review defines an ordered queue; its Run freezes inputs and collects evidence.

## Reuse the library first

Inspect `GET /api/catalog` and the shared [library](../../../library/README.md).
Search names, folders and [tags](../../../docs/tags.md), including inherited
Decision State tags. Multiple tag filters mean AND; try separate searches when a
strict combination hides useful candidates. Tags help discovery but do not prove
that a saved checkpoint or Presentation covers the desired condition.

Inspect promising Situations and load them when necessary. Choose the smallest
set covering the criteria; one Situation can cover several checks. Record each
chosen ID and what to inspect. Prefer shared entries; use relevant existing local
drafts too, identifying them in the handoff.

For each gap:

- Reuse an existing Situation unchanged when it already shows the condition.
- If only Viewpoint, open menu or selection differs, reuse the
  Situation and attach optional Presentation instructions to its Review entry.
  The same Situation may occur several times with different instructions.
- Create a new Decision State only when the required game moment is missing.
  Follow [goa2-ui-situations](../goa2-ui-situations/SKILL.md) for fabrication,
  save/restore verification and library promotion. Preserve a real pending
  decision; do not fake DOM/game state or answer the final choice for appearance.

Give new Situations descriptive names and useful tags. Verify their actual UI
and restoration before adding them. Keep drafts local until useful shared
coverage is established; do not commit or push library additions unless asked.
Explain any uncovered condition rather than substituting a loosely related case.

## Prepare Views

Follow [goa2-compare-views](../goa2-compare-views/SKILL.md) and its setup reference
for source selection, launch and inspection. A single candidate View is valid;
use baseline/candidate Views when the question needs direct comparison. Resolve
committed sources to exact SHAs and identify any mutable working tree explicitly.
Use the native viewer for animation and interaction checks.

Preserve an existing human workspace and active Review Run. Use an owned instance
on distinct ports when replacement would disrupt it. Starting a Run replaces
current games, so prepare source/View settings before starting it.

Choose the Layout first. Put inspection Viewpoint, menus and selections on Review
entries, with optional `presentationsByInterface` or `viewPresentations` for intentional
differences. Check supported combinations and restoration warnings. An inspection
may need a different viewing player from the current actor.

## Start and verify the Run

Read [Review queues](../../../docs/reviews.md) for current API payloads, frozen
snapshots, reruns and report collection. Name the Review after the UI change.

In the Situations list, clear stale selections before choosing the final cases.
Selections outside the filter remain selected. The UI orders the queue by
folder/name/ID; for deliberate sequencing, send ordered `entries` to
`POST /api/review-runs/start` with `{entries, name, layoutId?}`. Each entry is
`{situationId, viewpoint?, presentation?, presentationsByInterface?, viewPresentations?}`.
Optional `slots` configures an ad hoc Layout. Explicit Layout/slots wins over current
Views. On an empty desk supply `layoutId` or `slots` explicitly. Repeated Situation IDs get separate entry identities. The limit is 200 inspections.

Verify the active Run ID, total, first Situation, intended/effective Presentation
and loaded View sources through status and the actual viewer. All desk and shared
device Views follow each step in a shared game group. Review controllers become
manual and auto switch is disabled. The chosen synchronization mode is retained
(API requests by default), with independent menus/cameras. Do not mark cases evaluated merely because they
loaded or were visited.

## Evaluate or hand off

For a human review, leave the first entry ready and the owning services running.
Provide the Run name/ID, viewer URL or native window, exact sources, and a compact
coverage list of Situation IDs with inspection goals and reused/new status.
Include any gaps, intentional overrides, device link/QR when requested, and how
to stop the owned instance.

Explain Previous/Next and the existing report tools. Reports collect under
`.layout-lab/reports/reviews/<run-id>/`; **Review reports** opens the collection.
Previous restores the saved starting moment, discarding gameplay since loading
it. A report draft must be sent or intentionally discarded before navigation;
closing its popup retains the draft. Device reporting controls include arrows
and are excluded from captures.

When the agent performs the review, pass `performedBy: "agent"` on start/rerun
(`--verification` desks default to this). These Runs are labeled Agentic review
and hidden from the Reviews list by default. A queue prepared for human evaluation
uses `performedBy: "human"`; creating the queue does not make it agentic.

If asked to execute the review, inspect each entry against its criteria and use
existing screenshot, element or device reporting for actual findings. Collect
focused HTML/CSS only when useful to diagnose the issue. Distinguish a defect,
an intended change and an unresolved setup/restoration gap. Report what was
observed, what remains untested, and the evidence location; a visited count is
not a pass count. Leave the Run active for continued human work unless finished
or asked to end it. Use frozen inputs for faithful reruns; refreshing from the
current library is an explicit choice, as described in the Review documentation.

## Small Presentation changes

Presentations are sparse session alterations, not UI snapshots. Reusable presets target
roles (`{role:"gold"}`, `{role:"upgrade",tier:2,branch:"A",color:"RED"}`), panels or
`publicSpells:true`. Put exact card IDs only on Review entries or ad hoc comparison
requests. Keep `viewpoint` separate. Do not capture preferences, game URLs or renderer
identity into a preset. Application warnings mean the Situation/View remains usable;
inspect the actual result and include those warnings in the handoff.
