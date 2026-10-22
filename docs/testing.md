# Testing the layout lab

Run commands from the repository root unless a snippet explicitly changes directory.
Use the configured backend Python environment. On this Windows installation, use
Windows Chromium with the configured WSL services. Give acceptance desks distinct
ports and stop only their owned services; preserve existing developer sessions.

```sh
npm test
python test/situations_test.py
```

Backend integration checks use the sibling backend environment:

```sh
cd ../goa2-backend
uv run --locked python ../goa2-layout-lab/test/backend_test.py
```

For browser automation/CI diagnostics without opening desktop windows:

```sh
npm run compare -- --headless --no-open --no-auto-load
```

The explicit browser acceptance suite requires a separately marked instance:

```sh
npm run compare -- --headless --no-open --no-auto-load --verification
# In a second terminal on the same host/runtime:
node test/e2e.mjs
```

It refuses to attach to an ordinary interactive desk. It creates clearly named
acceptance situations, exercises real phone and desktop 3D views, and writes its
evidence to `.layout-lab/acceptance.json`. Its Live CSS probe restores the exact
original content afterward.

With that instance still running, check the dashboard and standalone report controls:

```sh
node test/desk-ui.mjs
node test/presentation-e2e.mjs
```

The upgrade Confirm tap-target regression owns a separate headless verification desk
(default ports 3500-3503 and 8500) and tests the configured frontend working tree:

```sh
npm run test:mobile-confirm
```

It loads the shared tier-II upgrade situation in mobile and desktop 2D shells at
390x844, 360x800 and 844x390. It stages a card, checks the enabled Confirm button
receives hits at its center and corners at both scroll extremes, then submits one
real touch tap and verifies exactly one accepted upgrade. Failures save a browser
screenshot under `.layout-lab/runtime/`. The suite closes only its owned services.
Runtime/checkout overrides use the usual `GOA2_LAB_*` variables.

The M2 gameplay acceptance suite also owns its instance (default ports 3600-3603
and 8600) and tests the frontend working tree:

```sh
npm run test:mobile-gameplay
```

It uses the shared simple situations and runs
`scripts/create-mobile-gameplay-situations.py` to fabricate real Gydion spell,
Snorri inscription and Emmitt second-card checkpoints. Python resolves from
`GOA2_LAB_PYTHON`, the sibling backend environment, or `uv run --project` as a
fallback with an isolated environment under `.layout-lab/runtime/`. Checks cover inspection without submission, selected-card/inspection
capture and restore, accepted core actions, sequential rune confirmations with
the automatic fourth rune, spell-action follow-up, and Emmitt take-back, second
commit and Done. Screenshots and `evidence.json` go under ignored
`.layout-lab/reviews/m2-*/`; generated situations remain local drafts.

The M3 presentation suite owns ports 3700-3703 and 8700 by default:

```sh
npm run test:mobile-presentation
```

It generates real-map display fixtures with
`scripts/create-mobile-presentation-situations.py`, then checks owner/opponent/
spectator public spell access, counters 0/1/3/9/10, scoped embedded spell readers,
sorting, nested/public presentation save and restore, portrait/compact/landscape
bounds, shared image painting, rune history and markers on Razzle's pieces.
The rune flow also covers a real reload, Board peek, Undo and acknowledgment of
the automatic fourth rune. `--runes-only` runs just that recovery flow.
Screenshots and evidence go to ignored `.layout-lab/reviews/m3-*/`. Factories do
not overwrite the curated library. Run these browser checks on Windows on this
installation; normal WSL services are used without running Linux UI test suites.

For paired visual reports against the pinned userscript target:

```sh
npm run test:mobile-roster-visual
npm run test:mobile-spells-visual
npm run test:mobile-ready-visual
npm run test:mobile-shell-visual
npm run test:mobile-special-visual
npm run test:mobile-card-fallback
npm run test:mobile-status-visual
npm run test:mobile-decision-visual
```

