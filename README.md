# GoA2 Layout Lab

**Released: 1.0 · In development: 1.0.1** · [Changelog](CHANGELOG.md)

A local workspace for comparing Guards of Atlantis II interfaces, reproducing
game moments, and collecting useful reports. Start with a bot quickstart or choose
a comparison Layout and Situation. No Views open until you choose.

![The lab showing Board and Hand views of the same game moment](docs/assets/interface.png)

_Captured 2026-10-22: two phone Views in browser mode, after loading a Situation._

## What you can do

- Compare live edits, pinned frontend commits, and a userscript reference in 2D or 3D.
- Reuse game-only Situations across Layouts, with optional Presentation presets for menus, card roles and public spells.
- Open a Situation on a physical device using a link or QR code, and play against Random, Simple, or ISMCTS bots.
- Inspect a queue of Situations, report elements across Views, and collect screenshots, HTML/CSS, comments, and revision evidence.

## Start

Keep the frontend and backend checkouts alongside this repository:

```text
GitHub/
  goa2-layout-lab/
  goa2-frontend/
  goa2-backend/
  goa2-backend-bots/     # optional separate bot decision service
  goa2-mobile-2d-patch/   # optional userscript comparison
```

Install Node.js 22.12+, Git, and uv. Windows also needs WSL with Node/npm/uv;
Linux and macOS run natively. Prepare the frontend's model assets with
`npm run models:prepare` if needed.

From this repository:

```sh
npm run compare
```

The launcher installs lab dependencies on first use and opens the native desk.
The desk is served at **http://localhost:3200**. Game services are isolated from
your regular development servers.

1. Pick a working-tree **2v2 quickstart** (Desktop, Mobile portrait or Device), or a **main vs working tree** comparison (two desktop, portrait or landscape Views). Comparisons ask for a **Situation** before loading; Presentation is optional.
   Quickstarts put ISMCTS bots on the blue team and autoswitch between your red-team heroes. Bots use a separate decision-service checkout; Views keep the regular backend. Device opens a link and QR code.
2. Use **Add view** to copy the current moment into another View. Game actions synchronize by default; menus and cameras stay independent.
3. Use **Save…** to save a Situation or Layout, **Report element** to flag a
   problem, or **Capture** to export images.
4. For a sequence, select Situations and press **Start review**. Previous/Next
   restores every View together; reports collect under that Run.

Use **Open on device** for the phone link and QR code. Use **Stop desk** or
`npm run compare -- --stop` to close the lab and its owned services.

See [setup and runtime](docs/setup.md) for platform requirements, checkout
overrides, launcher options, caching, and troubleshooting.

## How the pieces fit

A **Situation** names an exact **Decision State**, independent of the interface.
A **Layout** chooses configured **Views**. Optional **Presentation** instructions
change menus and card selections; Viewpoint is configured separately. A **Review entry** combines a Situation
with those instructions; each **Review Run** freezes the inputs and collects reports.

```mermaid
flowchart LR
  Layout --> Views
  Situation --> Views
  Presentation[Optional Presentation] --> Views
  Entry[Review entry] --> Situation
  Entry --> Presentation
```

See [precise definitions and resolution rules](docs/terminology.md).

## Guides

| Task                                                     | Guide                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Install, configure, or troubleshoot                      | [Setup and runtime](docs/setup.md)                                              |
| Choose sources, arrange Views, save moments, synchronize | [Workspace](docs/workspace.md)                                                  |
| Export screenshots, crops, diffs, or HTML/CSS            | [Captures and source inspection](docs/captures.md)                              |
| Test on a phone or play against bots                     | [Devices and bots](docs/device-testing.md)                                      |
| Report an element across Views                           | [Element reports](docs/element-reporting.md)                                    |
| Browse reports, organize archives and reporting sessions | [Reports and activity groups](docs/reports.md)                                  |
| Inspect queues and rerun earlier reviews                 | [Reviews and evidence](docs/reviews.md)                                         |
| Understand saved state or port old Situations            | [Terminology](docs/terminology.md) · [Storage and porting](docs/state-model.md) |
| Tag and filter Situations                                | [Tags](docs/tags.md)                                                            |
| Browse the shared fixtures                               | [Situation library](library/README.md)                                          |

## Development

```sh
npm test
```

See [testing](docs/testing.md) for browser/native acceptance checks,
[AGENTS.md](AGENTS.md) for repository skills, and
[plans](docs/plans/README.md) for design records and remaining work.

See the [changelog](CHANGELOG.md) for released and unreleased changes, and the
[release workflow](docs/releases.md) for versioning.
