# Captures and source inspection

[Back to the lab overview](../README.md) · [Element reports](element-reporting.md)

## Capture and adjust

Select one or more views with **Capture** checked, then **Capture**. A single
view produces an original screenshot and reproduction metadata without pairwise
diffs. With multiple views, the report contains original viewport screenshots,
a full-size strip, selectable pairwise overlays, pixel differences and reproduction metadata.
Different-size captures retain original dimensions and disable overlays. Reports
label different seats/cameras and independently diverged game states.

Captures wait for the actual game, camera, fonts, model/artwork requests and a
stable rendered image. Missing assets, a lost WebGL context, page exceptions or
failed viewpoint restoration are surfaced rather than silently accepted.
Restoration warnings are visible in the desk and included in metadata.

Reports are stored under `.layout-lab/reports` and can be reopened through their
desk URLs. Pixel differences are an inspection aid, not automatic layout parity
pass/fail tests.

### Crop captures to elements

Open **Workspace tools → Crop screenshots**, enable cropping, enter a CSS
selector, then use **Capture selected Views**. The toolbar shows **Capture crop**
while cropping is enabled. The same selector and match policy
are applied independently to every selected view (one, two or three).

- **Require one visible match** (default): exactly one match must have a visible
  area in the current viewport. Multiple matches fail instead of choosing one.
- **Specific visible occurrence**: select a one-based occurrence in DOM order
  among visible matches. An out-of-range occurrence fails. Numbering is not visual
  left-to-right order and does not guarantee the same semantic item across layouts.
- **All visible matches**: capture the bounding rectangle of all visible matches.
  This includes gaps and any other content within that rectangle.
- **Individual**: save one image per visible match, numbered in DOM order.
  Each view's occurrence 1 is compared with occurrence 1 in other views, and so
  on. Unmatched extra occurrences remain available as individual images.
- **Combine**: save those same individual images plus a horizontal strip per view,
  in DOM order without resizing or the original viewport gaps. Shorter crops leave
  transparent space below them. Different match counts disable the strip's diff.

Hidden, transparent, zero-area, fully clipped and offscreen matches are ignored.
No remaining visible matches in any selected view fails the capture. Partial
matches are clipped to the viewport and rectangular ancestor scroll/overflow
bounds. The page is not scrolled, resized or restyled. These are actual screenshot
pixels: overlapping content stays visible, occlusion is not used to exclude
matches, and shadows/pseudo-elements extending outside the element box are not
included. Complex transforms, rounded clipping and clip paths retain their
painted appearance inside the rectangular crop; they are not shape masks.
Selectors inspect the main document's light DOM.

Reports include the selector, matching policy, match counts, selected DOM
occurrences, CSS bounds and screenshot pixel bounds. Crops retain device scale
and are never stretched; unequal crop sizes disable that pair's diff/overlay.
The original capture files in a cropped report are the cropped images; turn the
option off for full viewport evidence. Game and presentation metadata remain.

API: `POST /api/capture {indexes:[0,1],crop:{selector:".card",match:"nth",occurrence:2}}`.
Omit `crop` for full viewport captures. The portable comparison helper accepts
`--selector ".card" --match nth --occurrence 2`; `--match unique` is the default,
and `--match union` selects the combined rectangle. Use `--match individual` or
`--match combine` for separate crops or their compact strip. Individual files are
`window-N-match-M.png` (view N, visible occurrence M); Combine additionally writes
`window-N.png`. The report/export helper includes every individual image.

## Compare rendered HTML and CSS

Prepare a comparison normally, then open **Workspace tools → Compare HTML & CSS**.
Select two Views with **Include Views** in the dialog (or the Capture checkboxes
on the Views) and choose:

Start with **Element HTML + active CSS** and a narrow selector for routine styling
reviews. Use full-page **Full** or **Active** only when explicitly needed for a
whole-document investigation. Both collect styles for every element; Active is
not a lightweight shortcut. Skip CSS collection for image-only comparisons.

- **Full HTML + CSS**: the rendered document and every stylesheet exposed by
  Chromium, including imported sheets, inline stylesheets and injected userscript
  styles. Inline element styles remain in the HTML and matched declarations.
- **Active CSS**: resolved computed properties for every element in the document,
  plus Chromium's matched rules, inline declarations, inheritance, pseudo-element
  rules, cascade layers and conditional-rule metadata.
- **Element HTML + active CSS**: enter a standard CSS selector. Every matching
  element and its descendants are included in both views. A missing or invalid
  selector fails explicitly, rather than returning an empty comparison.

This reads the already-open views without reloading or advancing their games.
Open the resulting side-by-side source viewer to switch between HTML, loaded CSS,
computed CSS and matched rules. The viewer displays markup as text; it does not
execute exported scripts. It works offline when the entire report folder is copied.

For agents or terminal use:

```sh
npm run extract -- --indexes=1,2 --mode=element --selector="[data-pane='hand']" --out=./hand-review
```

For a whole-document investigation when needed:

```sh
npm run extract -- --indexes=0,1 --mode=full --out=./html-css-review
npm run extract -- --indexes=0,1 --mode=active --out=./active-css-review
```

Use `--origin=http://127.0.0.1:3200` to select another running desk. The output
folder must be new. Omit `--out` to retain the export only under
`.layout-lab/reports/source-<id>/`. The API equivalent is
`POST /api/extract {indexes:[0,1],mode:"element",selector:".your-selector"}`;
indexes are zero-based, with exactly two distinct open views.

