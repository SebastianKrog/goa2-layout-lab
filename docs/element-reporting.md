# Element reports in the lab

Load one, two or three regular desk views, then click **Report an element**.
The picker is active in every view, including native Electron surfaces and
streamed browser previews. The pointer becomes a crosshair. Hover a div to see
a separate bright blue border and glow with its position and dimensions; the
inspected div itself is not restyled. Click to select it. **Escape** or **Stop
selecting** cancels picking without creating a report.

The comment popup opens while capture is prepared. Type a comment and choose
**Send report**, or press **Enter**. **Shift+Enter** adds a newline. Close keeps
the draft; **Resume report** reopens it. The comment is retained across browser
reloads while the desk stays running. **Discard** deletes the unsent capture and
creates no saved situation. Sending is safe to retry without duplicating a report.

## What is captured

Selection captures all configured views, regardless of the Capture checkboxes.
The report keeps the click-time capture while you write; sending does not take
a newer screenshot. Each view contributes:

- A PNG of the selected div's visible area, without the blue overlay or picker
  cursor style. Clipping and viewport dimensions are recorded.
- The div's outer HTML as inert text, computed CSS, matched authored CSS, and
  detailed matched/inherited/pseudo rules with cascade and condition metadata.
- A resumable game situation and its presentation, including the reporting seat,
  layout, renderer, device profile, camera and selected UI state.
- Frontend commit identity, source, configuration, restore/render/asset warnings,
  and game-state hash. Userscript targets record their script revision and
  activation. Live views record HEAD and working-tree status and are labelled
  mutable; a commit ID alone does not reproduce uncommitted edits.

The report also records the comment, selected view/div, source situation ID,
capture time, and configured backend/lab/frontend revisions. One situation from
the selected view is added to **Situations**, with **View report**. Every view's
own situation JSON is retained in the report, including divergent game states.

Across revisions/layouts, the picker matches unique identifying attributes and
CSS classes, then guarded structural/content matches. Missing or ambiguous divs
are explicitly marked for that view rather than substituting an unrelated div.
Its game checkpoint and view/revision metadata are still kept. Main-document
light DOM is supported; iframe and shadow-tree internals are not traversed by
the existing source inspector.

Picking intercepts game clicks/keys before the game and synchronization bridge.
It does not submit game actions or change bot assignments. Autoswitch pauses
while picking/capturing so it cannot replace a viewpoint under the selector.
Bots can still advance the underlying game: each view is sampled separately,
and game or geometry changes during capture are marked. Image, CSS and checkpoint
capture are not an atomic engine/browser transaction.

## Files and API

Reports stay on the PC under `.layout-lab/reports/element-<uuid>/`, with an offline
`index.html` viewer and `report.json`. Per-view exports are `view-N.png`,
`view-N.html.txt`, `view-N.computed.css`, `view-N.matched.css`,
`view-N.styles.json`, `view-N.situation.json` and `view-N.presentation.json`.
Missing captures list their reason and the files that could be collected.
Situation files include private engine information, including hidden cards.
All injection, orchestration and storage belong to the lab; no frontend or
production backend source changes are needed.

The localhost desk exposes:

- `POST /api/element-report/mode {enabled:true|false}` to activate/cancel picking
  in every open view. A pending draft must be finished or discarded first.
- `GET /api/element-report/status` for mode, draft progress and the last saved
  report URL. Large capture contents are served as report files, not status JSON.
- `POST /api/element-report/comment {id,comment}` to retain draft text.
- `POST /api/element-report/send {id,comment}` to save the completed report and
  primary situation. Comments are required and limited to 10,000 characters.
- `POST /api/element-report/discard {id}` to remove an unsent completed draft.

The lab-only checkpoint endpoint reads an in-memory game without advancing it or
creating catalog entries. Saving a situation happens only when the report is sent.

## Verification

`node --test test/element-reports.test.mjs` uses real Chromium to verify overlay
bounds, all-view activation, click interception, multiple-view exports, ambiguous
matches, escaped HTML/comments, retained comments, Enter/Shift+Enter, idempotent
submission and Escape cancellation. Python adapter tests verify credential-free,
read-only checkpoints and situation round trips.

`node test/element-report-e2e.mjs --env-file=.env.layout-lab --display=embedded`
starts an owned native desk and saves a QA report from two live game views.
`--display=browser` exercises phone-sized streamed views, including mouse hover
while the normal game input uses touch emulation. Set distinct `GOA2_LAB_*_PORT`
values first. These checks submit QA reports, verify exported revision/element/
situation files and unchanged game hashes, then stop their desk. Evidence stays
under `.layout-lab/reviews/element-reports/{native,browser}/`.
