# Bot traversal profiling — 2026-10-23

Offline reproduction of Brogan's opening action choice, using the saved
reported position, heuristic policy/value, lab positioning evaluator, two-game-turn
horizon and ten-second decision budget. The live lab was not restarted.

## Findings

Search is single-worker. The inference API serializes decisions with an async
lock and runs each search in a background thread; this is not parallel MCTS.
Profiling showed repeated fast-travel legality/safe-zone work dominated traversal,
with ordinary topology distance checks also resolving occupants unnecessarily.
Cloning was not the leading bottleneck in this reproduction.

## Changes (separate bots checkout only)

- Prepared candidate predicates resolve fast-travel action restrictions and safe
  zones once per read-only candidate scan, retaining topology, barrier, emptiness,
  source-card and adjacent-zone checks for every destination. Prepared predicates
  are local to the scan; nothing is cached across state or context mutations.
- Selection and heuristic fast-travel scans use the prepared predicate.
- Topology resolves acting/target unit IDs only when a split or isolation effect
  actually needs them. Ordinary states retain geometric distance/connectivity.

## Fixed-work comparison

Local Windows Python, same seed and recorded checkpoint, six simulations,
internal deadline disabled, three repetitions per version:

| Version | Median time |
| --- | ---: |
| Original | 3.452 s |
| Prepared fast-travel scans | 1.012 s |
| Plus topology fast path | 0.777 s |

Combined speedup: **4.44x** on this position. Selected action, root visits and all
root-action mean values were identical at the fixed six-simulation workload.
This isolates traversal speed from the extra exploration a timed search gets.
These results are not a general performance guarantee across maps or rosters.

## Validation

179 tests passed across fast travel, source-card effects, adjacent-zone travel,
static barriers, topology splits/isolation, turn cutoffs, deadline recovery and
bot construction. A regression verifies one legality/safe-zone computation per
scan and fresh checks after an enemy moves. Lab inference/scoring tests are
checked separately. Raw benchmark/profile files remain under ignored
`.layout-lab/runtime/traversal-*`.

## Follow-up: scoring batches and fingerprint byte output

A fresh profile after the first optimizations attributed about 4.1 seconds of
nine seconds to heuristic option scoring (including 2.6 seconds of position
scoring) and 1.7 seconds to state fingerprints. Those cumulative times overlap.

Position scoring now reuses enemy positions and repeated destination scores only
within a read-only scoring batch, with ContextVar isolation and explicit cleanup
for exceptions and nested batches. No reuse survives a new batch or state
mutation. Hex distance uses equivalent cube arithmetic without allocating a new
validated Hex. Progression fingerprints still hash the complete original JSON
payload, but produce bytes directly instead of decoding and re-encoding them;
exact equality with the previous fingerprint is covered by regression tests.
Alternative serializers were measured and not adopted where slower or unsafe.

The fixed six-simulation median fell again, from 0.777 to **0.553 seconds**
(three repetitions; another **1.40x**, approximately **6.24x** from the original).
The fixed-work decision and all root statistics remained identical. A subsequent
live-budget offline run completed **75 simulations** in about nine seconds,
compared with 53 after the earlier optimization. Timed visit counts depend on
machine load and change the explored tree; they do not guarantee better play.

Follow-up checks: 86 existing search/evaluation/topology tests, 98 heuristic,
progression guard, root, learned-adapter and new cache/fingerprint tests, plus
16 lab inference/scoring tests. Search remains single-worker. The live lab was
not restarted.


## Follow-up: roster supply and compact binary state

The engine now allocates only token supply available to the actual hero roster,
including future upgrades and spells. Restoring older checkpoints prunes unused
supply while retaining deployed/owned scenario tokens. Existing entity numbering
and seeded mine assignments remain stable. This engine fix is present in both
backend checkouts; the compact search encoder below lives only in the bots copy.

Search keys now use one mutable record per card/token, with references from card
collections, token supply and the entity registry. Fixed card/hero/minion/token
properties are interned by value within a bounded per-search catalog; modified
scenario definitions remain distinguishable. Card states are numeric, boolean
flags are bitmasks and optional card data is sparse. Other rule state, including
hidden hands, prompts, effects, execution context and seed, is retained.

This supersedes the earlier full-JSON fingerprint implementation. Normal engine
models, save files and API responses retain their existing structure. Binary
encoding disables identity memoization so cloning and save/load round trips
produce identical keys within the same search catalog. These keys must not be
persisted or compared across independently populated definition catalogs.

For the recorded four-hero game, roster pruning reduces the compact JSON input
from 24,581 to 10,112 bytes. Shared records and binary encoding reduce it further
to **6,315 bytes**: 37.6% below the pruned JSON, 74.3% below the earlier compact
input. The six-simulation reproduction retains the same decision, root visits
and per-action statistics. Payload reduction is not a proportional search-speed
claim; rules traversal and policy scoring still consume most of the work.

Encoder semantics and mutation coverage are documented in the bots checkout's
`docs/BOT_SEARCH_STATE.md` and `tests/automata/test_search_reuse.py`. No running
lab or server was restarted for these changes.


Final checks for the binary encoder: **3,332** engine/domain rules tests,
**133** classic search/clone/compact-state tests, and **16** lab bot-service and
scoring tests passed. The final rules run includes the corrected Emmitt supply
fixture. Formatting, lint and whitespace checks passed for the new encoder.


## Follow-up: persistent worlds and action timing

The fixed forty-iteration reproduction now has a 1.277-second median over three
runs (1.277, 1.268, 1.280 seconds), about 31 completed simulations/second.
This retains the two-game-turn continuation, scoring and root statistics;
the 1,000 simulations/second target remains unmet. Persistent tile snapshots,
verified carried state keys, exact decision replay, bounded selectors and bitset
movement remove repeated work. Custom rules/tiles, effects and token semantics
retain conservative general paths. See the bots docs/BOT_SEARCH_STATE.md for
cache identity, RNG replay and independent-world guarantees.

A 200-iteration paired check preserved every action's visits and score and the
chosen action with owned-continuation reuse enabled versus disabled. The full
engine/domain plus affected classic-search and clone suite passed 3,490 tests.
No live lab/backend was restarted.

An instrumented 200-simulation opening-position run spent 2.273 seconds in
movement-rooted simulations, 2.191 in fast travel, 1.179 in attack, 1.068 in hold,
and 1.038 in clear (40 simulations per action). These are full branch times,
including subsequent simulated decisions. Movement/fast-travel scoring took
0.956 seconds, compared with 0.079 seconds executing their move-unit steps.
SelectStep was the most expensive actual rule step at 0.620 seconds, followed
by ResolveCardStep at 0.511 and ResolveCardTextStep at 0.170. These timings overlap
branch totals and must not be summed with them. Few attacks connected in this
opening, so this does not measure crowded combat. The raw capture is in ignored
.layout-lab/runtime/search-1000-action-breakdown.json.