`comparison.json` (schema 3) records revisions, source configuration, viewport
dimensions, userscript activation, game-state hashes, diagnostics and the full
extraction. Each view's `computedCSSFile` links to its standalone computed CSS;
the viewer reconstructs that display on demand rather than embedding duplicate
CSS text. Machine JSON is compact; no computed properties or matched declarations
are omitted.
`view-N.html.txt` contains inert HTML (full/element modes), `view-N.computed.css`
contains resolved values, and `view-N.active.json` contains per-element computed
values and matched-rule information. Large repeated protocol structures use
`{$ref:"matched-N"}` entries, resolved through that view's `matchedDefinitions`
table (schema 2). The viewer has a **Matched rule definitions** tab. Full mode also exports individual
`view-N.sheet-M.css` files; their source URLs and sheet IDs are in the JSON.
`changes.json` lists computed-property changes aligned by structural CSS paths.
These paths describe DOM positions, so different component trees need human
interpretation rather than automatic semantic matching.

“Active” describes the current viewport and interaction state, including hidden
DOM elements; it is not just CSS for pixels currently on screen. Computed values
are the resolved result. Matched rules also contain overridden declarations and
conditional metadata, and must not all be interpreted as winning declarations.
Animations/transitions are sampled, not frozen; HTML/CSS cannot reproduce canvas
or WebGL pixels. Extraction currently covers the main document's light DOM;
child frames and open shadow roots are flagged instead of silently claimed as
captured. A game-state change or detected structural DOM change during extraction
requires a retry. Live sources are labelled mutable. No platform services or
browser sessions are started by the extraction command.

### Verify element capture and CSS extraction

`npm run test:element-tools` starts an isolated headless browser desk on ports
5700–5703/10700 and tests the shared card-selection, action-choice and discard
situations against committed Comparator and the userscript Target. It exports
Individual/Combine images, checks portable offline viewers, tests selector failures
and Nth/Union crops, and exports full/active/element HTML/CSS. It checks game hashes
remain unchanged and closes only its own services. Reports and a verification
manifest stay under `.layout-lab/reviews/element-tools-<timestamp>/`.
Use `npm run test:element-tools -- --case=discard-card` for a focused rerun.
Full/active source exports traverse the complete document and can take substantially
longer and produce larger files than selector-focused exports.

### Collect mobile HTML/CSS review evidence

`npm run test:mobile-elements` collects paired viewport images and selector-focused
HTML/CSS exports for the committed Comparator's native mobile UI and the pinned
Base + userscript Target. It uses shared situations and checks that both clones
start with equal game hashes and remain unchanged by presentation collection.
The userscript is a comparison reference; assess either implementation against
intended behavior rather than assuming the Target is correct.

The cases cover shell/pane frames, clock/setup/connection states, selected Hand
cards, action/defense/discard/upgrade/spell/rune/team choices, hero/Board states,
public spell counts and privacy viewpoints, nested readers, and Arien/Gydion
Tree/List/Grid with color-sorted plans and Large/Image previews. Default sizes
are 390×844, 360×800 and 844×390. This collects M1–M4 review evidence; complete
milestone acceptance and pixel equality are separate questions.

```bash
npm run test:mobile-elements -- --case=m2-defense,m4-arien
```

`--case=` accepts comma-separated case-name prefixes. Use `--profile=landscape`
or a comma-separated subset of `portrait,compact,landscape` for a focused rerun;
omitting it collects all three. The runner uses isolated
ports 5900–5903 and backend port 10900 by default; the corresponding
`GOA2_LAB_*_PORT` environment variables can override them. Other checkout/ref
settings come from the normal launcher configuration. It starts a headless
browser desk and closes its owned services after collection.

The local `.layout-lab/reviews/m1-m4-elements-<timestamp>/evidence.json` records
revisions, situations, hashes, selectors, observations, diagnostics and report
references. Images and HTML/CSS viewers are under `.layout-lab/reports/`.
Inspect the exported images and styles together. Collection errors are recorded
per case/viewport and must be checked even when the process exits successfully;
missing selectors are collection gaps, not evidence of a product defect.
Short-landscape decision cases also record scrolling/trial-tap reachability without
submitting choices. Obstructed centers retain hit-test geometry and a screenshot;
these findings do not automatically fail the evidence collector. Offscreen
controls need this reachability check before being called inaccessible. Manifests
include the executing lab HEAD/dirty state and runner SHA-256 alongside source
revisions. Generated artifacts remain local and ignored by Git.

### Loading and capture performance

Situation loads fetch just the selected checkpoint and cache parsed situation
files with filesystem-change invalidation. Restarting the lab clears these
in-memory caches. File edits, moves, additions and deletions remain visible without
a restart. Game clones receive isolated copies of cached checkpoints.

Browser captures settle independent views concurrently; native embedded capture
keeps its required serialization. New situations still open fresh game views and
wait for their game state, camera, fonts and assets. The first load also starts and
prepares its required frontend services, so it can take longer than later loads.

For routine work, keep the desk running, use selector-focused CSS exports, and
reuse the exported offline viewer while reviewing the same snapshot. Collect a
new export after relevant UI, state or stylesheet changes.
