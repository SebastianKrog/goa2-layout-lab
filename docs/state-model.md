# State storage and contracts

See [terminology](terminology.md) for ownership and [Reviews](reviews.md) for frozen Runs.

## Records and ownership

Situations use schema **3**. Presentations, Layouts, Reviews and Review Runs use schema 2. Decision States and Review entries use their own schema 1.

```text
library/situations/<folder>/<id>.json
  schema: 3, kind: situation, id, name, description?, tags?, decisionStateId
library/decision-states/<hash>.json
  schema: 1, kind: decision-state, id: <hash>, checkpoint: {...}
library/presentations.json
  [{schema: 2, id, name, state: {schema: 2, sessionState: {pane: "hand"}}}]
library/layouts/<id>.json
  schema: 2, kind: layout, views: [...], synchronization: none|api|api-clicks
```

Local Situations and Decision States use corresponding `.layout-lab/` directories.
Local Presentation presets use `.layout-lab/presentation-templates.json`. Layout
customizations use `.layout-lab/layouts.json` and `.layout-lab/layouts/`.
Shared Situations reference only shared Decision States. Promotion copies exact state
and removes machine-specific metadata. Python owns serialization and checkpoint
hashing of durable Decision State records, including large integers. Bot-state
transport carries `checkpoint_json` and `result_json` as opaque strings through
Node, parsed only in Python. Device joins forward `checkpoint_json` to cloning;
current-state desk copies clone the exact stored Decision State reference.
Tags remain outside checkpoints; Decision State identity does not change when tagged.

A Review definition stores ordered `entries`:

```json
{
  "schema": 1,
  "kind": "review-entry",
  "id": "abcdefabcdefabcdefabcdef",
  "situationId": "e81bc3bd5fff",
  "viewpoint": "hero_arien",
  "presentation": {
    "schema": 2,
    "sessionState": { "inspectedCard": "noble_blade" }
  }
}
```

Reusable presets contain no Viewpoint, preferences, renderer, camera snapshot or game URL.
Card fields accept roles, e.g. `{role:"gold"}` and `{role:"upgrade",tier:2,branch:"A",color:"RED"}`.
Review entries and ad hoc requests may instead use an exact card ID. `publicSpells:true`
opens the current/sole caster's public-spell display. Unsupported or ambiguous changes
return View warnings, not a failed game load. Applying a preset preserves the existing
page, context and game. Reports keep full effective UI snapshots separately.

Presentation fields are optional. `presentationsByInterface` accepts `desktop` and
`mobile` keys; `viewPresentations` accepts slot indexes `0`–`2`. Each contains partial
Presentation values. Resolution merges common → interface → View instructions after
configured defaults/overrides. Reports retain requested and effective results.
Repeated Situation IDs are valid when using explicit entries; entry IDs are unique.

## API and CLI

- `POST /api/load {situationId,layoutId?,slots?,viewpoint?,presentation?,presentationsByInterface?,viewPresentations?}`.
  Omit Layout/slots to reuse running Views; an empty desk needs explicit configuration.
  Selecting a Situation never selects sources.
- `POST /api/save {index,name,kind?,tags?}` saves game state only.
- `POST /api/situation/compose {decisionStateId,name,tags?}` creates a named game moment.
- `POST /api/presentation/save {name,index?,field?,change?}` stores one explicit session change.
  `field` is `pane` (capture only the current panel), `gold`, `upgradeA`, `upgradeB` or `publicSpells`.
  `change` can supply role targets directly; `/api/presentation/apply {index,id}`
  applies one without resetting the game.
- `POST /api/layout/save {name,slots,synchronization?,tags?}` stores an arrangement.
- `GET /api/catalog` lists Situations, Decision States, Presentations, Layouts and primary Layout names.
- `POST /api/review-runs/start {entries,name?,layoutId?,slots?}` starts explicit inspections.
  `{ids}` remains a convenience for one default inspection per Situation.

```sh
node scripts/compare.mjs --situation=e81bc3bd5fff --layout="Desktop · Main vs working tree" --pane=hand --viewpoint=hero_arien --capture
```

`--presentation=file.json` supplies the common/interface/per-View instruction envelope.
Omit `--layout` to retain current Views. The command uses an already running local lab.

## Runtime identities and controllers

`syncGroup` links game clones, independently of saved Situation IDs. New comparison
loads and quickstarts get new groups. Add View copies the current group; a matching
device share joins it unless `independent:true` is requested. Review navigation
assigns desk and device Views the same Run-step group. These identities are not
portable library records or reporting Lab sessions.

Synchronization defaults to `api`. Bot policies saved in View settings are shared
across the group while synchronized; conflicts are rejected. In `none`, each View
has its own policy. The separate bot service computes one command per group decision;
the coordinator checks current group, policy and checkpoint hash before applying it.
It discards stale results and pauses automation during report picking/drafts.
The regular game backend does not run autonomous bot workers. See
[device and bot contracts](device-testing.md).

## Porting older situations

Runtime accepts schema-3 Situations only. Stop the lab before offline porting.
For the previous schema-2 library:

```sh
python scripts/port-independent-situations.py           # dry run
python scripts/port-independent-situations.py --apply
```

The port preserves exact Decision State files, consolidates equal-checkpoint Situation
variants, combines game tags, and extracts UI state into independent Presentation
presets. It removes generated game-specific suggested Layouts in favor of curated
primary Layouts. It does not create Reviews or Review entries. Historical Review definitions and report evidence are left untouched.
A separate local ID map supports explicit current-library reruns after consolidation.
Backups and the old-to-current ID mapping live under `.layout-lab/migrations/independent-*`.
Shared library references in agent commands should use the mapped Situation IDs.

The older `src/migrate_state.py` tool still supports offline import of pre-split
bundles, with dry run, `--apply` and `--rollback <transaction-id>`. It now emits one
independent Situation and separate Presentation presets rather than UI variants.
Factory helpers produce the same independent records through `portable_situation()`;
optional `presentationPresets` and `suggestedLayout` are import-envelope data only.

## Verification

`node --test test/inspection.test.mjs test/reviews.test.mjs test/desk-interface.test.mjs`
checks instruction precedence, repeated Situation inspections, frozen entries, clean
navigation and the Layout-first controls. `python -m pytest test -q` checks exact
checkpoint storage, porting/private-preset boundaries, imports and report persistence.

`node test/independent-comparison-e2e.mjs` uses an owned verification desk and real
frontends/backend to check desktop/mobile Hand intent, clean default reload and
Main vs working tree. Set distinct `GOA2_LAB_*_PORT` values and
`GOA2_LAB_DISPLAY=browser`; it closes its own services. Its desk screenshot is
`.layout-lab/independent-live-desktop.png`.
