# Review a queue of situations

In **Situations**, tick the entries you want to inspect, optionally filter by
folder or Library/Local drafts, and press **Start review**. An optional name
labels the collection. The checkbox beside **Select filtered** selects every
currently visible situation; clicking it again clears only those visible
entries. Its mixed state means some visible entries are selected. Selections
outside the filter are retained and counted. **Clear selection** clears all.
The queue follows the situation list order (folder, name, ID), with up to 200 entries.

The review bar above the views shows the current situation, position, Previous,
Next, **Review reports** and **End review**. At either boundary the unavailable
arrow is disabled. Every step loads a fresh copy of that entry into every desk
view and every currently shared device view. Previous restores the saved starting
moment again; it does not retain gameplay performed on an earlier visit.

## Past reviews and reruns

The **Reviews** tab lists saved collections, newest first. Each card shows the
creation date, status, situation count, distinct situations visited, last position,
report count, situations with reports, view count and report types. Older
collections without visit tracking show that statistic as unavailable. An
**Interrupted** status means the desk stopped while the saved review was active;
review sessions do not resume automatically.

**Run again** creates a fresh review using the original queue and exact saved
snapshots, even if those Situations were changed or removed from the library.
Current views define the frontend sources and layouts; when no views are running,
the previous review's saved view configurations are used. Earlier reports and
snapshots stay untouched, and the new collection records its parent review ID.

**Edit and run** opens a queue editor. Keep or remove original entries, search the
current library for additions, and give the new run a name. Retained entries use
their original snapshots; additions are snapshotted from the library when started.
Retained entries keep their original order, followed by additions in library order.
Cancel creates nothing. Starting requires at least one entry. End an active review
before starting another; its card offers **Continue review** to return to Compare.
**Open reports** opens the saved evidence collection without starting a run.

## What a step restores

A **Review** is a queue plus an evidence collection, separate from its Situations.
The review snapshots each selected Situation at start in the lab Python adapter
(so large engine integers never pass through JavaScript for replay), including any legacy
presentation/viewpoint metadata. It never rewrites library entries.

Current frontend sources/revisions, view count, device profiles, renderers and
layouts are retained. For a legacy bundled entry, match its saved slot by source,
layout and renderer, then by layout/renderer, then by index/first slot. Restore
that slot's viewpoint and compatible Presentation. If the selected hero is absent,
the existing roster fallback chooses an available viewpoint. Plain Situations
with no Presentation open on Board with default UI state; an absent saved
viewpoint uses the configured viewpoint when available. Incompatible or unavailable
presentation controls retain the existing restore warnings in the affected view.
Independent Presentation records are not automatically associated with Situations.

Review views use manual controllers and disable auto switch, so bots or automatic
viewpoint changes cannot move away from the saved moment during inspection. API
synchronization is off. You can still interact with each game and use reporting.
End the review before editing sources/view setups, adding/removing desk views,
resetting or loading unrelated situations. Ending leaves the current games open.
It does not restart prior bots or auto switch automatically.

Replacements are prepared before the old views are retired. A failed load leaves
the old views and current queue index intact. Repeated/stale navigation requests
are rejected using the review ID and expected index.

## Physical devices

**Open on device** during a review opens the current step. Existing shared devices
also join when a review starts. Their links/QR codes remain stable across steps.
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
.layout-lab/reports/reviews/<review-id>/
  index.html             # offline collection, grouped by queue entry
  review.json            # queue metadata, snapshot references and report index
  situations/000.json    # exact checkpoint snapshots, saved by the Python adapter
  reports/
    <capture-id>/
    element-<uuid>/
    device/<capture-id>/
    source-<uuid>/
```

Each report records its review ID, queue index and starting Situation ID in
addition to its normal screenshot/checkpoint/presentation/viewpoint/revision data.
Element and device reports retain capture-time attribution while comments are
written. Reports remain readable after ending or stopping the desk, by opening the
local index.html. Copy the whole collection folder for offline viewing. Checkpoint
files may contain hidden/private game information, as with other lab reports.
Active review sessions do not resume automatically after a desk restart; the saved
collection and queue remain available in **Reviews** and as files.

## API and checks

- `GET /api/review` or `/api/status.review` reads progress and the collection URL.
- `POST /api/review/start {ids,name?,slots?}` snapshots and starts a queue. Existing
  views define sources; `slots` applies when the desk has no running views.
- `GET /api/reviews` lists saved collection statistics; `GET /api/reviews/<id>`
  returns its queue metadata without checkpoints.
- `POST /api/review/rerun {id,name?,entries?,slots?}` creates a fresh run. Omit
  `entries` to retain the entire queue, or supply ordered `{fromIndex}` items for
  saved entries and `{situationId}` items for library additions.
- `POST /api/review/step {id,index,direction:-1|1}` moves all views.
- `POST /api/review/end {}` finishes without removing evidence or current games.
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
