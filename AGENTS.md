# Agent guide

This repository owns the GoA2 layout comparison tool and its shared situation library. Start with [README.md](README.md) for repository setup and operation. Follow the checked-out frontend's milestone/acceptance documentation when deciding what a UI change is expected to deliver.

## Use the repository skills

Load the appropriate SKILL.md explicitly from this checkout; agent/skills/ is the intentional repository location and may not be automatically discovered by an agent runtime.

| Task | Skill |
| --- | --- |
| Create, adapt, verify or organize a saved UI situation | [goa2-ui-situations](agent/skills/goa2-ui-situations/SKILL.md) |
| Compare revisions, create combined images/diffs/reports, or prepare a human viewer | [goa2-compare-views](agent/skills/goa2-compare-views/SKILL.md) |

The skills and their linked references own the workflow details. Use their instructions and bundled helpers rather than duplicating launch, API, capture or situation recipes here. For a task spanning both, prepare the situation first and pass it to the comparison workflow.

These repository copies are the versioned source for lab work. Edit them here when the tool changes; personally installed copies may lag. Resolve helper paths relative to the selected skill directory rather than assuming a user-specific installation path.

## Coordinate with the sibling repositories

- Before editing the backend, read its agent guidance: [goa2-backend/AGENTS.md](../goa2-backend/AGENTS.md) delegates to [CLAUDE.md](../goa2-backend/CLAUDE.md). Its [client integration guide](../goa2-backend/docs/CLIENT_INTEGRATION_GUIDE.md) owns the game-client contract.
- Before editing the frontend, read any AGENTS.md/CLAUDE.md present in that checkout and its [README](../goa2-frontend/README.md). For this migration, [MOBILE_UI_TODO.md](../goa2-frontend/MOBILE_UI_TODO.md) and [mobile integration notes](../goa2-frontend/docs/mobile-ui-integration.md) define milestone scope and acceptance.
- Keep lab orchestration, adapters, evidence and fixtures in this repository; product UI fixes belong in the frontend, and engine/protocol fixes belong in the backend. Follow the destination repository's instructions for those edits. This guide supplements their guidance; it does not replace their architecture or validation requirements.

The links assume the default sibling checkout layout. With configured checkout overrides, resolve the equivalent documents in those checkouts. Do not copy their instructions into this file.
