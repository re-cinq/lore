---
adr_number: 38
title: "Team-schema resolution for every repo-scoped chunk read"
status: accepted
date: 2026-07-29
domains: [context, ingestion, db, floor]
---

# ADR-038: Team-schema resolution for every repo-scoped chunk read

Every read of `chunks` that is scoped to one repo must resolve that repo's
schema by the same rule the write path uses — team schema when provisioned,
`org_shared` otherwise — and every read that enumerates repos must span all
provisioned chunk schemas. Legacy rows stranded in `org_shared` by the write
path's earlier move are relocated once, by migration, after the last hardcoded
reader is gone.

## Context

The vector store is schema-per-team by design: each team's chunks live in that
team's Postgres schema, with `org_shared` for repos that have no provisioned
team schema. The **write** path has honored this since reindex learned to
resolve a repo's schema (`lore.repos.team` when the schema exists, else
`org_shared`). The **read** paths did not move with it. They were written when
`org_shared` was the only table, and a family of them kept the literal:

- gap-detect's `hasChunk` / `staleChunkCount` — fixed by #975 (`fd92a791`),
  which introduced `PgChunks.resolveSchemaForRepo` as the read-side twin of the
  reindex rule.
- spec-drift's `specChunks` / `codeSymbols` in the same `PgChunks` class —
  issue #976.
- the detect fan-out's target enumeration (`ACTIVE_SPEC_REPOS_SQL` /
  `SPEC_REPOS_SQL` in `apps/floor/src/jobs/detect/fan-out.ts`) — issue #977.
- context assembly's hybrid retrieval, rules, and cross-repo reads
  (`libs/shared/src/project/knowledge/context-assembly.ts`), server-core's
  context/ADR/PR-history reads (`libs/server-core/src/platform/db.ts`), the
  lore-api context route, and feature-request's spec lookup — discovered while
  planning #979; tracked as the reader-repoint follow-up.

The failure modes were not hypothetical. A team-schema repo was invisible to
the weekly detection fan-out (its assembly lines were simply never started),
spec-drift saw empty spec and symbol sets and produced bogus drift verdicts,
and the stale-chunk counter read a table the repo no longer wrote to — the
class of bug #967 first surfaced. Meanwhile the rows those readers *did* find
in `org_shared` were the pre-move leftovers: seed-scope files duplicated
(fresh copy in the team schema, stale copy in `org_shared`), everything else
existing only in `org_shared`, invisible to the verification sweep the
[ADR-019 2026-07 amendment](./ADR-019-scheduled-job-runtime-split.md)
introduced, never re-stamped and never pruned.

## Decision

1. **Repo-scoped reads resolve the repo's schema.** Any chunk read that takes
   a repo resolves it exactly as the write path does — team schema when
   provisioned, `org_shared` as fallback — via `resolveSchemaForRepo` in
   `PgChunks` or a per-module equivalent gated on the same schema-name regex.
   The fallback is never dropped: a repo without a provisioned team schema
   still reads `org_shared`.
2. **Enumerating reads span all chunk schemas.** Reads that ask "which repos"
   rather than "this repo" (detect fan-out, cross-repo context) build a
   `UNION ALL` over every provisioned chunk schema plus `org_shared`, the
   schema list derived from the catalog intersected with `lore.repos.team` and
   re-validated in code before interpolation. Per-repo resolution is rejected
   here: it multiplies round trips by repo count and changes the semantics
   from "repos that have chunks" to "repos that are registered".
3. **`org_shared` keeps two legitimate direct uses**: the fallback above, and
   deliberately org-wide aggregates (`distinctTeams`, `countChunksByTeam`).
   Everything else naming `org_shared.chunks` directly is a bug.
4. **Legacy rows are relocated, not deleted.** A one-time migration moves each
   repo's stranded `org_shared` rows into its resolved schema: copy where the
   target has no row for the same file, then delete the source rows, one
   subtransaction per repo, insert strictly before delete. Move preserves the
   768-dim embeddings (reindex's incremental path would never regenerate
   them), row ids, and timestamps, and stamps `migrated_from` for
   auditability. Rows with classifiable content types are adopted by the
   verification sweep (`ingested_by = 'reindex-job'`), narrowing the first
   accepted gap of the ADR-019 amendment; pseudo-path writers stay unowned.
   The migration merges only after the last hardcoded reader is repointed —
   moving rows out from under a reader that still stares at `org_shared`
   would turn stale context into no context.

The work ships as one ordered train: #977 (fan-out), #976 (spec-drift), the
reader-repoint follow-up, then the #979 migration. #978 (spec reassembly
ordered by `metadata.chunk_index` instead of `ingested_at`) rides alongside:
it is not a schema fix, but it unwinds the rank-millisecond re-stamp offset
the ADR-019 amendment only needed because reassembly order was coupled to
ingest timing.

## Consequences

Positive: team-schema repos participate in detection, drift verdicts are
computed against real spec and symbol sets, context assembly reads what
reindex writes, and the `org_shared` remainder is exactly what the design
says it should be — fallback rows and org-wide aggregates.

Accepted costs: each resolved read adds a schema-resolution query (parity
with the #975 precedent; no caching added); fan-out's union does N-schema
sequential scans on an unindexed predicate, acceptable at weekly cadence;
the migration needs a one-time operator grant and *silently skips* schemas
without it — the deploy log must be checked for skip notices and the
migration re-run after granting.

Open follow-up: the second ADR-019 accepted gap — api-owned orphans of
deleted files — is not closable in SQL and belongs in the reindex
verification sweep (widen the prune to `ingested_by = 'api'`).

## Alternatives considered

- **Delete the legacy rows instead of moving them.** Rejected: destroys the
  only copy of non-seed-scope content plus its embeddings, at one Vertex call
  per chunk to regenerate — and nothing would regenerate them unprompted.
- **Backfill everything into `org_shared` instead of fixing the readers.**
  Rejected: reverses the schema-per-team isolation decision and would make
  the write path lie instead of the read paths.
- **Resolve per repo inside the fan-out.** Rejected as decided above (2).
- **A shared read-through view (`UNION ALL` view over all schemas).**
  Rejected: hides the resolution rule the write path must still apply,
  reintroduces cross-team scans on every repo-scoped read, and needs DDL
  maintenance on every team-schema creation.
