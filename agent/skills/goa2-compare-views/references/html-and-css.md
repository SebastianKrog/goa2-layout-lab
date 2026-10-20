# Paired HTML and CSS inspection

## Choose the export

Prepare the intended situation and presentation first, following the main skill.
Read `/api/status` and `/api/views`: record exact revisions, seat, viewport,
situation, state hashes, userscript activation and restore/render/asset warnings.
Use committed sources for commit evidence. Live sources are supported for active
development but are explicitly mutable. The source export command does not
reject every diagnostic or verify expected SHAs automatically; inspect these
before calling the results a valid comparison.

Default to **Element** mode with a narrow selector. Use **Full** or whole-document
**Active** only when explicitly requested or needed to answer a specific
whole-document question (for example, a global cascade audit or an unknown source
of document-wide styles). Do not collect them routinely for each situation or
alongside every screenshot. **Active** still traverses the full document and is
not a cheap fallback. Image-only comparisons need no CSS export.

| Mode      | Extracts                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `full`    | Rendered document HTML, all Chromium-exposed loaded stylesheets, computed values and matched rules for the main document. |
| `active`  | Computed values and matched rules for all main-document elements; document HTML omitted.                                  |
| `element` | Every CSS-selector match, its outer HTML, and computed/matched styles for its subtree.                                    |

In **Compare HTML & CSS** on the desk, select exactly two Capture checkboxes,
choose the mode, enter the selector for Element, and select **Extract two views**.
The selector is the same in both views. Standard CSS selector lists can cover
source-specific markup, but check that each branch identifies equivalent content.
A missing match in either view or an invalid selector fails explicitly.

Element extraction includes hidden/offscreen DOM matches and descendants. It
deduplicates overlapping subtrees in the per-element style list; a matching
ancestor's outer HTML still contains matching descendants. This differs from
image crops, which select only matches intersecting the visible viewport. Use a
more specific selector when hidden duplicates make the source review confusing.
Do not use Playwright-only `:visible` syntax; these are browser CSS selectors.

## Keep routine reviews focused

Choose Element mode when investigating a particular card/control. Full and Active
traverse every element and collect the complete browser matched-rule data; they
remain substantially slower. Selector-focused export is the intended fast path,
not a different or reduced set of properties for the selected subtree. Export
once and reuse its offline viewer while explaining the result. New interactions
or style changes require a fresh snapshot; there is no stale cross-export cache.

Large machine JSON files are written compactly. Per-element values, stylesheet
texts and matched-definition references are retained; the viewer formats JSON
for inspection. Source report schema 3 avoids duplicating computed CSS inside
`comparison.json` and its embedded viewer. The `.active.json` matched-definition
format remains schema 2.

## Export a portable folder

From the lab root, against an already-prepared desk:

```sh
npm run extract -- --origin=http://127.0.0.1:3300 --indexes=1,2 --mode=element --selector=".your-control" --out=./new-element-review
```

Only when whole-document collection is needed:

```sh
npm run extract -- --origin=http://127.0.0.1:3300 --indexes=1,2 --mode=full --out=./new-full-review
npm run extract -- --origin=http://127.0.0.1:3300 --indexes=1,2 --mode=active --out=./new-active-review
```

Arguments use `--key=value`. Indexes are zero-based and must name two distinct
open views; `1,2` selects Current build and Target in the default three-view setup.
The destination must be new. Without `--out`, the report stays under ignored
`.layout-lab/reports/source-<id>/`. The helper needs only Node built-ins and the
running local desk; it does not launch services, load/reset situations, advance
the game or close the viewer.

The public API equivalent is:

```javascript
await request("extract", {
  indexes: [1, 2],
  mode: "element",
  selector: ".your-control",
});
// -> {id, url: "/reports/source-<id>/index.html", diverged}
```

Use the request helper from setup-and-viewer.md. `full` and `active` ignore the
selector field. Source exports are read-only; a detected structural DOM change
or game-state change during extraction requires retrying a stable view. Animated
values are sampled rather than frozen, and the two views aren't captured at one
atomic browser instant.

## Read the result

- `index.html`: offline side-by-side viewer; switch among HTML, Loaded CSS,
  Computed CSS and Matched rules/inheritance. Markup is displayed as text and its
  scripts are not executed. Copy the entire folder for a portable export.
- `comparison.json`: schema 3 source/configuration metadata, state hashes, viewport,
  userscript activation, diagnostics, full stylesheet texts/IDs and per-element
  style data. Check `diverged`, `mutable`, snapshot warnings, errors and assets.
- `view-N.html.txt`: rendered document or matching element HTML (full/element).
- `view-N.computed.css`: linked by each view's `computedCSSFile` (rather than
  duplicating the full text in schema 3 JSON). The offline viewer reconstructs
  its computed-CSS display from the element values. Resolved values use structural CSS paths,
  including generated pseudo-elements. This is a diagnostic snapshot, not the
  original authored CSS or a portable component stylesheet.
- `view-N.active.json`: schema 2 object containing `elements` and
  `matchedDefinitions`. Elements retain computed/pseudo-element values. Repeated
  matched-rule, inline-style and inheritance structures use `{$ref:"matched-N"}`
  references into that same view's definition table. Resolve references recursively
  (the module exports `expandMatched`) instead of treating a reference as an empty
  declaration. CDP stylesheet IDs relate rules to source sheets in `comparison.json`.
  Deduplication retains all protocol data without repeating ancestor rule trees for
  every child. The viewer offers **Matched rule definitions** beside the per-element
  references.
- `view-N.sheet-M.css`: individual loaded stylesheets in Full mode, including
  imported/dynamically injected sources exposed by Chromium. Inline element
  styles remain in HTML and matched data.
- `changes.json`: computed-property changes aligned by structural DOM paths.
  Different layouts can have unrelated elements at the same path or no matching
  path; this is not automatic component/semantic matching.

N is the original one-based desk view number: indexes `[1,2]` produce `view-2.*`
and `view-3.*`, not `view-1.*` and `view-2.*`.

“Active” means the resolved values and matched declarations at capture time,
including inherited values and CSS variables. Raw matched rules can contain
losing declarations and conditional/layer information. Use computed values for
the resulting property; inspect rule metadata/source text to explain it. Do not
claim every matched declaration wins the cascade.

Check the source export against an actual element crop. Different computed
values can produce the same visible result, and identical computed values do
not establish identical layout context, art, canvas pixels or behavior. Crops
retain the real parent layout and occluding content; this tool does not rebuild
a standalone rendered element from extracted HTML/CSS.

Current scope is main-document light DOM. Child frames and open shadow roots
are flagged as excluded. Inspect stylesheet-read warnings before describing an
export as complete. Do not promise original repository source files: the HTML
is rendered DOM and CSS is what the browser loaded, with source URLs when known.

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
