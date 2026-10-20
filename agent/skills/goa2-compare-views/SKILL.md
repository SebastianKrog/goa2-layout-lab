---
name: goa2-compare-views
description: Compare two GoA2 frontend commits in goa2-layout-lab, optionally with a pinned userscript as a third view. Prepare a live human viewer or export viewport/element screenshots, combined crops, pixel diffs, an overlay report, or paired HTML/CSS extractions using saved situations. Use goa2-ui-situations when a new game moment must first be fabricated.
---

# GoA2 compare views

Produce a comparison tied to exact frontend revisions and one reproducible situation. The requested result may be viewport/element images, HTML/CSS inspection, a static overlay/diff viewer, or a live desk left ready for a human. Choose the result the user asked for; use the native live viewer for animation and interaction review.

## Establish the comparison

Locate goa2-layout-lab and the configured frontend/backend/userscript checkouts. Read the lab README and current config/API before applying these instructions to changed versions. Resolve requested frontend refs to full Git SHAs locally. Base is commit A, Comparator is commit B; optional Target is commit A plus the pinned userscript revision. The target is not the userscript applied to B. A live working tree is a separate mode and is not immutable commit evidence.

Use the existing shared situations/ library. If the requested moment is missing, use the available goa2-ui-situations skill to fabricate/save it, then return here. Choose the actual chooser's seat; a defender/discarding hero can differ from the active actor. Record the situation ID/path and exact visual condition.

Use [references/setup-and-viewer.md](references/setup-and-viewer.md) for launch/ref selection, two/three-slot APIs, saved presentation handling, synchronization and human handoff. Preserve an existing user's games/viewpoints before replacing their comparison. An owned instance on distinct ports usually avoids that replacement. Do not stop another desk or normal dev servers.

## Align the views

For commit/layout parity, keep the checkpoint, seat, device dimensions, renderer, camera, panel, scroll, selection and inspection equivalent where the layouts support them. Two desktop 2D or two desktop 3D views are valid. Different viewpoints can be useful intentionally; label them and avoid attributing their expected differences to the commits.

Current tool limits matter: Base slots require the desktop shell; native mobile is available on Comparator/Live only when the selected commit supports it. Target requires 2D and the desktop shell and must actually activate at the chosen viewport. A desktop/3D comparison can use a separate phone/2D target as its third slot, but unequal dimensions cannot be overlaid or pixel-diffed. Do not silently present unsupported layouts as equivalent native mobile views.

Loading with restoreViews:true reinstates saved slots as well as presentations. When changing two/three views, layouts or seats, follow the adaptation recipe in setup-and-viewer.md so an old three-view preset does not replace the requested comparison. Use None sync while arranging independent UI state; API requests can keep game actions aligned, and API + clicks can mirror supported UI controls from any view. Match camera/panels explicitly; click synchronization is not a substitute for that.

Check actual status/views: correct loaded SHAs, committed sources, expected phase/decision/seat, same normalized game hash, intended panel/selection/camera, scriptActive for Target, and no restore/render/asset errors. Keep Cheats hidden. Frozen wall time does not freeze animation frames. Do not answer a pending game choice to make a screenshot look complete.

## Export images or a static viewer

Read [references/captures-and-diffs.md](references/captures-and-diffs.md). The lab capture endpoint produces originals, side-by-side.png, all compatible pairwise diffs, report.json and an HTML overlay viewer. Prefer this path to screenshots of the desk's scaled previews. Inspect the actual output images before reporting them ready.

The bundled [scripts/capture-comparison.mjs](scripts/capture-comparison.mjs) captures an already-prepared local desk, checks requested exact SHAs, rejects live sources/inactive targets/restore errors, and downloads a self-contained report into a new directory. It does not start a desk, load a situation, change refs, synchronize clicks or close the viewer. Use --help and the reference examples. It requires Node with built-in fetch, and no skill-local packages.

Equal dimensions permit a pixel diff but do not establish a fair comparison by themselves. Checkpoint divergence, different seats/cameras, mismatched panels, hover/tooltips, animation, assets and font rendering can dominate the result. Ratios are informational. Do not call a positive diff a regression or a small diff proof of parity. Preserve original dimensions; do not stretch unequal screenshots to manufacture a diff.

## Compare elements

Use a selector crop when the question concerns the actual appearance of one or
more controls. In the desk, expand **Crop image capture to an element**, enable
**Crop screenshots**, choose a selector/match policy, then use **Capture**.
The same selector is applied independently to every selected view.

| Policy             | Result                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `unique` (default) | One visible match required; ambiguity is an error.                                              |
| `nth`              | One numbered visible match in DOM order; `occurrence` starts at 1.                              |
| `union`            | One bounding rectangle including the space/content between matches.                             |
| `individual`       | One image per visible match, compared by occurrence across views.                               |
| `combine`          | The same individual images plus a horizontal strip per view, without original gaps or resizing. |

Use Individual to inspect each card/control and Combine for a compact overview.
Keep Union when spacing or neighboring content matters. Confirm semantic identity
before comparing occurrence numbers across different DOM trees. Hidden/offscreen
matches are excluded; cropping never scrolls or changes the layout. Open/scroll
the intended panel deliberately first. Missing matches in any selected view fail.
See [references/captures-and-diffs.md](references/captures-and-diffs.md) for crop API,
portable helper examples, filenames, clipping limits and pair indexing.

## Extract HTML and CSS

For source/style inspection, read
[references/html-and-css.md](references/html-and-css.md). Use the prepared views
and **Compare HTML & CSS** in the desk or `scripts/extract-sources.mjs` from the
repository root. Select exactly two views, including any two from a three-view
comparison. Default to selector-focused `--mode=element` with the narrowest useful
selector. Avoid whole-page `full` and `active` collection unless the user requests
it or a concrete whole-document question requires it. Both modes traverse every
element; `active` is not a lightweight alternative to `full`. For image-only review,
skip CSS extraction. Reuse an existing export while explaining the same snapshot;
collect again after relevant UI/state/style changes.

Computed values are resolved results; matched rules also include overridden
properties and cascade/condition metadata. Extraction includes hidden DOM
matches, unlike visible-only screenshot cropping. Inspect the outputs and source
identity before drawing conclusions. Use a crop alongside the source export to
show the actual result; HTML/CSS extraction does not render an isolated element,
replay interactions, or capture canvas/WebGL pixels.

## Leave a human viewer ready

For interactive review, launch the native embedded desk in a visible desktop session, load and arrange the requested views, verify them, and leave its owning process running. Give the user the active window/local URL, exact A/B/script SHAs, situation, seat/device/renderer, sync mode, reset behavior and the stop command. A static report supports zoom/overlay/pair selection but does not replay animations. Browser JPEG previews are a fallback for static layout work.

When only artifacts were requested, stop only the diagnostic instance you started after exporting and checking the report. Downloaded static reports remain usable after shutdown; desk report URLs and live views need the server. Do not commit, push, upload or publish artifacts unless requested. On this installation verify using Windows browsers/app and the configured WSL services; do not run Linux/WSLg test suites.

## Deliver

Link the combined PNG, requested diff(s), individual crops, source/style exports and report viewer as appropriate, with a compact reproduction record: exact revisions, situation, slots and any unavailable features or viewpoint/state mismatches. For a live handoff, state which process is left running and how to stop it. Distinguish source-inspected capability from what was actually opened/exported on the current revisions.
