# Review a queue of situations

Agents preparing a Run for a UI change should use
[goa2-review-ui-change](../agent/skills/goa2-review-ui-change/SKILL.md) for
library selection, coverage gaps and handoff.

In **Situations**, tick the entries you want to inspect, optionally filter by
folder or Library/Local drafts, search by name/hero/folder, and press **Start review**.
Selecting entries reveals an optional name for the Review. The checkbox beside **Select filtered** selects every
currently visible situation; clicking it again clears only those visible
entries. Its mixed state means some visible entries are selected. Selections
outside the filter are retained and counted. **Clear selection** clears all.
The setup dialog follows list order (folder, name, ID). Choose an optional Presentation
for each inspection, optionally expand **Specific card** for an exact ID, remove unwanted rows or **Add another inspection** of the same
Situation. Starting uses the selected Layout, with up to 200 entries.

The review bar above the views shows the current situation, position, Previous,
Next, **Review reports** and **End review**. At either boundary the unavailable
arrow is disabled. Every step loads a fresh copy of that entry into every desk
view and every currently shared device view. Previous restores the saved starting
moment again; it does not retain gameplay performed on an earlier visit.

## Archive and delete

Use the archive filter, **Archive all**, or each Review's **Archive / Restore**
action to organize saved history. **Delete** and **Delete archive** ask for
confirmation and remove the selected Reviews, all their Runs and collected
evidence. Active Reviews are protected. See [Reports and activity groups](reports.md)
for the separate report archive and deletion rules.

## Agentic reviews

Runs performed by an agent carry `performedBy: "agent"`. They are hidden from the
Reviews list and its count by default. **Show agentic reviews** includes them under
the current archive filter; each such Run and its saved evidence page is clearly
marked **Agentic review**. Existing unmarked Runs retain human-review behavior.
A mixed Review shows only its human Runs until this option is selected.

Verification desks (`--verification`) mark new Runs automatically. Agent workflows
outside those desks must pass `performedBy: "agent"` when starting or rerunning a
Run. Preparing a queue for the human to evaluate remains `performedBy: "human"`.
The person performing a rerun determines its marker, independently of the parent.
The API retains both kinds so evidence and explicit lookup remain available.

## Past reviews and reruns

The **Reviews** tab groups Runs under their Review. The latest Run is visible;
**Earlier runs** expands its history. Cards show date, status, situation count,
visited count and report count. **Run details and options** contains position,
report types, affected-situation/view counts and the rerun input choice. An
**Interrupted** status means the desk stopped while the saved review was active;
review sessions do not resume automatically.

**Run again** creates a new Run of the same Review revision. **Original saved snapshots** is the default input, even if the library changed. **Current library Situations**, under **Run details and options**, explicitly
rereads the queue IDs from the library. Its non-default choice stays visible in
the details summary.
The previous Review's saved Layout is used unless explicit `slots` are supplied.
Its synchronization policy is frozen with the Run and restored on rerun. Earlier reports and
snapshots stay untouched, and the new collection records its parent Run ID.

**Edit and run** opens a queue editor and creates a new immutable Review revision plus a Run. Keep or remove original entries, search the
current library for additions, adjust each inspection's Presentation, and give the new run a name. Retained entries use
their original snapshots; additions are snapshotted from the library when started.
Retained entries keep their original order, followed by additions in library order.
Cancel creates nothing. Starting requires at least one entry. End an active review
before starting another; its card offers **Continue review** to return to Compare.
**Open reports** opens the saved evidence collection without starting a run.

## What a step restores

A **Review** contains ordered **Review entries**: Situation references with optional
session changes. A **Review Run** freezes the exact Decision States,
entry instructions, Layout and source evidence. The library is never rewritten.
Each step restores fresh Views from that Layout and that entry, preventing prior
menus, selections or viewpoints from carrying forward. Common Presentation values
can be refined by interface and by View. Unsupported intent produces warnings and
actual-state evidence; desktop may satisfy Hand intent with inline cards.

Review views use manual controllers and disable auto switch, so bots or automatic
viewpoint changes cannot move away from the saved moment during inspection.
The selected synchronization mode is retained (API requests by default); game
actions propagate within the Run-step group while menus remain independent.
You can still interact with the games and use reporting.
End the review before editing sources/view setups, adding/removing desk views,
resetting or loading unrelated situations. Ending leaves the current games open.
It does not restart prior bots or auto switch automatically.

Starting a Run stages views and device clones, collects source evidence, and
persists its definition and Run before replacing current views. Failed starts
close staged clones and remove their new Run files and unused definitions. A failed
load leaves the old views and current queue index intact. Repeated/stale navigation
requests are rejected using the review ID and expected index.

