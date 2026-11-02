# Quickstarts and default Layouts — 2026-10-22

Historical acceptance of the initial implementation: Simple opponents and the
then-current bot backend. Current quickstarts use ISMCTS through a separate decision
service; see [terminology](../terminology.md) and the
[later bot validation](detached-bots-2026-10-22.md). The results below do not
establish a fresh end-to-end acceptance of the later ISMCTS quickstart default.

The empty desk opens no Views. It offers working-tree Desktop, Mobile portrait
and Device 2v2 quickstarts, plus Main-versus-working-tree comparisons in desktop,
portrait and landscape profiles. Comparison shortcuts require a Situation before
loading. Custom View setup remains under Other Layouts.

Quickstarts clone the shared opening without adding Situation drafts. RED remains
manual, BLUE uses Simple bots, and autoswitch follows only manual responders.
Device starts a share and QR without reserving a desk View; report drafts defer
seat changes. The existing backend bot runtime is unchanged.

## Verification

- Full Node suite: 96 passed, 1 skipped (97 total).
- Focused orchestration/URL/Presentation checks after the Main fallback: 24 passed.
- Native smoke: separate-window controls, input, storage isolation, animation,
  resizing, capture, replacement and return-to-lab passed.
- Real Desktop, mobile portrait and device quickstarts passed against the bots
  backend. A QA commit switched Arien to Hanu on the same game; bot seats remained
  excluded. Device generated a QR and did not create a desk View or Situation draft.
- All three real Main-versus-working-tree comparisons passed. Main currently lacks
  the native mobile shell: mobile comparisons keep its requested phone viewport,
  use its desktop interface and show a warning. Effective settings/evidence record it.
- Inspected the connected empty start screen visually; no placeholder View or
  Add View column is reserved there.
- Diff whitespace check passed.

The real checks used owned test services on ports 3277/8177/3177–3180 and device
port 3377, and closed those services afterward. Device checks used a phone-sized
browser, not a physical phone. A repeat of the device check encountered Windows
`ERR_NO_BUFFER_SPACE`; the earlier complete device run passed, and the subsequent
focused real comparison run passed all three Layouts.

Commands: `node --test test/*.test.mjs`, `node test/native-views.mjs`,
`node test/quickstarts-e2e.mjs` and its `--comparisons-only` option. See
[testing](../testing.md) for isolated-service requirements.