The roster runner uses ports 4600-4603/9600 and accepts a focused filter such as
`-- --case=snorri` or `-- --case=brogan`. It includes empty and occupied rune slots,
masked and public active history, discard piles and crowded public indicators.
The spell runner uses 4700-4703/9700 and compares selected Large/Image readers
at all three sizes, including rotation and closing the browser afterward.
The ready runner uses 4500-4503/9500, checks the Ready tap target at all three
sizes and submits readiness on both clones before comparing running clocks.
The shell runner uses 4800-4803/9800 and captures paused, suspended and completed
match states from real-model fixtures, without consuming their pending readiness.
The special runner uses 4900-4903/9900 for Emmitt's second-card selection,
starting-position adjustment, an actual routed WebSocket outage/recovery, and a
long Snorri card. The fallback runner uses the same ports; run it separately.
It intentionally returns HTTP 404 for native Snorri card backgrounds, records the
routed failures, and saves labeled raw originals/combined images for Large and
Image readers. The target retains its normal Large text view. This fault check
bypasses the clean-asset report exporter, whose normal missing-asset rejection
remains unchanged. Its manifest names the intentional fault and source settings.
The status runner uses 5100-5103/10100 for a real ten-hero waiting message,
collapsed/expanded ticker behavior, reduced motion, fixed-height Board rows and
reopening the shared history fixtures. The decision runner uses 5200-5203/10200
for defense/discard/spell/gold choices and supplementary hero details. It labels
native staged choices versus immediate-submit target choices explicitly; discard
selection is aligned on both sides. Embedded spell inspection also verifies
parent bounds and safe capture/restore without sending a game choice.
These runners produce original screenshots, combined images, diffs and HTML reports under
`.layout-lab/reports/`, with manifests under `.layout-lab/reviews/`. They use Live
working-tree sources; review the images before making a visual-parity claim.

The frontend remains unchanged in production: camera/presentation bridges are
injected only by the lab Vite config. The backend helper lives in this tool and
is never imported by the normal backend entrypoint.

Embedded-view checks (real Chromium, no game services required):

```sh
npm run test:streams
```

On the marked verification desk, test embedded input against real phone and desktop 3D games:

```sh
npm run test:embedded
```

Native desktop checks (a display is required, or Xvfb on Linux):

```sh
npm run test:native
# Use distinct ports; this suite owns and closes its instance:
npm run test:native-e2e
# Focused synchronization / live-update checks:
npm run test:sync
```

The native suite checks all three phone versions, the userscript, direct input,
modal layering, scaling, save/capture/reload, two desktop 2D views and two desktop
3D views with camera controls. It also verifies that no screenshot stream is used.

### Mobile Deck browsing and plans (M4)

```sh
npm run test:mobile-deck
```

This focused Windows Chromium check owns diagnostic ports 3800-3803 and 8800.
It uses the shared Arien card-selection and Gydion public-spells-3 situations to
check Tree/List/Grid, local plan persistence after reload, preview selection,
390x844 / 360x800 / 844x390 layouts, and owner/spectator visibility. Browsing and
planning must preserve the authoritative state hash and scoped live view.
It records working-tree screenshots/evidence in ignored `.layout-lab/reviews/m4-*/`
and closes only its own desk/services. The frontend's M4 integration notes own
plan/preference migration and later M5/M6 upgrade submission scope.

### Deck/shared-card visual parity

```sh
npm run test:mobile-visual
```

This isolated Windows comparison uses ports 3900-3903/8900 and the configured
frozen Base/userscript refs against the frontend's Live working tree. It captures
28 native/target pairs for Arien/Gydion: Tree/List/Grid and card previews at
390x844, 360x800 and 844x390, plus Large/Image spell readers. Each report contains
originals, a combined PNG, pairwise diff and standalone HTML overlay viewer.
State hashes, panel geometry, compact-card heights and actual canvas pixels are
checked; rendering and asset failures fail the run. Captures wait for native card
paint readiness so a temporarily transparent canvas cannot count as finished.
The helper stops only its own desk and leaves artifacts under ignored
`.layout-lab/reviews/parity-*/` and `.layout-lab/reports/`. Set `GOA2_PARITY_TAG` to
label a run. These are working-tree comparisons, not immutable commit evidence.
The match header/camera and native localized card text are outside this focused
Deck/shared-card visual comparison; full device/app acceptance remains separate.

### Resolution order parity (M3)

```sh
npm run test:mobile-resolution-visual
```

This Windows Chromium comparison owns ports 5300-5303/10300. Its factory
`scripts/create-mobile-resolution-situations.py` uses real planning commits on
the full map: Arien/Hanu/Tigerclaw at initiative 13, Brogan at 11, with the
initial coin on RED. It saves the actual teammate-choice prompt and the next
action prompt after choosing Hanu. Both checkpoints are restored twice and
checked for stable canonical state. These are generated drafts under ignored
`.layout-lab/situation-recipes/mobile-resolution/`.

