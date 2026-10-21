# Configurable GoA2 comparison tool

Status: implemented locally in [`goa2-layout-lab`](../../README.md). Run `npm run compare`; this document records the agreed design and pinned references.

## Summary

Implement a reusable development tool in **`goa2-layout-lab`**, a standalone sibling repository, launched with **`npm run compare`** or **“GoA2: Open comparison desk”** in VS Code.

Support **one, two or three independently configurable windows**. Each window chooses:

- Source: pinned Base, Comparator (the newest `mobile-migration` commit by default), or pinned Base + userscript. An explicit live-working-tree mode enables hot reload during implementation.
- View: 2D or 3D.
- Device: phone portrait, phone landscape, or desktop.
- Viewpoint: any player seat or spectator.
- Saved UI and camera position.

Allow duplicate sources—for example, two Comparator desktop 3D windows showing different players or camera angles. The userscript option is available only with 2D.

Use dev dependencies for browser automation and image comparison; keep generated references, situations, dependencies, and screenshots ignored. Commit and push only work explicitly authorized by the user; keep the existing local WSL setup and unrelated changes out of migration commits.

## Comparison desk and runtime

Provide three initial presets:

| Preset            | Windows                                         |
| ----------------- | ----------------------------------------------- |
| Mobile migration  | Base / Comparator / Base + userscript, phone 2D |
| Layout regression | Base / Comparator, desktop 2D                   |
| 3D regression     | Base / Comparator, desktop 3D                   |

Users can edit each window's configuration and save named presets. Default desktop viewport: **1440×900**; phone profiles: **390×844**, **844×390**, and **360×800**.

The desk has **Compare**, **Situations**, and **Settings** tabs, a compact toolbar, and one, two or three playable views. The default Electron app embeds native WebContentsViews with isolated storage and fixed device viewports. Games animate and accept input directly in Chromium. Fit/100%/Expand change display scale while retaining the emulated viewport. Edit view holds device, renderer, source and seat settings; View tools holds panel, rotation, reset and camera controls. Dialogs hide native surfaces. Optional browser/headless mode uses JPEG streaming for static layout work; separate windows remain available through `--display=windows`.

Runtime:

- Run the complete tool natively on Linux/macOS, including inside WSL. Resolve Node/npm/uv through PATH; use an isolated backend environment and platform-specific frontend caches.
- On Windows, run Chromium/the desk locally and services in WSL. WSL callers can explicitly select this split mode with `--runtime=wsl`; it is optional on Linux/macOS.
- Use dedicated ports: Comparator **3100**, Base **3101**, backend **8100**, dashboard **3200**.
- Preserve normal development on ports 3000/8000.
- Launch only the sources required by the selected preset.
- Give every window a separate browser context and game clone. This permits identical player seats without connection replacement or preference leakage.
- Report occupied ports clearly; stop only processes owned by this tool.

Use a separate tooling package and lockfile at the standalone repository root, with Electron, Playwright, `ws`, `pixelmatch`, and `pngjs` as dev dependencies. Keep tooling dependencies separate from the frontend's dependencies and install Chromium for the driver host's platform.

## References and playable situations

The **Base** is the frontend mainline at the start of migration: **`a3c5e0a46b35a42cd6e054512ce3dbc6a61a579c`**. The actual mainline branch is named `master`, not `main`; both `SebastianKrog/goa2-frontend` and `PedroVIOliv/goa2-frontend` pointed to this revision when verified on 2026-10-17. Freeze that revision rather than following subsequent mainline commits.

The **Target** is that exact Base plus the current userscript, pinned to **`ad1eed5427b91b8daaebb56c4ceafda01db5f7de`** (v1.3.0). Record the built bundle checksum. Frozen refs are set at launch through `--base-ref` / `--script-ref` or `GOA2_LAB_BASE_REF` / `GOA2_LAB_SCRIPT_REF`, optionally in a local `--env-file`. Show them read-only in Settings; changing them requires restarting the desk. Comparator defaults, initial preset, runtime, paths and ports are also launcher settings. See the tool README and env example.

The **first Comparator** is the M0/M1 work transplanted from `goa2-frontend-portfolio`: source commits `4ba668e01282c6d299a5059869dbabacc0d404e2` (M1 shell) and `a973ade16d3c408e9b3aa5fefaf0e951c6625117` (M0 controller), plus integration fixes preserving the Base's board preferences. Open this comparator with `ui=mobile&3d=0` for mobile comparisons. Base and Target use `3d=0` without `ui=mobile`; the Target additionally receives the pinned script. Desktop comparisons explicitly select `ui=desktop&3d=0` or `ui=desktop&3d=1` on the Comparator.

