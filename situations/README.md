# Shared situation library

These JSON files are part of the repo. Local and generated drafts stay in ignored `.layout-lab/situations/` until added to this library.

Open **Situations**, choose the folder, then **Open situation**. Keep **Restore saved viewpoints** enabled to restore the intended owner and presentation. The card examples use the three mobile migration sources: Base, Current build and Userscript target. You can change these to two views or desktop/3D comparisons after loading.

| Folder | Situation | Saved moment |
| --- | --- | --- |
| `planning/` | Normal and timed planning | Starting four-hero game |
| `cards/selection/` | [Arien - select a card before committing](cards/selection/e81bc3bd5fff.json) | Noble Blade selected locally; no card committed |
| `cards/actions/` | [Arien - choose an action for Noble Blade](cards/actions/e6cf117c8910.json) | CHOOSE_ACTION; Arien owns the prompt |
| `cards/upgrades/` | [Arien - choose one tier II upgrade](cards/upgrades/7596eb876af3.json) | One upgrade pending; tier II pairs offered |
| `cards/defense/` | [Brogan - choose a defense card](cards/defense/2b928b7b0ab4.json) | Brogan chooses against Arien's pending attack |
| `cards/discard/` | [Brogan - choose a card to discard](cards/discard/30735050fbde.json) | Brogan chooses from his hand; no card discarded |

These are fabricated UI checkpoints on the full Forgotten Island map using registered heroes/cards. They are not game-rule tests. Cheats are disabled in the five card examples. Loading creates independent game clones and leaves each final choice unanswered.

## Regenerate the five card examples

Use the sibling backend's installed Python environment, from its checkout:

```sh
python ../goa2-layout-lab/scripts/create-simple-situations.py
```

The script supports `--backend <checkout>` and `--output <folder>`. By default it writes import bundles and a manifest under `.layout-lab/situation-recipes/simple/`. Import a bundle in the desk and reopen it with its saved viewpoints; planning selection is presentation state. Verify the intended UI, then use **Add to library**. The script does not overwrite curated fixtures or commit anything.
