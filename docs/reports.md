# Reports and activity groups

The **Reports** tab lists completed device reports, element reports, captures,
and HTML/CSS exports. Search comments, Situations, activity names or source
revisions; filter by type, activity and archive status. **Open report** opens the
existing evidence viewer. Reports remain available after their local Situation
is removed.

A **Lab session** is an evidence group, separate from a synchronization **game
group** or a View's UI **Session State**. See [terminology](terminology.md).

## Context and time

Reports are grouped under their **Review Run** when applicable. Other new
reports share a **Lab session**, started automatically with the desk. To split
activities without restarting, open **Settings → Reporting session**, enter an
optional name and press **New session**. This control stays out of the main
report list.

Session attribution is captured with the screenshot or selected element. Sending
a draft after starting another session keeps the original context. Each report
shows its capture date and time in the browser's locale; device evidence viewers
also show a timestamp. Existing device viewers have been stamped from their
saved capture times. Reports without recorded context are grouped by capture
date as **Earlier reports**, rather than assigned an inferred session.

## Archive and delete

Both **Reports** and **Reviews** have Current, Archived and All filters.

- **Archive** hides an item from Current; **Restore** brings it back.
- **Archive all** archives all current items in that tab, across search/type
  filters. For Reviews, it skips the Review currently running.
- **Delete** permanently removes the selected item after confirmation.
- **Delete archive** permanently removes every archived item in that tab after
  confirmation, across the other filters.

Archiving a Review groups all its Runs; its reports keep their own archive
status in Reports. Deleting a Review removes all its Runs, frozen snapshots,
collected reports and saved queue revisions. The confirmation states the scope.
End an active Review before archiving or deleting it.

Deleting an individual report also removes its link from the owning Review and
updates the Review's statistics. Shared library Situations, independent local
Situations and running games are unaffected.

## Storage

Evidence stays under ignored `.layout-lab/reports/`. Archive flags and named
sessions are stored separately in `_state.json`; they do not rewrite capture
metadata or saved checkpoints. Small `_report-index.json` files let new large
exports appear in the list without reparsing their HTML/CSS payloads. Existing
reports remain openable through their original viewers.

The list refreshes on opening and every five seconds while visible. **Refresh**
updates it immediately. Malformed/incomplete evidence does not block the rest of
the list; unfinished drafts are excluded.
