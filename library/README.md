# Shared lab library

Reusable game moments and View setups shipped with the lab.

```text
library/
  situations/       # named game-only Decision State references
  decision-states/  # exact engine checkpoints, shared by Situations
  layouts/          # View settings and synchronization; no checkpoint
  presentations.json # reusable session changes; no game state
```

## Use it

Open **Situations**, search or filter by folder, and choose **Open situation**.
Choose a Layout first. Loading a Situation keeps its sources, devices and renderers.
Use optional Presentation instructions for panels, card roles and public spells.
Choose Viewpoint separately. Without a chosen Layout, Open situation uses one
desktop working-tree View.

Select several Situations and **Start review** to inspect them in order.
See [terminology](../docs/terminology.md), [workspace](../docs/workspace.md),
and [reviews](../docs/reviews.md).

Each Situation has a content-based name and a short description. Expand the
description in the list for the saved condition and phase/decision context.
Names describe the game moment rather than milestone numbers.

## Tags

Use **Tags** in Situations to combine filters; matching uses all selected tags,
including tags inherited from the Decision State. **More → Edit tags** changes
a Situation’s own labels. See [tags](../docs/tags.md) for conventions and editing
Views, Layouts, and Decision States.

## Coverage

| Situation folder                     | Examples                                                    |
| ------------------------------------ | ----------------------------------------------------------- |
| [planning](situations/planning/)     | Normal/timed planning, clocks, waiting status               |
| [cards](situations/cards/)           | Card selection, action choice, defense, discard, upgrades   |
| [heroes](situations/heroes/)         | Hero abilities, public spells, runes, markers, card history |
| [resolution](situations/resolution/) | Ties, turn order, completed turns, off-board heroes         |
| [board](situations/board/)           | Physical minions in multiple battle zones                   |

These are reproducible UI fixtures, including fabricated display states.
They keep pending choices unanswered and do not replace game-rule tests.

## Add or regenerate

New saves and imports stay in ignored `.layout-lab/situations/`.
Inspect them in the lab, then use **Add to library** to create a shared copy.
Decision States are stored separately and deduplicated by exact content.

The [factory scripts](../scripts/) generate local import bundles:
`create-simple-situations.py` for basic card choices, and
`create-mobile-{gameplay,presentation,resolution}-situations.py` for broader coverage.
Run them with the configured backend's Python environment. Import, verify, and
promote useful cases; factories do not overwrite curated entries.

Older bundles use the [offline porting tool](../docs/state-model.md#porting-older-situations).
