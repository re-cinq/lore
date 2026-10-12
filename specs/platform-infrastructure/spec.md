# Feature Specification: Platform Infrastructure

| Field   | Value                    |
|---------|--------------------------|
| Feature | Platform Infrastructure  |
| Status  | In Progress              |
| Owner   | Platform Engineering     |

Platform Infrastructure documents the cross-cutting plumbing beneath Lore's features — health and readiness probes, the GitHub App/token client adapter, git-remote repo detection, and schema migrations — so each capability's tests trace to a written statement.

## Problem Statement

Several cross-cutting platform capabilities have no single feature spec but carry
real, tested contracts: the health/readiness probes, the GitHub App/token client
adapter, git-remote repo detection, and schema migrations. This spec documents each so its
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
the `{status:"error", reason:"database connection failed"}` body in that case. ([validated by `healthz.test.ts:12`](libs/server-core/src/outbound/healthz.test.ts#L12), [`healthz.test.ts:20`](libs/server-core/src/outbound/healthz.test.ts#L20), [`healthz.test.ts:38`](libs/server-core/src/outbound/healthz.test.ts#L38), [`healthz.test.ts:57`](libs/server-core/src/outbound/healthz.test.ts#L57), [`healthz.test.ts:70`](libs/server-core/src/outbound/healthz.test.ts#L70), [`healthz.test.ts:93`](libs/server-core/src/outbound/healthz.test.ts#L93))

### Database pool resilience

Every long-lived `pg` pool (the shared pool the services build at boot, the
lore-api pool) attaches an `error` listener at construction, so an idle-client failure
(backend restart, network blip) is logged with the app's `[db]`/`[lore-api]`
prefix instead of surfacing as an uncaught exception that kills the process; the
shared pool builder is the test-validated exemplar, and the lore-api pool
attaches the identical inline handler at its own construction
site. ([validated by logs a terminated idle client under the db prefix instead of ending the process](libs/shared/src/outbound/db/pg-pool-idle-error.test.ts#L10))

### GitHub client

`deriveComputedStatus` derives a PR's rollup status by precedence: merged, then
closed, then draft win first; otherwise any failed check yields `checks-failing`
and any requested-changes review yields `changes-requested` (both over an
approval); `approved` requires an approval and every check concluded
success/skipped, so a still-running (null-conclusion) check keeps it `open`, and
an approval with no checks configured is `approved`. ([validated by `github-client.test.ts:29`](apps/lore-api/src/outbound/github-client.test.ts#L29), [`github-client.test.ts:35`](apps/lore-api/src/outbound/github-client.test.ts#L35), [`github-client.test.ts:45`](apps/lore-api/src/outbound/github-client.test.ts#L45), [`github-client.test.ts:49`](apps/lore-api/src/outbound/github-client.test.ts#L49), [`github-client.test.ts:55`](apps/lore-api/src/outbound/github-client.test.ts#L55), [`github-client.test.ts:67`](apps/lore-api/src/outbound/github-client.test.ts#L67))

`fetchPrStatus` returns null without a network call when no GitHub token is configured; otherwise it fetches the PR, reviews, review threads and check-runs concurrently and derives `computed_status`, falling back to an empty list when the reviews or check-runs request fails, while a failure fetching the PR itself propagates; it also reports `unresolved_threads`, the count of review threads nobody resolved yet (read over GraphQL, the only place GitHub states resolution), and null rather than 0 when that read fails, so a failed read never passes for a clean PR ([validated by `github-client.test.ts:146`](apps/lore-api/src/outbound/github-client.test.ts#L146), [`github-client.test.ts:151`](apps/lore-api/src/outbound/github-client.test.ts#L151), [`github-client.test.ts:178`](apps/lore-api/src/outbound/github-client.test.ts#L178), [`github-client.test.ts:193`](apps/lore-api/src/outbound/github-client.test.ts#L193), [`github-client.test.ts:207`](apps/lore-api/src/outbound/github-client.test.ts#L207), [`github-client.test.ts:221`](apps/lore-api/src/outbound/github-client.test.ts#L221))

### GitHub port — new reads and writes (protected-branch-merge plan)

Three new reads are added to `libs/shared/src/outbound/project/lib/platform-github.ts`:

- `getBranchRule(repo, branch)` — reads the branch's rulesets and classic branch protection: required approval count, Code Owners review required flag, and required check names. Used to decide where Lore may arm native auto-merge and to validate `auto_merge.approver = lore-reviewer` prerequisites before persisting.
- `getMergeability(repo, prNumber)` — reads GitHub's mergeability field on a PR. Eventually consistent: GitHub computes it asynchronously after push; callers must treat a null as "not yet computed" rather than "not mergeable".
- `getChangedFiles(repo, prNumber)` — reads the PR's file list for CODEOWNERS matching, used by the blocked-reason station to classify a PR as routine or sensitive.

Three new writes are added to the same adapter:

- `enablePullRequestAutoMerge(prId, mergeMethod)` — GraphQL `enablePullRequestAutoMerge` mutation. Arms GitHub's native auto-merge on the PR; always called with `mergeMethod: SQUASH`. Only callable on a PR where the branch rule requires an approval and the PR is not yet mergeable (GitHub refuses otherwise).
- `disablePullRequestAutoMerge(prId)` — GraphQL mutation. Called on every open Lore-authored PR when `auto_merge.approver` is changed to `none`.
- `updateIssueComment(commentId, body)` — REST `PATCH /repos/{o}/{r}/issues/comments/{id}`. Edits an existing comment in place; used by the blocked-reason station to maintain the `<!-- lore:blocked-reason -->` idempotent comment on the PR and on the backlog issue.

### lore-reviewer App credentials

lore-reviewer's App id and private key live in Google Cloud Secret Manager. ESO mirrors them into the `lore-stations` namespace following the ADR-046 pattern. The four-place procedure applies: (1) `local.secret_names` in `secrets.tf`; (2) an `ExternalSecret` resource per consuming namespace in `external-secrets.tf`; (3) the REQUIRED list in `scripts/infra/seed-secrets.sh`; (4) the chart's `secretKeyRef` in the stations subchart. The `terraform apply` must land before the chart change merges — a `secretKeyRef` referencing an ExternalSecret that does not yet exist leaves the Pod unable to start (the Kubernetes `CreateContainerConfigError` condition) and `helm --wait` hanging. No long-lived credential is held in the process; the App authenticates with a short-lived installation token minted from the private key on each call. See [specs/protected-branch-merge/plan.md](../protected-branch-merge/plan.md) for the full org-admin runbook.

### Repo detection

`detectCurrentRepo` parses the git origin remote into `owner/repo` for both SSH
and HTTPS forms (with or without the `.git` suffix), returns null when the git
command throws, caches the result so a second call does not re-run git, and
re-runs after `resetRepoCache` clears the cache. ([validated by `repo-detect.test.ts:17`](libs/server-core/src/work/repo/repo-detect.test.ts#L21), [`repo-detect.test.ts:22`](libs/server-core/src/work/repo/repo-detect.test.ts#L26), [`repo-detect.test.ts:30`](libs/server-core/src/work/repo/repo-detect.test.ts#L34), [`repo-detect.test.ts:37`](libs/server-core/src/work/repo/repo-detect.test.ts#L41), [`repo-detect.test.ts:44`](libs/server-core/src/work/repo/repo-detect.test.ts#L48))
- **FR — detectCurrentBranch** *(added 2026-09-12)*: returns the checked-out branch from `git rev-parse --abbrev-ref HEAD`, null on a detached HEAD or outside a checkout, and re-runs git on every call because a session switches branches and a CI question is about the branch it is on now. ([validated by returns the checked-out branch](libs/server-core/src/work/repo/repo-detect.test.ts#L63), [validated by returns null on a detached HEAD, which names no branch CI could have judged](libs/server-core/src/work/repo/repo-detect.test.ts#L68), [validated by returns null when the git command throws](libs/server-core/src/work/repo/repo-detect.test.ts#L73), [validated by re-runs git on every call, since a checkout can switch branches between two calls](libs/server-core/src/work/repo/repo-detect.test.ts#L80))

### Schema migrations

The tracked, idempotent ui-helm migrations backfill the ADR-016 hippo-memory
drift on repos bootstrapped before it entered the baseline scripts: the four
`memory.facts` columns (`confidence`, `retrieval_count`, `last_retrieved_at`,
`half_life_days`) and the three `memory.memories` decay columns are added
`if not exists`, the `confidence` CHECK constraint guards the four tiers
(`verified`/`observed`/`inferred`/`stale`), and both `memory.fact_conflicts` and
`pipeline.audit_log` are created `if not exists`. ([validated by `migrations.test.ts:36`](apps/lore-api/src/migrations.test.ts#L31), [`migrations.test.ts:46`](apps/lore-api/src/migrations.test.ts#L46), [`migrations.test.ts:60`](apps/lore-api/src/migrations.test.ts#L60), [`migrations.test.ts:66`](apps/lore-api/src/migrations.test.ts#L66), [`migrations.test.ts:70`](apps/lore-api/src/migrations.test.ts#L70))

### Route plumbing

`makeGraphLlmCall` returns undefined when `ANTHROPIC_API_KEY` is unset, and
otherwise returns a caller that routes the prompt through the `Llm` singleton
under the `graph-extraction` job name. ([validated by `helpers.test.ts:17`](apps/lore-api/src/transport/routes/helpers.test.ts#L13), [`helpers.test.ts:18`](apps/lore-api/src/transport/routes/helpers.test.ts#L18))

### Anthropic cost sync window

The daily `anthropic_cost_sync` cron (07:00 UTC) is the sole Anthropic Admin API
caller —
the cost report only changes once a day, so `/spend` reads the synced rows from
the database rather than proxying the API per request (ADR-043) — and its
`reportWindow` opens the request at today's UTC midnight minus 30
days and deliberately sends no `ending_at` — the API returns only buckets that
end strictly *before* that bound, so an `ending_at` at tomorrow's midnight
would exclude the current day's bucket — leaving exactly 31 candidate daily
buckets, the documented `1d` maximum, so the limit can never truncate one, the
first of the month is still covered on the 31st, and a window crossing a month
boundary loses no bucket. ([validated by `anthropic-cost-sync.test.ts:29`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost-sync.test.ts#L29), [`anthropic-cost-sync.test.ts:35`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost-sync.test.ts#L35), [`anthropic-cost-sync.test.ts:41`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost-sync.test.ts#L41), [`anthropic-cost-sync.test.ts:47`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost-sync.test.ts#L47), [`anthropic-cost-sync.test.ts:54`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost-sync.test.ts#L54), [`anthropic-cost-sync.test.ts:60`](apps/stations/src/work/anthropic-cost-sync/anthropic-cost-sync.test.ts#L60))

## Background: retired with Lore's own Floor (2026-10-02)

These statements described two stores whose only callers were nightly jobs of `apps/floor` (the assembly-line engine Lore ran itself, retired 2026-10-02). The `eval_runner` and `context_core_builder` jobs and the autoresearch loop were deleted with it on 2026-10-02, so the adapters and the tests that validated them went with the code, and migration 0101 dropped `pipeline.eval_runs`, `pipeline.context_core_history` and `pipeline.research_attempts`. Context evals are now a nightly GitHub Actions job that asks lore-api to write a question from each sampled document, assemble the context, and judge the answer (#2443); it keeps no stored baseline. They are kept as the record of what the old stores did.

### Context-core store

The context-core store tracked the latest production eval score per namespace:
`latest(namespace)` read the most-recent `status = 'production'`
`eval_score` from `pipeline.context_core_history` (null when a namespace had no
production history, ignoring other namespaces and non-production rows), and
`insert` wrote a history row in `version, namespace, score, status` order. The
`InMemoryContextCore` double mirrored this resolution and retained every inserted
record for assertion.

### Research store

`PgResearch.recordAttempt` inserted into `pipeline.research_attempts` in
`cluster_id, namespace, approach, content, eval_score, delta` parameter order,
and the `InMemoryResearch` double retained every recorded attempt for assertion.
