# Feature Specification: Platform Infrastructure

| Field   | Value                    |
|---------|--------------------------|
| Feature | Platform Infrastructure  |
| Status  | Shipped                  |
| Owner   | Platform Engineering     |

## Problem Statement

Several cross-cutting platform capabilities have no single feature spec but carry
real, tested contracts: the health/readiness probes, the GitHub App/token client
adapter, git-remote repo detection, schema migrations, the eval-score/namespace
context-core store, and the autoresearch store. This spec documents each so its
tests trace to a statement (features → their own specs; this covers the platform
plumbing beneath them).

## Functional Requirements

### Health probes

The readiness probe reports database connectivity: `getHealthStatus()` returns
`connected:false` with a null `chunk_count` when no pool is configured,
`connected:true` with the chunk count when the query succeeds, and
`connected:false` with a reason when the query throws; the `/healthz` handler
returns 200/`ok` when the DB is connected or no DB is configured, and 503/`error`
only when a configured DB is unreachable — the Floor's own `/healthz` returning
the `{status:"error", reason:"database connection failed"}` body in that case. ([validated by `healthz.test.ts:14`](apps/mcp-server/src/platform/healthz.test.ts#L14), [`healthz.test.ts:22`](apps/mcp-server/src/platform/healthz.test.ts#L22), [`healthz.test.ts:40`](apps/mcp-server/src/platform/healthz.test.ts#L40), [`healthz.test.ts:61`](apps/mcp-server/src/platform/healthz.test.ts#L61), [`healthz.test.ts:74`](apps/mcp-server/src/platform/healthz.test.ts#L74), [`healthz.test.ts:97`](apps/mcp-server/src/platform/healthz.test.ts#L97), [`health.test.ts:5`](apps/floor/src/delivery/http/routes/health.test.ts#L5))

### GitHub client

`deriveComputedStatus` derives a PR's rollup status by precedence: merged, then
closed, then draft win first; otherwise any failed check yields `checks-failing`
and any requested-changes review yields `changes-requested` (both over an
approval); `approved` requires an approval and every check concluded
success/skipped, so a still-running (null-conclusion) check keeps it `open`, and
an approval with no checks configured is `approved`. ([validated by `github-client.test.ts:20`](apps/lore-api/src/platform/github-client.test.ts#L20), [`github-client.test.ts:27`](apps/lore-api/src/platform/github-client.test.ts#L27), [`github-client.test.ts:37`](apps/lore-api/src/platform/github-client.test.ts#L37), [`github-client.test.ts:41`](apps/lore-api/src/platform/github-client.test.ts#L41), [`github-client.test.ts:47`](apps/lore-api/src/platform/github-client.test.ts#L47), [`github-client.test.ts:59`](apps/lore-api/src/platform/github-client.test.ts#L59))

### Repo detection

`detectCurrentRepo` parses the git origin remote into `owner/repo` for both SSH
and HTTPS forms (with or without the `.git` suffix), returns null when the git
command throws, caches the result so a second call does not re-run git, and
re-runs after `resetRepoCache` clears the cache. ([validated by `repo-detect.test.ts:17`](libs/server-core/src/features/repo/repo-detect.test.ts#L17), [`repo-detect.test.ts:22`](libs/server-core/src/features/repo/repo-detect.test.ts#L22), [`repo-detect.test.ts:30`](libs/server-core/src/features/repo/repo-detect.test.ts#L30), [`repo-detect.test.ts:37`](libs/server-core/src/features/repo/repo-detect.test.ts#L37), [`repo-detect.test.ts:44`](libs/server-core/src/features/repo/repo-detect.test.ts#L44))

### Schema migrations

The tracked, idempotent ui-helm migrations backfill the ADR-016 hippo-memory
drift on repos bootstrapped before it entered the baseline scripts: the four
`memory.facts` columns (`confidence`, `retrieval_count`, `last_retrieved_at`,
`half_life_days`) and the three `memory.memories` decay columns are added
`if not exists`, the `confidence` CHECK constraint guards the four tiers
(`verified`/`observed`/`inferred`/`stale`), and both `memory.fact_conflicts` and
`pipeline.audit_log` are created `if not exists`. ([validated by `migrations.test.ts:36`](apps/lore-api/src/migrations.test.ts#L36), [`migrations.test.ts:51`](apps/lore-api/src/migrations.test.ts#L51), [`migrations.test.ts:65`](apps/lore-api/src/migrations.test.ts#L65), [`migrations.test.ts:71`](apps/lore-api/src/migrations.test.ts#L71), [`migrations.test.ts:75`](apps/lore-api/src/migrations.test.ts#L75))

### Context-core store

The context-core store tracks the latest production eval score per namespace:
`latest(namespace)` reads the most-recent `status = 'production'`
`eval_score` from `pipeline.context_core_history` (null when a namespace has no
production history, ignoring other namespaces and non-production rows), and
`insert` writes a history row in `version, namespace, score, status` order. The
`InMemoryContextCore` double mirrors this resolution and retains every inserted
record for assertion. ([validated by `context-core.test.ts:23`](libs/shared/src/project/context-core/context-core.test.ts#L23), [`context-core.test.ts:34`](libs/shared/src/project/context-core/context-core.test.ts#L34), [`context-core.test.ts:40`](libs/shared/src/project/context-core/context-core.test.ts#L40), [`context-core.test.ts:63`](libs/shared/src/project/context-core/context-core.test.ts#L63), [`context-core.test.ts:88`](libs/shared/src/project/context-core/context-core.test.ts#L88), [`context-core.test.ts:107`](libs/shared/src/project/context-core/context-core.test.ts#L107))

### Research store

`PgResearch.recordAttempt` inserts into `pipeline.research_attempts` in
`cluster_id, namespace, approach, content, eval_score, delta` parameter order,
and the `InMemoryResearch` double retains every recorded attempt for assertion. ([validated by `research.test.ts:33`](libs/shared/src/project/research/research.test.ts#L33), [`research.test.ts:51`](libs/shared/src/project/research/research.test.ts#L51))

### Route plumbing

`makeGraphLlmCall` returns undefined when `ANTHROPIC_API_KEY` is unset, and
otherwise returns a caller that routes the prompt through the `Llm` singleton
under the `graph-extraction` job name. ([validated by `helpers.test.ts:17`](apps/lore-api/src/api/routes/helpers.test.ts#L17), [`helpers.test.ts:22`](apps/lore-api/src/api/routes/helpers.test.ts#L22))

`triggerAgentSpecTrace` is a no-op that resolves to undefined when there is no DB
pool. ([validated by `spec-trace-trigger.test.ts:37`](apps/lore-api/src/api/routes/spec-trace-trigger.test.ts#L37))
