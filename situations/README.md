# Shared situation library

These JSON files are part of the repo. Local and generated drafts stay in ignored `.layout-lab/situations/` until added to this library.

Open **Situations**, choose the folder, then **Open situation**. Keep **Use saved view setup** enabled to restore the intended owner and presentation. The card examples use the three mobile migration sources: Base, Current build and Userscript target. You can change these to two views or desktop/3D comparisons after loading.

| Folder | Situation | Saved moment |
| --- | --- | --- |
| `planning/` | Normal and timed planning | Starting four-hero game |
| `cards/selection/` | [Arien - select a card before committing](cards/selection/e81bc3bd5fff.json) | Noble Blade selected locally; no card committed |
| `cards/actions/` | [Arien - choose an action for Noble Blade](cards/actions/e6cf117c8910.json) | CHOOSE_ACTION; Arien owns the prompt |
| `cards/upgrades/` | [Arien - choose one tier II upgrade](cards/upgrades/7596eb876af3.json) | One upgrade pending; tier II pairs offered |
| `cards/defense/` | [Brogan - choose a defense card](cards/defense/2b928b7b0ab4.json) | Brogan chooses against Arien's pending attack |
| `cards/discard/` | [Brogan - choose a card to discard](cards/discard/30735050fbde.json) | Brogan chooses from his hand; no card discarded |
| `heroes/gydion/` | [Gydion - choose a spell for Cantrip](heroes/gydion/dbd50506df47.json) | SELECT_CARD for Cantrip; Gydion chooses a known spell, none submitted |
| `heroes/snorri/` | [Snorri - choose the first inscription rune](heroes/snorri/0601f17bbdab.json) | SELECT_OPTION; Snorri chooses the first rune, none inscribed |
| `heroes/emmitt/` | [Emmitt - choose a second card with ultimate](heroes/emmitt/eebbbbab698b.json) | Level 8 planning; first card committed, second card still choosable |

These are fabricated UI checkpoints on the full Forgotten Island map using registered heroes/cards. They are not game-rule tests. Cheats are disabled in the five card examples. Loading creates independent game clones and leaves each final choice unanswered.

## Regenerate the five card examples

Use the sibling backend's installed Python environment, from its checkout:

```sh
python ../goa2-layout-lab/scripts/create-simple-situations.py
```

The script supports `--backend <checkout>` and `--output <folder>`. By default it writes import bundles and a manifest under `.layout-lab/situation-recipes/simple/`. Import a bundle in the desk and reopen it with its saved viewpoints; planning selection is presentation state. Verify the intended UI, then use **Add to library**. The script does not overwrite curated fixtures or commit anything.

## Hero gameplay examples

The `heroes/gydion`, `heroes/snorri` and `heroes/emmitt` folders contain one curated
checkpoint each, promoted from the M2 gameplay acceptance drafts. Saved slots use
the owning hero in Base, Comparator (native mobile) and Userscript target. Choose
M2 or newer for the native mobile comparator. Open Hand for Emmitt to select his
second card; the saved checkpoint already has his first card committed. Selection
and inspection remain separate from submitting a choice.

Gydion starts at the spell chooser, before its follow-up action prompt. Snorri
starts before the first inscription choice, rather than after the completed rune
arrangement. These fixtures cover core gameplay; public cast-spell browsing and
polished rune history displays require separate situations and later UI work.

Regenerate import bundles with the sibling backend's installed Python:

```sh
python ../goa2-layout-lab/scripts/create-mobile-gameplay-situations.py
```

Run from the backend checkout, or pass `--backend <checkout>`. Outputs default to
ignored `.layout-lab/situation-recipes/mobile-gameplay/`. Import, verify and promote
only cases that add useful coverage; repeated acceptance runs and workspace
backups stay local. The factory does not overwrite the curated library.
