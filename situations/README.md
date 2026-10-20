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
arrangement. These fixtures cover core gameplay. The M3 presentation situations below cover
public cast-spell browsing, rune history displays and piece markers.

Regenerate import bundles with the sibling backend's installed Python:

```sh
python ../goa2-layout-lab/scripts/create-mobile-gameplay-situations.py
```

Run from the backend checkout, or pass `--backend <checkout>`. Outputs default to
ignored `.layout-lab/situation-recipes/mobile-gameplay/`. Import, verify and promote
only cases that add useful coverage; repeated acceptance runs and workspace
backups stay local. The factory does not overwrite the curated library.

## M3 presentation examples

| Folder | Situation | Saved moment |
| --- | --- | --- |
| `heroes/gydion/public-spells/` | [M3 presentation - gydion-public-spells-0](heroes/gydion/public-spells/0756dc7f3f79.json) | Public cast spells: 0 |
| `heroes/gydion/public-spells/` | [M3 presentation - gydion-public-spells-1](heroes/gydion/public-spells/158474129d8a.json) | Public cast spells: 1 |
| `heroes/gydion/public-spells/` | [M3 presentation - gydion-public-spells-10](heroes/gydion/public-spells/3ae94d18bc3b.json) | Public cast spells: 10 |
| `heroes/gydion/public-spells/` | [M3 presentation - gydion-public-spells-3](heroes/gydion/public-spells/00357f1d97ab.json) | Public cast spells: 3 |
| `heroes/gydion/public-spells/` | [M3 presentation - gydion-public-spells-9](heroes/gydion/public-spells/5949a8eccf40.json) | Public cast spells: 9 |
| `heroes/razzle/markers/` | [M3 presentation - razzle-piece-markers](heroes/razzle/markers/3536c730ea73.json) | Bounty and Poison on an owned piece, summarized on Razzle |
| `heroes/snorri/runes/` | [M3 presentation - snorri-empty-history-runes](heroes/snorri/runes/4372410c2d87.json) | Four named runes above empty turn slots; turn 2 active |

These seven situations were promoted from the Windows Chromium acceptance drafts.
Saved views use the newest Comparator commit in native mobile 2D, with separate
owner and spectator seats. M3 or newer is required. Keep **Use saved view setup**
enabled to restore both seats, or disable it to keep your own comparison sources.
There is no pre-opened menu or inspection: open Heroes or the board summary, then
use Gydion's cast-spell indicator to browse his public spells. Check Rank/Color
sorting and Large/Image inspection; private prepared spells remain owner-only.
The 0, 1, 9 and 10 cases cover empty, singular, die-pip and numeric indicators.
Snorri has Axe, Bird, Anvil and Horn in slots 1 through 4, with no played cards.
Razzle has both Bounty and Poison attached to an owned piece.

Start at 390 x 844, then check 360 x 800 and 844 x 390. Use Synchronize None while
reviewing different presentations. These are fabricated display states, not
claims about a naturally reached game sequence. Checkpoints round-trip through
the engine without changing their canonical state.

Regenerate import bundles using the sibling backend's installed Python:

```sh
python ../goa2-layout-lab/scripts/create-mobile-presentation-situations.py
```

Run from the backend checkout or pass `--backend <checkout>`. The default output
is ignored `.layout-lab/situation-recipes/mobile-presentation/`; it does not
overwrite this curated library.

## Additional visual audit situations

These normalized display checkpoints were inspected in Windows Chromium against
the pinned userscript target at portrait, compact and short-landscape sizes.
They retain their pending state; loading creates independent clones.

| Folder | Situation |
| --- | --- |
| `heroes/gydion/markers/` | [M3 presentation - gydion-three-indicators-committed](heroes/gydion/markers/f2728687d079.json) |
| `heroes/snorri/history/` | [M3 presentation - snorri-played-history-runes](heroes/snorri/history/09fa8b1ac243.json) |
| `heroes/brogan/history/` | [M3 presentation - brogan-discard-active-history](heroes/brogan/history/7cc3ce17c3e7.json) |
| `heroes/brogan/history/` | [M3 presentation - brogan-public-active-history](heroes/brogan/history/5f40e18e9cf2.json) |
| `planning/clocks/` | [M3 presentation - shell-paused](planning/clocks/dc818586ba77.json) |
| `planning/clocks/` | [M3 presentation - shell-suspended_for_inactivity](planning/clocks/15776afb8667.json) |
| `planning/clocks/` | [M3 presentation - shell-finished](planning/clocks/75b7580a23ba.json) |

History fixtures separately cover hidden and public active cards. The paused,
suspended and completed fixtures exercise shell presentation rather than timing
rules. Regenerate drafts with `scripts/create-mobile-presentation-situations.py`.
