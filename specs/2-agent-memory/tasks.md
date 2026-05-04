| Item    | Link                                 |
|---------|--------------------------------------|
| Plan    | [plan.md](plan.md)                   |
| Spec    | [spec.md](spec.md)                   |
| Created | 2026-03-29                           |
| Updated | 2026-05-04 (ADR-017 added for architectural decisions) |

> **Reconciliation note (2026-04-20):** This file was 100% divergent from
> the shipped implementation. Original tasks were restructured to reflect
> what was actually built. Deferred items are marked. Unplanned features
> added during implementation are listed in Phase 12.
>
> **Architecture decisions (2026-05-04):** The decisions behind the
> implementation divergence — PostgreSQL-native store, episode-first
> model, not exposing `shared_write`/`shared_read`/snapshot tools as
> MCP tools, knowledge graph via PostgreSQL — are captured in
> [ADR-017](../../adrs/ADR-017-agent-memory-architecture.md).

## User Story Map