## Physical devices

**Open on device** during a review uses the current frozen snapshot for its roster
and Presentation. Missing snapshots fail explicitly rather than rereading the
mutable Situation library. Existing shared devices also join when a review starts. Their links/QR codes remain stable across steps.
The injected movable Report bubble adds **Previous** and **Next** arrows with a
position counter. Hold the Report part to move the entire bubble; vibration remains
best-effort. Either the desk arrows or a device arrow advances the whole review.
Devices reload their new game/presentation/viewpoint automatically, normally within
one polling interval after preparation. All bubble controls remain excluded from
report screenshots. Outside a review, the bubble keeps its normal Report button.

Finish or discard pending element/device reports before changing steps or ending
the review. Closing a report dialog keeps the draft and blocks navigation. If a
device is unavailable, stop its shared view to release that device's draft guard.
A device capture requested while a step is loading is rejected with a retry message.

## Evidence collection

Capture, element reports, device reports and HTML/CSS exports are saved under:

```text
.layout-lab/reports/reviews/<run-id>/
  index.html             # offline collection, grouped by queue entry
  review.json            # Review Run, revision/entry IDs, snapshot references and report index
  situations/000.json    # exact checkpoint snapshots, saved by the Python adapter
  reports/
    <capture-id>/
    element-<uuid>/
    device/<capture-id>/
    source-<uuid>/
```

Each report records its Review ID/revision, Run ID, stable entry ID, queue index and starting Situation ID in
addition to its normal screenshot/checkpoint/presentation/viewpoint/revision data.
Element and device reports retain capture-time attribution while comments are
written. All four report types include `presentationResolution`: intended and
sampled effective Presentation, explicit View overrides and restoration warnings.
This records UI changes made after loading a Situation. Reports remain readable after ending or stopping the desk, by opening the
local index.html. Copy the whole collection folder for offline viewing. Checkpoint
files may contain hidden/private game information, as with other lab reports.
Active review sessions do not resume automatically after a desk restart; the saved
collection and queue remain available in **Reviews** and as files.

## API and checks

- `GET /api/review-runs/current` reads progress and the collection URL; `GET /api/status` includes the same progress in `reviewRun`.
- `POST /api/review-runs/start {entries,name?,layoutId?,slots?}` snapshots and starts a queue.
  Each entry has `{situationId,viewpoint?,presentation?,presentationsByInterface?,viewPresentations?}`.
  Repeated Situation IDs are allowed and get distinct entry IDs. `{ids}` is shorthand
  for default inspections. Explicit Layout/slots wins over running View settings.
- `GET /api/reviews` lists Review definitions with their Runs; `GET /api/review-runs` lists Run statistics. `GET /api/review-runs/<id>`
  returns its queue metadata without checkpoints.
- `POST /api/review-runs/rerun {id,name?,entries?,slots?,inputs?:"frozen"|"library"}` creates a fresh run. Omit
  `entries` to retain the entire queue, or supply ordered `{fromIndex}` items for
  saved entries and `{situationId}` items for library additions. Either may include
  Presentation instructions. Omitted instructions retain the saved entry values.
- `POST /api/review-runs/step {id,index,direction:-1|1}` moves all views.
- `POST /api/review-runs/end {}` finishes without removing evidence or current games.
- Device-only authenticated routes expose review status/navigation within that
  device's existing capability cookie. The device cannot choose arbitrary queues,
  source settings or filesystem paths.

`node --test test/reviews.test.mjs` checks restoration, evidence attribution,
queue boundaries, stale/draft guards and failed-load recovery. The regular Node
suite retains real Chromium reporting/drag/capture/security checks. Python's
`test.backend_test` covers device report paths, metadata and invalid review IDs.
`node test/reviews-e2e.mjs` runs the real desk, two mobile views and a device browser:
filtered selection, saved viewpoints/presentations, nested reports, draft retention,
and navigation from both the desk and the phone. Set distinct `GOA2_LAB_*_PORT`
values and `GOA2_LAB_DISPLAY=browser`; it owns and closes its services. QA evidence
stays in `.layout-lab/reviews/review-workflow/`.

`node test/review-history-e2e.mjs` checks the Reviews tab, statistics, rerunning,
canceling an edit, editing the queue and restoring both views. It writes evidence
to `.layout-lab/reviews/review-history/`. The unit and Python suites also check
restart discovery and exact snapshot copying without rereading the library.

Review definitions are stored as immutable revisions under
`.layout-lab/reports/reviews/_definitions/<review-id>/<revision>.json`. Run folders
retain their own frozen snapshots. See [storage and migration](state-model.md) for record versions and cutover history.
