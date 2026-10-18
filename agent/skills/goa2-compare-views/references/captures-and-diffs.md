# Combined images, pixel differences and static viewers

## Choose the artifact

| Need | Artifact / mode |
| --- | --- |
| Quick visual comparison | side-by-side.png, retaining all original viewport pixels |
| Inspect fine changes | report index.html with pair picker and opacity slider; compatible diff PNGs |
| Original screenshot per view | window-N.png, where N is the original 1-based desk window number |
| Animation/input review | Native live desk; screenshots do not replay motion |
| Reproduction | report.json plus situation and exact refs |

The combined strip is unlabelled pixels in capture order. The HTML captions and report.json identify each view. If the user requests labels baked into a separate presentation image, create that as an additional derivative and retain the original strip/screenshots. Do not crop/resize originals to make unlike viewport sizes look equivalent.

## Capture the actual views

Set up and verify the comparison first. Keep hands off during capture. Use at least two selected views. POST /api/capture {indexes:[0,1]} captures two; [0,1,2] captures three. Omitting indexes captures all windows. Indexes are zero-based.

The endpoint waits for game/camera readiness, fonts, network idle, visible image decoding and successive settled images. It disables CSS animations/caret in screenshots, not all JavaScript/WebGL animation. A continually animated frame may fail to settle; use the live viewer for motion review or deliberately stop at a real stable state. Do not hide failed assets or inject synthetic game state to force success. Frozen wall time/clock values do not stop animation frames.

The response is {id,url,diverged}, with URL /reports/<id>/index.html. Artifacts are under the lab's ignored .layout-lab/reports/<id>/. Original screenshots retain emulated viewport dimensions, not the desk card's Fit scale. The report includes originals, side-by-side.png, report.json, index.html and compatible pairwise diff PNGs.

Capture errors can leave a partial report directory. Require a successful response and completed report.json/index.html before treating it as an artifact set. Restore warnings are in metadata/captions and must still be reviewed; the capture endpoint does not reject every restoration warning automatically. The bundled helper rejects selected-view warnings before capture.

## Portable export helper

Run the bundled skill script using Node 22+ from any directory. The script is located under this skill's scripts/, not inside the lab repo:

~~~sh
node /path/to/goa2-compare-views/scripts/capture-comparison.mjs --origin http://127.0.0.1:3300 --out /path/to/new-export --indexes 0,1 --base-sha BASE_SHA --compare-sha COMPARE_SHA
~~~

For the three-view version use --indexes 0,1,2 and --script-sha SCRIPT_SHA. Supply full 40-character SHAs. --help describes arguments. The output directory must not exist. The helper checks loaded refs, selected view diagnostics, live-source use, target activation and state equality, requests the lab report and downloads the complete static set. It leaves the desk running. It needs no additional packages or private tokens. It only accepts a loopback HTTP desk origin.

Use --allow-diverged only for an intentional comparison of independently advanced games; explicitly report that distinction. Different player seats/cameras are recorded but are not rejected automatically. Unequal viewports are retained with unavailable diff pairs, not treated as export failure.

Open the exported index.html directly in a browser. It embeds its metadata and uses relative local PNG links, so no backend is needed. The same viewer is served at the desk report URL while the desk is running. Copy/share the entire export directory for a portable viewer. A lone index.html does not contain the image bytes.

## Pair indexing and diff interpretation

For each compatible pair the report creates diff-i-j.png, using zero-based positions within the ordered captures array. These are not necessarily the original desk indexes. For example indexes:[1,2] produces window-2.png, window-3.png and diff-0-1.png. Read report.json captures and pairs instead of guessing names. The top-level script field describes the loaded desk; it can be present when an unselected third Target exists. Only captures with source:"target" show the userscript, so do not infer script application from that top-level field alone.

All same-size pairs are generated. Three views therefore produce up to three pairs: A/B, A/Target and B/Target. Different dimensions disable that pair's overlay and pixel difference while preserving originals and the combined strip. A separately requested phone Target alongside two desktop 3D views will usually only permit the A/B pair.

imageDiff uses pixelmatch threshold 0.1. ratio is changed pixels divided by the full image area, and pixels is the count. Metadata's diverged flag means different normalized game hashes; differentViewpoints checks seat and serialized camera. It does not certify matching panels, scroll, hover, source shell, font rasterization or all 3D inspection state. Review those manually.

A diff reflects rendered differences, including desired layout migration. It is not a rule test or a layout pass/fail score. To attribute changes to the commits, verify the same checkpoint/responder, intended panel/selection, equal dimensions/scale, camera/scroll, assets/fonts and stable frame first. State and viewpoint mismatches must appear in the handoff.

## Review and deliver

Open actual originals, strip and relevant diff PNGs using image viewing tools. Check that the intended decision/panel and owning seat are visible, the target is active, text/assets are complete and no accidental hover/inspection obscures the requested UI. A screenshot of the overall desk can document a live handoff, but its scaled surfaces do not replace original viewport captures.

Provide links to the combined image, chosen pair diff(s), originals when useful, the static viewer and reproduction metadata. Explain unavailable pairs and any deliberate mismatch. For a static-only request, close only the diagnostic instance you started after checking the exported files. For a human live-viewer request, leave it running and return its URL/window and reset/stop instructions.

## Verification scope

On 2026-10-18 the bundled helper was run against real Windows Playwright Chromium views and WSL backend services for two committed sources and the three-view userscript version, using the shared action-chooser situation. Both exported complete standalone viewers; local HTML image loading, pair selection and overlay controls passed. An intentionally wrong expected Base SHA was rejected before capture. Local evidence is .layout-lab/comparison-skill-acceptance.json and .layout-lab/runtime/comparison-skill-verification.log in the lab repo. These files are optional local records. This run did not exercise desktop 3D exports, unequal viewport exports, Linux/macOS execution or a new native live-viewer handoff; those instructions are based on the current tool implementation.