Default Comparator selection is the newest local commit on **`mobile-migration`**. Resolve it to an exact SHA at launch or **Refresh comparator**, display it in the desk, and record it in screenshots and exports. New commits must not silently replace a comparator within an existing comparison session. Allow selecting an older commit to revisit earlier milestones. Uncommitted edits are excluded from this default; explicit **Live working tree** mode uses current files with hot reload and marks reports as dirty when appropriate.

Extract committed references and comparators into an ignored cache rather than switching the working branch. Base and Target use identical frontend source; only Target receives the userscript.

A situation contains:

- Complete engine state, rollback state, hero names, and available replay history.
- Backend revision and source provenance.
- A readable description of the pending decision.
- Named presentation viewpoints: player/spectator seat, device, rendering mode, preferences, open UI, inspected card/hero, scroll positions, and camera.
- Per-window presentation overrides where versions differ.

Creation paths:

1. Capture the current moment from any lab window.
2. Import an existing local backend save.
3. Import a local replay at a selected decision index using existing replay reconstruction.

Loading creates one independent playable game per window, with fresh IDs and seat tokens. All use the normal game page and existing player-scoped APIs. Source-game credentials are excluded from exported situations.

Game decisions remain independent. Reset closes the affected connection, replaces its clone, restores its saved presentation, and reconnects. Other windows remain untouched.

Provide an initial planning situation with Arien/Hanu versus Brogan/Tigerclaw. Additional situations are captured through play, existing overrides, or replay imports; a dedicated state editor is excluded.

## Presentation, cameras, and clocks

Use version-specific presentation adapters with explicit readiness checks and restoration errors. Restore UI through normal controls; do not copy DOM or rely on recorded screen coordinates.

- **2D:** save board-space focus, zoom, and supported rotation.
- **3D:** save camera position, OrbitControls target, up vector, FOV, and zoom. Restore after map framing and models initialize, settle damping, and verify the resulting camera.
- Supply a lab-only Vite instrumentation plugin that exposes camera capture/restore through the existing camera controls. Apply it consistently to cached references and the Comparator; production builds receive no bridge.
- Preserve full 3D layout preferences, including player-board arrangement and model choices.
- Mark unsupported presentation features explicitly. Do not invent equivalent controls in the reference layout.
- Switching between 2D and 3D uses that mode's saved viewpoint, or its normal initial camera if none exists.

Support timed matches with game time **frozen by default**:

- Keep the backend helper inside the frontend tool package, importing the sibling backend's existing engine and application.
- Install clock virtualization before application imports and suppress automatic deadline scheduling in that dedicated process.
- Rebase restored clock timestamps while preserving remaining allowances and clock status.
- Fix browser wall time consistently while preserving networking, animation frames, and ordinary UI timers.
- Settle live clocks at capture time. Label replay-derived clock values as reconstructed when exact historical timing is unavailable.

The helper adds lab-only capture/import/load/reset operations. Normal backend startup and production APIs remain unchanged.

## Screenshots and verification

Capture selected windows after fonts, artwork, models, camera motion, and layout settle. Produce a report with side-by-side images, selectable pairwise overlays/diffs, and situation/seat/device/revision labels.

For different viewport sizes, retain original dimensions; disable pixel overlays until dimensions match. For intentionally different seats or cameras, identify those differences in the report. Detect and label independently diverged game states.

Acceptance checks:

- Two-window operation requires neither a third browser context nor the userscript.
- Two desktop 2D and two desktop 3D comparisons work, including duplicate sources and different seats/cameras.
- Three-way mobile comparison remains available.
- Player privacy, pending decisions, rollback, and independent play survive load/reset.
- Saved 2D and 3D viewpoints restore accurately; camera copying does not submit game actions.
- The default Comparator resolves to the newest `mobile-migration` commit at launch/refresh; older comparator commits remain selectable and Base/Target stay pinned.
- Explicit Live working tree mode hot-reloads without changing Base/Target, and reports identify uncommitted edits.
- Userscript activation works on phone portrait/landscape and is excluded from 3D.
- Timed situations remain stable after real time passes.
- Screenshot capture reports missing assets, WebGL failures, or failed restoration rather than accepting incomplete views.
- Situation and preset export/import survive restart; incompatible saves fail clearly.
- Existing frontend/backend tests pass, and normal development launch behavior remains intact.
- Only authorized migration changes are staged or committed; local WSL setup and unrelated changes remain excluded.
