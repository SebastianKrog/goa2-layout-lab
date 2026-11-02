# Tags

Tags are optional metadata on Situations, Decision States, View settings, and
Layouts. They do not change a checkpoint, its content hash, a Presentation, or
gameplay.

## Find a Situation

In **Situations**, use **Tags** to add filters. Each additional tag narrows the
list: a Situation must have **all** selected tags. Tags combine with Search,
Folder, and Library/Local filters. Search also matches tag names.

Click a Situation tag chip to filter by it. Remove individual filter chips or
use **Clear tags**. **Select filtered** applies to the resulting list; selections
outside the filters remain selected for a Review.

Tags appear as thin chips colored by category. Chip names omit the category
prefix; hover for the full stored tag. All tags show when they fit. When space
runs out, **+N** expands the hidden tags; resizing recalculates what fits.
Situation tags sit beside the name, with a one-line description below. Click
the description to expand it and see the phase, round and pending choice.

## Edit and save

- **Situation → More → Edit tags** edits that Situation's own tags.
- **Situation → More → Edit Decision State tags** edits the shared moment's tags.
  They apply to every Situation referencing that Decision State in the same store.
- **Edit view → Advanced settings → View tags** edits one View's labels.
  They copy with the View and persist when saving its Layout.
- **Workspace tools → Edit Layout tags** edits the selected saved Layout.
  As with other Layout edits, a local override preserves the shared source file.
- **Save…** includes a Tags field for Situations, Decision States, and Layouts.
  The Decision State picker also shows tags and offers an editor.

A Situation's effective tags combine its own tags with the referenced Decision
State's tags. Hero tags are derived from the checkpoint's entire roster, including
opponents and heroes off the board. They remain available even if manually
assigned hero tags are removed. The editor identifies inherited tags; removing a Situation's own
tags does not hide inherited ones. Local Decision State copies may have their
own metadata; editing one does not silently change the shared library.

Use commas between tags. Values are lowercased, spaces become dashes, duplicates
are removed, and tags are sorted. Up to 32 tags are allowed, each up to 48
characters using letters, digits, colons, dashes, or underscores. An empty list
clears the selected record's own tags.

## Library conventions

The curated library has initial tags based on saved facts:

| Prefix                                   | Meaning                                   | Example                                    |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| `phase:`, `decision:`                    | Engine phase and pending choice           | `phase:planning`, `decision:choose-action` |
| `topic:`                                 | Fixture coverage                          | `topic:upgrades`, `topic:runes`            |
| `hero:`, `viewpoint:`                    | All heroes in the game and viewing player | `hero:snorri`, `viewpoint:spectator`       |
| `panel:`                                 | Panel coverage label                      | `panel:hand`                               |
| `source:`, `renderer:`, `ui:`, `device:` | Saved View setup                          | `source:live`, `renderer:2d`, `ui:mobile`  |
| `views:`, `bot:`                         | Layout size and controller policy         | `views:3`, `bot:ismcts`                    |

Custom tags such as `needs-review` are welcome. Tags are curated labels, not
constraints or settings; editing a View does not automatically rewrite its tags.

To suggest tags for new curated records, run with Python from the lab root:

```sh
python scripts/tag-library.py
python scripts/tag-library.py --apply
```

The default is a dry run. Applying merges suggested tags without removing
custom tags or changing record IDs/checkpoints. The helper targets `library/`
and does not tag local user drafts.

## API

- `POST /api/tags {kind:"situation"|"decision-state"|"layout",id,tags,origin?}`
- `POST /api/configure {index,update:{tags:[...]}}` updates a running View.
- `POST /api/save {index,name,kind?,tags?}` saves record tags.
- `POST /api/layout/save {name,slots,tags?}` saves Layout and per-View tags.

Catalog Situations expose `tags` and derived `decisionStateTags`. Decision State
catalog entries and Layouts expose their own `tags`. Omitted tags retain the
existing/default values where applicable; an explicit empty list clears them.
Review Runs keep their frozen tag metadata even if library tags change later.

## Verification

```sh
node --test test/tags.test.mjs
python -m unittest test.tags_test
```

These cover combined/inherited filters, preserved Review selections, fast tag
edits, View/Layout persistence, promotion, validation, and checkpoint identity.
The backend integration suite also checks tag export/import round trips.

Tags describe coverage; a `panel:` tag does not open a panel or attach UI state to a
Situation. Use Presentation instructions for that. Controller policies apply to
the game group while synchronized, or to each View in None mode.
