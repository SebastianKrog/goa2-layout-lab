# Detached bot decisions — 2026-10-22

Views use the regular game backend. A separate, lazily started bot service reads
transient checkpoints and returns one command per decision. It uses the maintained
bots checkout, its own port/environment/cache, default classic search settings,
and no learned models. Live clones never start autonomous bot workers.

API synchronization is the default. Human and bot commands use normal game
handlers across the game group. Linked devices join current progress; fresh
sessions have distinct group IDs even when they reuse a Situation. UI state and
camera remain independent. None mode explicitly permits independent play.
State/controller changes invalidate in-flight decisions before application.

The local environment now selects the regular backend with `GOA2_LAB_BACKEND`
and the separate policy checkout with `GOA2_LAB_BOT_BACKEND`. Restart an existing
desk to load this configuration; running human games were not interrupted.
Neither frontend nor production-backend source was modified for this refactor.

## Verification

- Full Node suite: 103 passed, 1 skipped (104 total).
- Full Python suite in the bots environment: 52 passed and 32 subtests passed.
- Regular backend integration separately: 22 passed without importing bot agents.
- Worker policies: Random, Simple and default ISMCTS, with neural/training imports
  blocked; checkpoint immutability, direct/team input and human-team precedence.
- Coordinator: one computation across desk/device Views, stale/controller-change
  rejection, manual-state caching, report deferral and separate play sessions.
- Device actions remain restricted to their selected hero and supported commands.
- Native smoke: separate-window controls, isolation, input, animation, capture,
  resizing, replacement and return-to-lab passed.
- Real integration: two normal-backend Views shared exactly two bot commits from
  one separate bot service; View B's human move reached both; a phone-sized
  browser joined current progress and its human move reached all three clones.
- Diff whitespace check passed. An intermittent Windows cache-directory rename
  failure passed on isolated rerun and the final full Node run.

Real tests owned ports 3277/8177, bot service 8178, frontend ports 3177–3180 and
device gateway 3377, and closed those services afterward. Phone checks used
browser emulation, not a physical phone or a full-match acceptance run.

Commands and configuration are described in [testing](../testing.md) and
[device setup](../device-testing.md). The dedicated real check is
`node test/detached-bots-e2e.mjs`.
