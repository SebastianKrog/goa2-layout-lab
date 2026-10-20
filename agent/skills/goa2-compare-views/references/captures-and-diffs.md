# Combined images, pixel differences and static viewers

## Choose the artifact

| Need                         | Artifact / mode                                                             |
| ---------------------------- | --------------------------------------------------------------------------- |
| Quick visual comparison      | side-by-side.png, retaining all original viewport pixels                    |
| Inspect fine changes         | report index.html with pair picker and opacity slider; compatible diff PNGs |
| Original screenshot per view | window-N.png, where N is the original 1-based desk window number            |
| Animation/input review       | Native live desk; screenshots do not replay motion                          |
| Reproduction                 | report.json plus situation and exact refs                                   |

The combined strip is unlabelled pixels in capture order. The HTML captions and report.json identify each view. If the user requests labels baked into a separate presentation image, create that as an additional derivative and retain the original strip/screenshots. Do not crop/resize originals to make unlike viewport sizes look equivalent.

## Capture the actual views

Set up and verify the comparison first. Keep hands off during capture. Use at least two selected views. POST /api/capture {indexes:[0,1]} captures two; [0,1,2] captures three. Omitting indexes captures all windows. Indexes are zero-based.

The endpoint waits for game/camera readiness, fonts, network idle, visible image decoding and successive settled images. It disables CSS animations/caret in screenshots, not all JavaScript/WebGL animation. A continually animated frame may fail to settle; use the live viewer for motion review or deliberately stop at a real stable state. Do not hide failed assets or inject synthetic game state to force success. Frozen wall time/clock values do not stop animation frames.

The response is {id,url,diverged}, with URL /reports/<id>/index.html. Artifacts are under the lab's ignored .layout-lab/reports/<id>/. Original screenshots retain emulated viewport dimensions, not the desk card's Fit scale. The report includes originals, side-by-side.png, report.json, index.html and compatible pairwise diff PNGs.

Capture errors can leave a partial report directory. Require a successful response and completed report.json/index.html before treating it as an artifact set. Restore warnings are in metadata/captions and must still be reviewed; the capture endpoint does not reject every restoration warning automatically. The bundled helper rejects selected-view warnings before capture.

## Element crops

For a requested element-focused image, use the existing capture endpoint with
`crop:{selector:".card",match:"unique"}`. The default `unique` policy requires one
visible match in each selected viewport. `match:"nth",occurrence:2` chooses the
second visible DOM-order match (one-based); `match:"union"` captures the bounding
rectangle of all visible matches, including gaps and unrelated content inside it.
`match:"individual"` saves each visible match as `window-N-match-M.png` and compares
corresponding DOM occurrences across views. Extra unmatched occurrences are retained.
`match:"combine"` saves the same individuals plus `window-N.png`, a horizontal strip
of those crops without resizing or original viewport gaps. Individual files are linked
from the viewer and included by the export helper. Unequal match counts disable the
combined strip's diff. The bounding rectangle (`union`) remains a separate option.

No visible matches or an ambiguous unique match fails the capture in that view.
No scrolling occurs; hidden/offscreen matches are excluded and partially visible
matches are clipped. This preserves the real rendering context, including
occluding content. It does not recreate an isolated element.

Inspect which elements are actually rendered before selecting the crop. The pinned
userscript discard UI, for example, hides `[data-m2-discard-source]` and paints
`.m2-discard-row` proxies. A selector list such as
`[data-decision-type] button[aria-pressed], .m2-discard-row` targets the native and
userscript choices respectively. Hidden source buttons may still appear in a CSS
extraction, but must not be used to claim a successful visible screenshot crop.

From the lab root, the portable helper can export the two migration views:

```sh
node agent/skills/goa2-compare-views/scripts/capture-comparison.mjs --origin http://127.0.0.1:3300 --indexes 1,2 --selector ".your-control" --match individual --out ./new-individual-review
node agent/skills/goa2-compare-views/scripts/capture-comparison.mjs --origin http://127.0.0.1:3300 --indexes 1,2 --selector ".your-control" --match combine --out ./new-combined-review
```

Use `--match nth --occurrence 2` to select just the second visible match.
This helper uses separate argument values (`--match combine`), unlike the source
extraction command's `--mode=element` syntax. Add expected SHA flags from the
portable-export section for fixed commit evidence.

Inspect each capture's `crop` metadata: match counts, selected DOM occurrences,
CSS bounds and pixel bounds. Crops preserve device scale and aren't resized to
match. Different sizes disable pairwise overlays/diffs. A numbered match can
refer to different semantic items across different layouts; verify content.
Cropped reports' window-N.png files contain the crops; omit crop for original
full-viewport evidence. See the README crop section for clipping scope/limits.

## Portable export helper

Run the bundled skill script using Node 22+ from any directory. Use the selected skill's scripts/ directory. For lab work, prefer this repository's version over an older installed copy:

```sh
node /path/to/goa2-compare-views/scripts/capture-comparison.mjs --origin http://127.0.0.1:3300 --out /path/to/new-export --indexes 0,1 --base-sha BASE_SHA --compare-sha COMPARE_SHA
```

