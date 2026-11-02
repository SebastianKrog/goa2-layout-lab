# Lab working-tree consolidation — 2 November 2026

Reviewed and retained the accumulated runtime/UI work: game-only Situations and independent Presentation presets; Main/live comparisons; detached bot decisions and synchronized game groups; report/review archive management; tags and library organization; separate native View windows; and device following, capture and network-reset fixes. Documentation, skills, migration helpers and coverage travel with these changes. This is an unreleased update, not a version/tag publication.

The library consolidation removes duplicate interface-specific Situations and generated Layout files while preserving game checkpoints and reusable presentation presets. The current 64 shared Situations, checkpoint references and shared review queues validate; all 131 library JSON files parse. The existing annotation helper repaired missing canonical roster tags. It validates checkpoint identities before writing metadata.

Cleanup preserves original reports, screenshots, local games and credentials in ignored `.layout-lab/`. Eight superseded R5/R6 diagnostic runners were moved into `.layout-lab/archived-review-runners/`; they are not deleted or presented as maintained tests. The full userscript comparison and final three-fix runner remain versioned. Removed dead copied Deck-only branches from the comparison runner and made recorded setup failures return nonzero. R6 preparation now imports factory recipe files directly instead of depending on an incidental earlier test's ID map.

The review-list test had a real fixture timing race: an existing list satisfied the first-element wait before replacement mocked data rendered. The test now waits for initial attachment and the expected replacement list before its assertions; assertions were not weakened.

Verification on Windows:

- Node suite: 131 passed, one intentionally skipped (132 total).
- Python suite using the maintained bot environment: 64 passed, plus 32 subtests.
- Native surfaces: separate-window controls, native input, captures, resizing, replacement and return passed.
- Real frontend/backend comparison on isolated desk 6750: mixed desktop/mobile Layout with Hand instructions, default reload and Main/live source independence passed. The runner closed its services.
- Library references, relative documentation links and patch whitespace checks passed.

Local logs: `.layout-lab/lab-cleanup-{node-tests-final,python-tests-final,native,comparison}.log`. These checks do not claim new physical-phone acceptance or complete validation of every bot policy and engine effect. No sibling frontend/backend changes are included in the lab commit.