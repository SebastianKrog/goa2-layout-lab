# Defense preview situations

The shared library has 24 reusable situations in `cards/defense/abilities-and-effects`
and `cards/defense/minions-and-skills`. These replace the progression-inconsistent
October 23 display drafts. Existing local Situation IDs were updated, including
older duplicate imports; historical Review Run snapshots and reports are unchanged.

The fixtures check card progression and the saved turn schedule. They are fabricated
board positions, not replays claiming to prove complete match reachability.

## Human review lists

The two reusable queue definitions are [abilities/effects](../library/reviews/abilities-and-effects.json)
and [minions/skills](../library/reviews/minions-and-skills.json). Pass a definition's
`name` and `entries` to `POST /api/review-runs/start` with the chosen Layout or slots;
these definition files are not automatically imported by the current Reviews UI.

Keep two separate lists: all 13 abilities/effects cases, and seven minion/skill
cases: friendly melee, friendly ranged, enemy ranged at distance two, mixed
minions, numeric Defense/Skill, block-only Defense, and the conditional 3+ Defense.
The no-minion baseline and redundant heavy/adjacent-enemy variants remain in the
library for targeted reuse but are omitted from the shorter basic review.

## Regenerate and validate

From the backend checkout, using its Windows Python environment:

```powershell
$env:PYTHONPATH = 'src'
.venv/Scripts/python.exe ../goa2-layout-lab/scripts/create-defense-ability-situations.py
.venv/Scripts/python.exe ../goa2-layout-lab/scripts/create-defense-variant-situations.py
```

Outputs and manifests go to ignored `.layout-lab/situation-recipes/` folders. The
factories use registered heroes and real pending defense requests. The shared
`scripts/defense_legality.py` helper applies each upgrade through the engine's legal
offer list and upgrade transition. It checks the paired items, level, one live card
per tiered color, exclusive zones, committed cards, resolved slots and initiative
order. Each factory normalizes, restores and hashes its saved checkpoint twice.

[The audit ledger](defense-situations-audit.json) records all 24 shared Situation
IDs, upgrade choices and turn schedules. The factories reproduce the conditions;
opaque request and generated Situation IDs need not be identical between runs.

## Significant corrections

- Simple items come from legal tier II upgrade pairs, with the superseded tier I
  card retired. They no longer tuck an arbitrary tier III card at level 2.
- Ballista and Poisoned Dart require level 5: all three colors reach tier II before
  one color can reach tier III. Their prerequisite upgrades and paired items exist.
- Weakness resolves at Initiative 11 including its paired item; Rogue Wave follows
  at Initiative 9, preserving the 4-to-0 Attack example.
- Misa is level 2. Matter of Honor resolves at Initiative 9 before Dangerous Current
  at 8. Power Shot is its mandatory +1 Defense item, so the offered values include
  that item as well as the +3 Defense effect.
- Poison, Barrier tokens, Inner Strength and Stone Carapace are established in
  turn 1 and inspected in turn 2. Every other hero also has a consistent prior
  turn card and a current turn commitment.
- Min is level 3: choose Inner Strength and Death Grenade, tucking Vanish for
  +1 Defense and Cluster Mine for +1 Attack. Inner Strength doubles both to +2.
- Earlier basic/minion situations now also include the roster's committed cards,
  resolution owner and remaining actors. Pending defense cards are left in hand.

New corrected review runs should load **Current library Situations**. Original
saved snapshots intentionally retain the old evidence and do not refresh silently.