For the three-view version use --indexes 0,1,2 and --script-sha SCRIPT_SHA. Supply full 40-character SHAs. --help describes arguments. The output directory must not exist. The helper checks loaded refs, selected view diagnostics, live-source use, target activation and state equality, requests the lab report and downloads the complete static set. It leaves the desk running. It needs no additional packages or private tokens. It only accepts a loopback HTTP desk origin.

Use --allow-diverged only for an intentional comparison of independently advanced games; explicitly report that distinction. Different player seats/cameras are recorded but are not rejected automatically. Unequal viewports are retained with unavailable diff pairs, not treated as export failure.

Open the exported index.html directly in a browser. It embeds its metadata and uses relative local PNG links, so no backend is needed. The same viewer is served at the desk report URL while the desk is running. Copy/share the entire export directory for a portable viewer. A lone index.html does not contain the image bytes.

## Pair indexing and diff interpretation

For each compatible pair the report creates diff-i-j.png, using zero-based positions within the ordered captures array. These are not necessarily the original desk indexes. For example indexes:[1,2] produces window-2.png, window-3.png and diff-0-1.png. Read report.json captures and pairs instead of guessing names. The top-level script field describes the loaded desk; it can be present when an unselected third Target exists. Only captures with source:"target" show the userscript, so do not infer script application from that top-level field alone.

For full viewport, Unique, Nth and Union captures, all same-size cross-view pairs are generated. Three views therefore produce up to three pairs: A/B, A/Target and B/Target. Different dimensions disable that pair's overlay and pixel difference while preserving originals and the combined strip. A separately requested phone Target alongside two desktop 3D views will usually only permit the A/B pair.

For Individual, the captures array contains one record per visible occurrence
in each selected view. Pairs link equal occurrence numbers across different
views; they do not compare different cards in the same view. Extra occurrences
are preserved without an equivalent pair. Read `index`, `occurrence`, `file` and
`crop` for each capture instead of assuming one image per view. For Combine,
`parts` links the retained individuals and `crop.tiles` records their positions
in the horizontal strip. Different match counts disable the combined diff even
if the total dimensions happen to match. Verify card/control identities: DOM
order alone does not establish semantic equivalence.

imageDiff uses pixelmatch threshold 0.1. ratio is changed pixels divided by the full image area, and pixels is the count. Metadata's diverged flag means different normalized game hashes; differentViewpoints checks seat and serialized camera. It does not certify matching panels, scroll, hover, source shell, font rasterization or all 3D inspection state. Review those manually.

A diff reflects rendered differences, including desired layout migration. It is not a rule test or a layout pass/fail score. To attribute changes to the commits, verify the same checkpoint/responder, intended panel/selection, equal dimensions/scale, camera/scroll, assets/fonts and stable frame first. State and viewpoint mismatches must appear in the handoff.

## Review and deliver

Open actual originals, strip and relevant diff PNGs using image viewing tools. Check that the intended decision/panel and owning seat are visible, the target is active, text/assets are complete and no accidental hover/inspection obscures the requested UI. A screenshot of the overall desk can document a live handoff, but its scaled surfaces do not replace original viewport captures.

Provide links to the combined image, chosen pair diff(s), originals when useful, the static viewer and reproduction metadata. Explain unavailable pairs and any deliberate mismatch. For a static-only request, close only the diagnostic instance you started after checking the exported files. For a human live-viewer request, leave it running and return its URL/window and reset/stop instructions.

## Verification scope

On 2026-10-18 the bundled helper was run against real Windows Playwright Chromium views and WSL backend services for two committed sources and the three-view userscript version, using the shared action-chooser situation. Both exported complete standalone viewers; local HTML image loading, pair selection and overlay controls passed. An intentionally wrong expected Base SHA was rejected before capture. Local evidence is .layout-lab/comparison-skill-acceptance.json and .layout-lab/runtime/comparison-skill-verification.log in the lab repo. These files are optional local records. This run did not exercise desktop 3D exports, unequal viewport exports, Linux/macOS execution or a new native live-viewer handoff; those instructions are based on the current tool implementation.

## Real-situation verification (2026-10-20)

Windows Chromium with the configured WSL services was exercised on shared
`select-card` (`e81bc3bd5fff`), `choose-action` (`e6cf117c8910`) and `discard-card`
(`30735050fbde`). Comparator was committed frontend
`f3da9d2d81ca3c944b7065d69fd56dbc028f14bd`; Target used the configured pinned Base
plus userscript. Each situation had five visible controls in each selected view.
Individual/Combine image exports and selector-focused HTML/CSS passed for all
three; Full/Active source exports passed on card selection (1,133 native and
2,175 userscript document elements, with 60 and 57 loaded stylesheets respectively).
Portable offline viewers, unchanged game hashes, and missing/ambiguous selector
failures were checked. Individual images and strips were visually inspected.

The full-page test exposed excessive duplicated inherited CSS protocol data;
exports now retain it through schema 2 matched-definition references. The small
fixture/pooling regression also passes. This does not establish Linux/macOS,
shadow/frame, animation replay or isolated HTML re-render support.

Optional local evidence index:
`.layout-lab/reviews/element-tools-review/index.html`. Reproduce with
`npm run test:element-tools`; use `-- --case=choose-action` for a focused run.
The runner owns and closes its isolated services and retains a verification
manifest and portable exports. It does not generate or alter library situations.