The browser uses each view's Board-peek control without answering the pending
game choice, compares Board and Heroes at 390x844, 360x800 and 844x390, and
checks order labels, visible badge bounds and matching game hashes. Reports
under `.layout-lab/reviews/resolution-*/` describe Live versus the frozen target;
they are working-tree evidence. The frontend retains server-provided initiative
ordering, including Reverse Time; unit coverage verifies the ascending case.
The helper closes only its owned diagnostic desk and services.

### Library defaults and remaining card/turn states

```sh
npm run test:mobile-library-reopen
npm run test:mobile-turn-state-visual
npm run test:mobile-turn-state-visual -- --case=emmitt-two-commits
npm run test:mobile-status-visual -- --status-only
npm run test:mobile-spells-visual -- --rank4
```

Library reopening uses diagnostic ports 5400-5403/10400 and the regular desk
composed Situation load endpoint. It checks the shared long-status, Takahide gold,
team-tie and selected-teammate entries with their saved Base/Comparator/Target
sources, seats, layouts, hashes and actual pending decisions. Three-column
reports are restore checks, rather than evidence of Live source parity.

Turn-state comparisons own ports 5500-5503/10500 and generate normalized real
checkpoints with the resolution factory: Hanu's accepted HOLD/confirmation,
a hero without a queued or completed card, and an off-board hero. They compare
Board/Heroes at all three phone sizes. Assertions distinguish completion from
absence, retain the just-resolved card, and check fixed row/column bounds.
The Emmitt case uses the gameplay factory, commits his second card through
native UI and mirrors the real command with API synchronization before taking
paired images. Opponent masking remains covered by frontend integration tests.
Factory outputs remain local drafts; curated turn-state, two-card Emmitt and
public rank-IV Wish copies are indexed in [the shared library](../situations/README.md#completed-turns-off-board-heroes-and-final-card-variants). The off-board variant deliberately
removes Brogan and discards his unresolved card without claiming a natural play
sequence. No production saves or engine rules are modified.

`--status-only` limits the existing status runner to its ten-hero long-status
case and verifies horizontal as well as vertical row bounds. The spell runner's
`--rank4` mode uses a fabricated public Wish with all other prepared spells still
masked. It checks a spectator can inspect Large/Image at three sizes and the
Tiny row has solid rank-IV end accents without an initiative rail. It uses the
usual spell-runner ports 4700-4703/9700. These remain Live-versus-frozen-target
comparisons, and each owned diagnostic desk closes after capture.

### Staged mobile upgrades and runes (M6)

```sh
npm run test:mobile-batches
```

This regression owns ports 5910-5913/10910 and tests the configured frontend
working tree with shared situations `3fd1f952c1a6` (three upgrades) and
`0601f17bbdab` (Snorri inscription). The backend must advertise upgrade
`supports_preview` plus batch capabilities. Native mobile is checked against
real engine offers at 390x844, 360x800 and 844x390; the pinned userscript Target
is captured as a visual reference, not assumed to share native batch semantics.
Checks cover separate hypothetical Preview, Reset, Board peek/camera, immutable
staging, one accepted complete Commit, and viewport/navigation/five-point tap
bounds. A recovery flow covers legacy single-rune acknowledgment, actual reload,
Undo, reconnect and explicit batch confirmation without automatic replay.
Reports and images are written under ignored `.layout-lab/runtime/mobile-batches-*`.
Only owned services are closed. Normal checkout/ref/port overrides apply.

`test:mobile-confirm` supports both the new single-upgrade Commit and the legacy
Confirm picker, and continues testing desktop at all three sizes. Run it against
an older backend checkout with `GOA2_LAB_BACKEND` to verify capability fallback.
The gameplay and presentation regressions support batch rune staging while
retaining legacy single-choice transport coverage.

### Upgrade card visual states

```sh
npm run test:mobile-upgrade-parity
```

Uses isolated ports 5920-5923/10920 and the Live frontend versus frozen Base plus
userscript. At portrait, compact and landscape sizes it exports original-size
paired small-card crops, pixel diffs, viewport images and `cards.json` containing
focused computed styles. Initial, staged, hypothetical Preview, hover and keyboard
focus are compared. A local six-upgrade draft is restored through the engine and
advanced with legacy single confirmations to verify observed item-history states.
The runner asserts dimensions, icon geometry, border/background/shadow and opacity;
it does not assume that arbitrary screenshot differences prove a regression.
Animation is reduced consistently for stable viewed-card comparisons. The draft
stays local under ignored data. No whole-page CSS traversal is performed.
Evidence is under `.layout-lab/reviews/m6-parity-*`; owned services close on exit.

For focused reruns use `npm run test:mobile-upgrade-parity -- --profile=portrait`
(or `compact,landscape`). Each viewport also exports the standard combined-image,
pixel-diff and overlay viewer report; its report metadata is saved in
`<profile>-viewer.json`. `test:mobile-batches` accepts the same profile filter.

### Shared card artwork and blur comparison

`npm run test:mobile-card-visual` compares the live mobile renderers with the
frozen baseline plus userscript in Windows Chromium. It opens independent clones
of library situations for Arien Large upgrade/Deck readers, Small/Tiny Hand rows,
Brogan history/Nano discards, and Gydion Large/Image public spells including
rank IV as spectator. Use `-- --case=deck-large,spell-large --profile=portrait`
for a focused rerun. Generic card Image rendering has no equivalent target mode;
it is not presented as an equal-mode image comparison.

Evidence is saved under `.layout-lab/reviews/cards-*`: viewport report links,
per-card HTML/computed styles, artwork/mask/bar layers, and element crops. Hand,
history and discard crops combine visible matches individually without resizing.
The runner checks unchanged game hashes, native render errors and equal artwork
filter/scale/mask/opacity for text cards. Large headers/footers must use 5px
backdrop blur. No whole-document CSS is collected. The current crop helper cannot
resolve some fixed target previews in landscape; the manifest records that gap
and retains the full viewport report. Full images and reported source identities
remain the evidence; passing sampled checks does not establish universal parity.
Add `--selected` with `--case=deck-large,hand-small,spell-large` to compare the
selected-source sheen. It verifies the reduced-motion gradient and deterministic
1-second animation frames against Target, including 4s/4.2s timings and pointer
pass-through, then captures the selected rows. History/Nano/upgrade cases are
excluded in this mode.


### Native 2D camera and hero focus (M7)

`npm run test:mobile-camera` uses owned Windows Chromium views and the configured
backend services. Existing library situations cover Arien/Hanu focus, Razzle’s
owned-piece focus and movement target selection. It checks keyboard inspection
separately from centering, anchored pinch/twist, cancellation, portrait/compact/
landscape centering in the unobscured Board area, fit/reset and camera restore.
The final isolated clone submits a real movement target after a gesture. Paired
reference captures are saved under `.layout-lab/reviews/m7-camera-*`. This is
synthetic browser touch coverage; physical-device gestures remain M9 acceptance.

Native camera presentations now include an optional `angle`. Older saves without
it restore at zero rotation. The userscript continues using its separate saved
rotation adapter. Frozen frontend revisions lacking native rotation reject an
unsupported rotated camera copy explicitly. Equal viewports and matching panes
are still required before judging visual differences.


### Native mobile utilities (M8)

Run `npm run test:mobile-utilities` for the focused Windows Chromium check against
the configured frontend working tree. It owns ports 5980–5983/10980 and reuses
shared planning, Gydion public-spells and six-upgrade situations. It checks live
appearance/audio/language settings, reload persistence, fullscreen, the scoped
Decisions route and retry, layered spell/Deck navigation and upgrade preview
dismissal. Portrait, compact and short-landscape captures compare Live/mobile
with the pinned userscript Target. A separate native commit checks actual history
and spectator card masking after the paired captures. Generated evidence stays
under `.layout-lab/reviews/m8-utilities-*` and `.layout-lab/reports/`.

No native Linux tests or automatic phone activation are included. Browser touch
and fullscreen checks do not establish physical-device acceptance.

## State model and review workflows

See [state-model checks](state-model.md#verification) for the focused Python,
workspace, restoration and review suites. [Recorded validation](validation/state-model-2026-10-22.md)
distinguishes completed checks from outstanding browser/device coverage. Test results
apply to the sources and environment recorded by each run.
