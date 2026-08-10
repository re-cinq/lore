# Feature Specification: Platform Infrastructure

| Field   | Value                    |
|---------|--------------------------|
| Feature | Platform Infrastructure  |
| Status  | Shipped                  |
| Owner   | Platform Engineering     |

Platform Infrastructure documents the cross-cutting plumbing beneath Lore's features — health and readiness probes, the GitHub App/token client adapter, git-remote repo detection, schema migrations, the context-core store, and the autoresearch store — so each capability's tests trace to a written statement.

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

### Database pool resilience

Every long-lived `pg` pool (the Floor kernel pool, the lore-api pool, the web-ui
pool) attaches an `error` listener at construction, so an idle-client failure
(backend restart, network blip) is logged with the app's `[db]`/`[lore-api]`
prefix instead of surfacing as an uncaught exception that kills the process; the
Floor pool is the test-validated exemplar, and the lore-api and web-ui pools
attach the identical inline handler at their own construction
sites. ([validated by `db.test.ts:16`](apps/floor/src/kernel/db.test.ts#L16))

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

### Live Anthropic cost

`GET /api/anthropic-cost/live` serves the Admin API cost/usage report to the
`/spend` page so the billed figures are current rather than up to a day stale.
The Floor serves it because the `sk-ant-admin` key is org-wide billing access
and is already mounted there, keeping it out of the `lore-ui` namespace. The
route rejects a mismatched bearer token, answers `503` without calling upstream
when `ANTHROPIC_ADMIN_KEY` is unset — so the caller can tell "not configured"
from "configured and zero" — and otherwise returns the fetched rows alongside
the `fetchedAt` timestamp, passing the key from the environment to the fetcher. ([validated by `anthropic-cost-live.test.ts:54`](apps/floor/src/delivery/http/routes/anthropic-cost-live.test.ts#L54), [`anthropic-cost-live.test.ts:68`](apps/floor/src/delivery/http/routes/anthropic-cost-live.test.ts#L68), [`anthropic-cost-live.test.ts:77`](apps/floor/src/delivery/http/routes/anthropic-cost-live.test.ts#L77), [`anthropic-cost-live.test.ts:92`](apps/floor/src/delivery/http/routes/anthropic-cost-live.test.ts#L92))

Responses are cached for a TTL because every page view is an upstream call and
the Admin API's rate-limit ceiling is unpublished: concurrent and repeat
requests inside the TTL collapse into one upstream call, a request after the TTL
has elapsed calls upstream again, and a rejection is never cached so the next
request retries rather than pinning the page to the fallback. ([validated by `anthropic-cost-live.test.ts:102`](apps/floor/src/delivery/http/routes/anthropic-cost-live.test.ts#L102), [`anthropic-cost-live.test.ts:114`](apps/floor/src/delivery/http/routes/anthropic-cost-live.test.ts#L114), [`anthropic-cost-live.test.ts:126`](apps/floor/src/delivery/http/routes/anthropic-cost-live.test.ts#L126))

`monthStart` resolves the month boundary in UTC to match the fallback SQL's
`date_trunc('month', current_date)`, zero-padding single-digit months and using
the UTC month even when the timestamp falls in a different month locally. ([validated by `anthropic-cost-live.test.ts:25`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L25), [`anthropic-cost-live.test.ts:29`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L29), [`anthropic-cost-live.test.ts:33`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L33))

`aggregateMonthToDate` reproduces the month-to-date rollups the page otherwise
reads from `pipeline.anthropic_cost_daily`, so the live view and the DB fallback
carry the same shapes and arithmetic: it sums cost and tokens across the month,
excludes rows dated before the month start while including a row dated exactly
on it, groups by model ordered by cost descending and by day ordered by date
descending, and reports a null `as_of` for a month with no rows — mirroring
`MAX(fetched_at)` over an empty set, so the view hides the billed sections
rather than showing them as available. ([validated by `anthropic-cost-live.test.ts:39`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L39), [`anthropic-cost-live.test.ts:54`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L54), [`anthropic-cost-live.test.ts:67`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L67), [`anthropic-cost-live.test.ts:82`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L82), [`anthropic-cost-live.test.ts:109`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L109), [`anthropic-cost-live.test.ts:126`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L126), [`anthropic-cost-live.test.ts:139`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L139))

`fetchLiveCost` degrades to the cached rollup rather than throwing, because
`/spend` must render whatever the Floor is doing: it returns null without
calling out when the Floor URL or ingest token is unset, on a non-2xx response,
on a malformed payload, and when the request rejects; on success it returns the
payload and sends the ingest token as a bearer header. The request carries an
abort signal so an unresponsive Floor pod degrades the page instead of stalling
the render. ([validated by `anthropic-cost-live.test.ts:193`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L193), [`anthropic-cost-live.test.ts:204`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L204), [`anthropic-cost-live.test.ts:215`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L215), [`anthropic-cost-live.test.ts:231`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L231), [`anthropic-cost-live.test.ts:244`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L244), [`anthropic-cost-live.test.ts:252`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L252), [`anthropic-cost-live.test.ts:260`](apps/web-ui/src/lib/anthropic-cost-live.test.ts#L260))

The billed card names which source produced its figures — a live Floor read or
the last nightly sync — and omits the label entirely when no source is given. ([validated by `SpendView.test.tsx:214`](apps/web-ui/src/app/spend/SpendView.test.tsx#L214), [`SpendView.test.tsx:220`](apps/web-ui/src/app/spend/SpendView.test.tsx#L220), [`SpendView.test.tsx:226`](apps/web-ui/src/app/spend/SpendView.test.tsx#L226))
