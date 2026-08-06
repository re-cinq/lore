# Lore MCP Tool Reference

This is the authoritative, per-tool reference for every tool exposed by the Lore MCP server: exact parameters, return shapes, where each tool runs, and how to disambiguate the confusable ones. It is generated from the tool registrations under `apps/mcp-server/src/mcp/tools/` and is precise rather than friendly.

For a non-engineer, plain-language overview of what these tools are for, read the companion guide: [`docs/mcp-tools.md`](./mcp-tools.md). This document is the precise reference; that one is the gentle introduction.

---

## MCP server structure

**Local stdio adapter.** The shipped MCP server (`@re-cinq/lore-mcp`, `apps/mcp-server`) runs on the developer's machine over **stdio**, registered by `scripts/install.sh`. It holds no database pool: it auto-detects the current repo from the git remote and **proxies** operations to the shared backend over `LORE_API_URL` (bearer `LORE_INGEST_TOKEN`). Proxied reads pass through a read-through cache (`platform/proxy-cache.ts`); writes invalidate the caches they affect. The remote backend it talks to is `@re-cinq/lore-api`, a plain REST service that owns the direct PostgreSQL + pgvector access behind `/api/*` (ADR-032).

**Two code paths in each handler.** Every tool handler is written to branch on `LORE_DB_HOST` (equivalently `isMemoryDbAvailable()`): pool present → direct DB; absent → proxy to `LORE_API_URL`, with a `~/.lore` file fallback only for a subset of memory tools and only when no API is configured at all. The stdio adapter never supplies a pool, so in the local install it always takes the proxy path; the direct-DB branch is the same code exercised whenever these handlers run with a live pool. The per-tool "Where it runs" notes below describe both branches.

**How tools register.** Each category lives in one file and exposes a `registerXTools(server, deps)` function called at startup. Inside, every tool is declared with:

```
server.tool(name, description, zodShape, handler)
```

The `description` is the long, self-disambiguating text an LLM reads to choose the tool; the `zodShape` is the parameter schema (each field carries a `.describe()` used verbatim below); the `handler` returns the result.

**ToolDeps / lazy `getPool`.** Every register function receives a `ToolDeps` object whose only member is `getPool()` — a lazy accessor for the pg pool. The pool is created in `main()` *after* tool registration, so handlers must call `getPool()` at invocation time rather than capturing a snapshot (`apps/mcp-server/src/mcp/tools/deps.ts`).

**Never-throw text-envelope contract.** No tool throws. Every handler wraps its body and returns `{ content: [{ type: "text", text }] }` — success payloads (usually JSON) and errors alike come back as text. Callers parse the text; they never catch exceptions.

**Bearer auth on `/api/*`.** Every HTTP API route the proxy targets enforces bearer-token validation before dispatch (`LORE_INGEST_TOKEN` full-access, or a scoped token from `pipeline.api_tokens`). The proxy helpers (`proxyToApi` / `proxyGetApi` / `proxyMemory` in `deps.ts`) attach the token, retry retriable statuses (`408/429/5xx`) with backoff `[200, 600, 1800]ms`, and classify outcomes as `ok` / `not_configured` / `unreachable` / `denied`. A `denied` (401/403) is never served from stale cache; an `unreachable` outage may fall back to a stale cached copy. `unreachable` and `denied` are surfaced as explicit error text (`unreachableError` / `deniedError`) rather than silently writing local state that would diverge from the org-wide DB.

**Local trust boundary.** Tools that execute arbitrary shell in your checkout — `lore_list_tests`, `lore_run_test` — and the whole local-runner family run only in a trusted sandbox (dev machine, CI, or an agent pod on the ai-agent-subsystem). On the shared cluster server (`LORE_DB_HOST` set) the spec-trace local tools refuse and return *"Test commands run only in a trusted sandbox — run in CI or locally."*

---

## Naming convention

Every tool is namespaced with the **`lore_` prefix** (Anthropic-recommended namespacing) so it never collides with tools from other MCP servers a developer may have connected. Tools are grouped by category — Context & knowledge, Memory, Task pipeline, Local runner, Spec-trace, Repos, Usage & analytics — and that grouping is the structure of the reference below. (One legacy tool, `lore-query-trace`, predates the underscore convention and keeps a hyphen.)

---

## Tool reference

40 tools across seven categories. For each: purpose, when to use / not use, parameters (only what the zod shape actually declares), return shape, where it runs, and cache/mutation notes.

### Context & knowledge

#### `lore_assemble_context`

One-line purpose: assemble ONE token-budgeted, template-ordered context block from every source (conventions, ADRs, memories, facts, episodes, graph) for a task.

- **When to use:** the mandatory first call when starting a task — you want a single synthesized briefing rather than hand-stitching the narrower retrieval tools.
- **When not to use:** for raw matching passages / exact wording use `lore_search_context`; for past learnings and facts use `lore_search_memory`; for entity relationships use `lore_query_graph`. Those three are the building blocks this tool already combines.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `query` | yes | — | Natural-language description of the context needed (e.g. `implement auth middleware`, `review PR #42`). Drives retrieval and ranking across all sources. |
| `template` | no | `default` | Section-ordering/budget profile: `default` \| `review` \| `implementation` \| `research`. Unrecognized values silently fall back to `default`. The per-template default budget (e.g. research's 16000) is NOT auto-applied — pass `max_tokens` to raise it. |
| `max_tokens` | no | `8000` | Token budget; floor 2000. Over-budget content is truncated and the section marked truncated. **Direct-DB path only; ignored when proxying.** |
| `repo` | no | auto-detect | Target repo as `owner/repo`; auto-detected from the git remote when omitted. |
| `agent_id` | no | ambient | Overrides the agent id used to scope memories/facts. **Direct-DB path only; ignored when proxying.** |
| `cross_repo` | no | `false` | Also pull context from linked repos. If `false` but the repo's `settings.cross_repo` is true, cross-repo is still enabled. **Direct-DB path only; ignored when proxying.** |

- **Returns:** on the direct-DB path, a single text block prefixed with an HTML comment carrying `template/sections/tokens` metadata; `No relevant context found for this query.` when every source is empty. On the proxy path, the API text as-is (no metadata comment), optionally prefixed with a `<!-- lore-cache: HIT/STALE -->` marker.
- **Where it runs:** direct Postgres when `LORE_DB_HOST` is set; otherwise proxies `GET /api/context` to `LORE_API_URL`.
- **Cache/mutation:** read-only. Proxy path uses a 600s read-through cache. Records a latency row via `trackLatency`. On the proxy path only `query`, `template`, and `repo` are forwarded; the rest are ignored.

#### `lore_search_context`

One-line purpose: search the ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and return the raw matching passages as source-scored snippets.

- **When to use:** you want chunk-level evidence or the exact wording of a convention/ADR that lives in ingested docs.
- **When not to use:** for one token-budgeted startup bundle use `lore_assemble_context` (the mandatory first call); for prior-session learnings/facts use `lore_search_memory`; for entity relationships use `lore_query_graph`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `query` | yes | — | Natural-language search query (e.g. `how are pipeline tasks authenticated`). |
| `team` | no | `org_shared` | Scope. DB path: a Postgres team schema name; an empty/no-result team transparently retries `org_shared`. File-fallback path: a `teams/<name>` subdir under `CONTEXT_PATH`; an unknown subtree returns a "search path not found" error. Omit to search org-wide. |
| `limit` | no | `8` | Maximum number of passages to return. |

- **Returns:** one text block; each hit is `**Score:** <rrf>` (DB path) or `**Source:** <relative-path>` (file path) followed by the passage, joined by `---`; or a no-results message.
- **Where it runs:** against the shared-DB backend directly when a DB is reachable (hybrid vector + BM25 fused by Reciprocal Rank Fusion); with no DB it degrades to a deterministic case-insensitive substring scan of local `.md` files, so it works before any ingest has run. **Never proxies to `LORE_API_URL`.**
- **Cache/mutation:** read-only, not cached.

### Memory

#### `lore_write_memory`

One-line purpose: store one curated, addressable key/value memory scoped to the current repo (or to `agent_id` when no repo is detected).

- **When to use:** you have a nugget to retrieve later by a key YOU choose — a decision, convention, correction, or session summary.
- **When not to use:** for raw uncurated text you want passively stored with auto fact-extraction and no chosen key, use `lore_write_episode`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `key` | yes | — | Caller-chosen retrieval key, slash-namespaced by convention (e.g. `auth-pattern`, `session-summary/2026-03-30`). |
| `value` | yes | — | The memory text; this exact string is the canonical stored value and is embedded for semantic search. |
| `agent_id` | no | ambient | Override the resolved agent ID for this write. |
| `ttl` | no | none | Time-to-live in seconds; sets `expires_at`. Omit for a permanent memory. |
| `extract_facts` | no | `false` | When true, fire async fact extraction from `value` (fire-and-forget; does not block). |

- **Returns:** the write result `{key, version, agent_id, created_at}`.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else proxies to `/api/memory` (write scope); `~/.lore` file fallback only when no API is configured.
- **Cache/mutation:** WRITE. Versioned (a repeat key bumps version, never overwrites). Embeds the value and invalidates memory-derived read caches (`lore_search_memory`, `lore_read_memory`, `lore_list_memories`, `lore_assemble_context`). Repo-detected memories are shared org-wide with everyone in the same repo; no-repo memories are agent-scoped.

#### `lore_read_memory`

One-line purpose: fetch one memory by its EXACT key.

- **When to use:** you already know the precise key.
- **When not to use:** searching by meaning or unknown key → `lore_search_memory`; enumerating keys for the current repo → `lore_list_memories`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `key` | yes | — | Exact memory key; no wildcards or fuzzy matching. |
| `agent_id` | no | ambient | Override the resolved agent ID. |
| `version` | no | latest | `"all"` for full history newest-first, or a numeric version string for one version. Omit for latest non-deleted. |

- **Returns:** the matched row(s) as JSON, or `Memory "<key>" not found.` when the key has no live version.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else a cached proxy to `/api/memory` (read scope); `~/.lore` file fallback when no API is configured.
- **Cache/mutation:** read. Proxy path uses a ~5min read-through cache.

#### `lore_delete_memory`

One-line purpose: soft-delete a memory by key for the resolved agent.

- **When to use:** retire a stale or mistaken memory.
- **When not to use:** to stop a background task on your machine use `lore_cancel_local_task`; to cancel a server-side pipeline task use `lore_cancel_task` (both unrelated).

| Parameter | Required | Default | Description |
|---|---|---|---|
| `key` | yes | — | Exact memory key to soft-delete. |
| `agent_id` | no | ambient | Override the resolved agent ID; deletion is scoped to this agent and key. |

- **Returns:** `{key, deleted: true}`.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else proxies to `/api/memory` (write scope); `~/.lore` file fallback when no API is configured.
- **Cache/mutation:** WRITE. Soft-delete flips `is_deleted` on every version row of that agent+key (history kept; not a hard purge, no restore here). Scope is `agent_id`, NOT repo. Invalidates memory-derived read caches.

#### `lore_list_memories`

One-line purpose: list memory keys for the current repo, newest-first and paginated.

- **When to use:** browse what memories exist by key without ranking.
- **When not to use:** find by meaning → `lore_search_memory`; fetch one value → `lore_read_memory`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `agent_id` | no | — | Scope to one agent when no repo is detected (ignored when a repo is detected — repo scope wins). |
| `limit` | no | `50` | Maximum number of memories to return. |
| `offset` | no | `0` | Rows to skip for pagination. **DB path only; not forwarded over the proxy.** |

- **Returns:** `{memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}`. Expired and soft-deleted memories are excluded. Scope precedence: detected repo, then `agent_id`, then org-wide.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else a ~5min cached proxy to `/api/memory` (read scope); `~/.lore` file fallback when no API is configured.
- **Cache/mutation:** read.

#### `lore_search_memory`

One-line purpose: semantic (vector + keyword) search across org-wide memories and extracted facts.

- **When to use:** find past learnings, decisions, corrections, and facts from prior sessions ("has this been solved or observed before") when you do NOT have an exact key.
- **When not to use:** exact-key lookup → `lore_read_memory`; enumerate keys → `lore_list_memories`; raw doc passages → `lore_search_context`; entity relationships → `lore_query_graph`; the single startup bundle → `lore_assemble_context`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `query` | yes | — | Natural-language query; matched by embedding similarity and keyword ILIKE, not exact key. |
| `agent_id` | no | — | Scope results to one agent. Omit for cross-agent (org-wide) search. |
| `pool` | no | — | Restrict to a named shared pool; a non-existent pool short-circuits to empty. |
| `limit` | no | `10` | Maximum number of fused results after rank fusion and diversification. |
| `include_invalidated` | no | `false` | Also return facts superseded by newer facts (historical queries). **Not forwarded over the proxy.** |
| `graph_augment` | no | `false` | Enrich results with 1-hop knowledge-graph neighbors of detected entities. **Not forwarded over the proxy.** |

- **Returns:** a relevance-ranked JSON array of `{key, value, score, agent_id, source, id?, confidence?}` where `source` is `memory|fact|episode|graph`. Only currently-valid facts unless `include_invalidated`.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else a ~5min cached proxy to `/api/memory` (read scope; `pool` maps to `pool_name`); `~/.lore` file fallback when no API is configured.
- **Cache/mutation:** read with a retrieval-strengthening side effect — fire-and-forget bump of `retrieval_count` / `half_life_days` on returned items.

#### `lore_write_episode`

One-line purpose: ingest one raw, uncurated text blob (conversation turn, review, observation) as a deduplicated episode.

- **When to use:** bulk/passive capture where you do NOT want to choose a key and do NOT need the text individually addressable.
- **When not to use:** for a curated nugget retrievable by a specific key, use `lore_write_memory`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `content` | yes | — | Raw text to ingest verbatim; deduplicated by content hash. 1–50000 chars. |
| `source` | no | `manual` | Free-form provenance tag (e.g. `session`, `pr-review`, `ci`, `manual`). |
| `ref` | no | — | External reference; the leading `owner/repo` before any `#` is used as the graph repo scope (e.g. `owner/repo#42`). |
| `agent_id` | no | ambient | Override the resolved agent ID. |

- **Returns:** `{status: "ok", episode_id, source, ref}`, or `{status: "duplicate", ...}` when the same content was already ingested.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else proxies to `/api/episode` (write scope). With neither configured it returns a "requires PostgreSQL or LORE_API_URL" message — **no file fallback**.
- **Cache/mutation:** WRITE. Content is secret-redacted before storage; facts (≤10) and graph entities/edges are extracted ASYNCHRONOUSLY (the response does not wait). Invalidates episode-derived read caches (`lore_search_memory`, `lore_query_graph`, `lore_assemble_context`).

#### `lore_query_graph`

One-line purpose: read the live knowledge graph for an entity's typed relationship edges.

- **When to use:** you want STRUCTURED relationships — which service uses/owns/depends-on/replaced-by which — not prose.
- **When not to use:** prose learnings/facts → `lore_search_memory`; raw doc passages → `lore_search_context`; the startup bundle → `lore_assemble_context`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `entity` | no | recent | Entity name to query; case-insensitive, matched against both edge endpoints. Omit to browse the most recent edges. |
| `relation_type` | no | all | Restrict to one relation type. Known: `uses`, `owns`, `depends-on`, `replaced-by`, `part-of`, `implements`. |
| `repo` | no | all | Scope edges to a specific repo; repo-less/NULL edges are excluded when set. |
| `include_invalidated` | no | `false` | Also include historical (temporally-invalidated) edges. |

- **Returns:** a JSON array of edges `{entity, entity_type, relation, related_entity, related_type, direction (outgoing|incoming), valid_from}`, or `No relationships found for "<entity>".` / `Knowledge graph is empty…`.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else a ~10min cached proxy to `GET /api/graph` (read scope). With neither, returns a "requires PostgreSQL or LORE_API_URL" message.
- **Cache/mutation:** read-only here (the graph is populated asynchronously by `lore_write_episode`). Records a latency row via `trackLatency`.

#### `lore_agent_stats`

One-line purpose: report one agent's combined memory health and learning statistics.

- **When to use:** gauge how much an agent has learned and how active it is (diagnosing a quiet or runaway agent).
- **When not to use:** for per-developer LLM token spend use `lore_my_usage` (this is memory telemetry, not spend).

| Parameter | Required | Default | Description |
|---|---|---|---|
| `agent_id` | no | ambient | Override the resolved agent ID to inspect a specific agent. |

- **Returns:** JSON with `agent_id`, `memory_count`, `last_active`, `snapshot_count`, `total_memories`, `total_facts`, `active_facts`, `invalidated_facts`, `total_searches`, `shared_pools_created`, and `recent_episodes {total_count, latest: [{id, source, ref, created_at, content_preview, fact_count}]}`.
- **Where it runs:** **direct DB only.** Unlike the other memory tools it does NOT proxy to `LORE_API_URL`; with no DB it returns `Agent stats requires PostgreSQL (LORE_DB_HOST not set).`
- **Cache/mutation:** read-only.

### Task pipeline

#### `lore_create_pipeline_task`

One-line purpose: register a new server-side pipeline task (backlog by default; `immediate` is auto-executed by the GKE agent).

- **When to use:** delegate brand-new work to the server. This tool only enqueues — it never runs anything on your machine.
- **When not to use:** to start a brand-new ad-hoc task NOW in a local worktree use `lore_run_task_locally`; to claim and locally run a task that ALREADY exists use `lore_claim_and_run_locally`; to turn a `tasks.md` checklist into spec-tasks use `lore_sync_tasks`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `description` | yes | — | Primary instruction for the agent; non-empty (whitespace-only rejected); max 10000 chars. |
| `task_type` | no | `general` | One of `feature-request`, `onboard`, `general`, `runbook`, `implementation`, `gap-fill`, `review`. Unknown values fall back to `general`. |
| `target_repo` | no | auto-detect | Target repo as `owner/repo`; falls back to git remote, then a task-type default. |
| `priority` | no | `normal` | `normal` = backlog (claimed/run later); `immediate` = GKE agent auto-executes within ~30s. |
| `group_id` | no | — | Task-group UUID linking this task to others in a multi-repo feature (see `lore_list_task_group`). |
| `context` | no | — | Object `{spec_file?: boolean, branch?: string, seed_query?: string}` passed through to the agent. |

- **Returns:** text with the new UUID, type, priority, resolved repo, and a pickup hint.
- **Where it runs:** direct Postgres when `LORE_DB_HOST` is set; else `POST /api/task` over `LORE_API_URL` (requires `LORE_INGEST_TOKEN`).
- **Cache/mutation:** WRITE. Inserts a `pipeline.tasks` row + `pending` event, enforces the repo's trust gate, and invalidates task-list read caches (`lore_list_pipeline_tasks`, `lore_list_pending_tasks`, `lore_get_pipeline_status`).

#### `lore_get_pipeline_status`

One-line purpose: return one pipeline task's full record by UUID — current status plus the ordered event timeline.

- **When to use:** check where a specific delegated task stands.
- **When not to use:** multi-task listing → `lore_list_pipeline_tasks`; live GitHub PR/CI state → `lore_get_pr_status`; raw log bytes → `lore_get_task_logs`; group rollup → `lore_list_task_group`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of the pipeline task to fetch. |

- **Returns:** the full task record + event timeline (`pending → running → pr-created → …`) as pretty JSON; `task not found: {id}` when missing.
- **Where it runs:** direct Postgres when `LORE_DB_HOST` is set; else `GET /api/task/:id` over `LORE_API_URL`.
- **Cache/mutation:** read-only.

#### `lore_get_pr_status`

One-line purpose: fetch live PR state directly from GitHub for a repo + PR number with a single derived `computed_status`.

- **When to use:** the real, up-to-the-second PR/CI/review verdict.
- **When not to use:** for the Lore task's own stored status and event timeline use `lore_get_pipeline_status`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | yes | — | Repository as `owner/name`. |
| `pr_number` | yes | — | Pull request number (integer in the PR URL, not a UUID). |

- **Returns:** JSON with `computed_status` (one of `merged`, `closed`, `draft`, `checks-failing`, `changes-requested`, `approved`, `open`, by fixed precedence) plus `number`, `title`, `state`, `draft`, `merged`, `mergeable`, `html_url`, normalized `checks`, and `reviews`. `GitHub not configured…` when no credentials.
- **Where it runs:** calls `api.github.com` directly via the configured GitHub App or token — **no DB, no `LORE_API_URL` proxy.**
- **Cache/mutation:** read-only.

#### `lore_list_pipeline_tasks`

One-line purpose: list pipeline tasks newest-first, optionally filtered to one status. The general browse view.

- **When to use:** browse across ALL tasks and statuses.
- **When not to use:** unclaimed runnable work → `lore_list_pending_tasks`; dependency-ready spec-tasks → `lore_ready_tasks`; one feature's group → `lore_list_task_group`; tasks on YOUR machine → `lore_list_local_tasks`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `status` | no | all | Filter to one status; DB mode validates against `pending`, `queued`, `running`, `pr-created`, `review`, `merged`, `failed`, `cancelled` (invalid rejected with the list). |
| `limit` | no | `20` | Maximum number of tasks, newest-first; clamped to ≤100. |

- **Returns:** `{tasks, total}` JSON.
- **Where it runs:** direct Postgres when `LORE_DB_HOST` is set; else `GET /api/tasks` over `LORE_API_URL`.
- **Cache/mutation:** read-only, not cached.

#### `lore_cancel_task`

One-line purpose: cancel a SERVER-SIDE pipeline task by UUID.

- **When to use:** tasks tracked in the Lore pipeline (created via `lore_create_pipeline_task` / UI).
- **When not to use:** a task running in a worktree on YOUR machine → `lore_cancel_local_task`; to re-run a failed task → `lore_retry_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of a non-terminal task (not merged/failed/cancelled). |

- **Returns:** the new status as JSON; rejected for already merged/failed/cancelled tasks (`Cannot cancel task in {state} state`).
- **Where it runs:** **direct Postgres only** (`LORE_DB_HOST`) — no stdio/API-proxy path.
- **Cache/mutation:** WRITE. Flips to `cancelled`, best-effort stops a running GKE agent, records a `cancelled` event.

#### `lore_retry_task`

One-line purpose: re-run a failed or escalated task by cloning it into a NEW task linked via `retry_of`.

- **When to use:** give a failed task a second attempt.
- **When not to use:** to stop an unwanted live task → `lore_cancel_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of the original `failed` or `needs-human-help` task. |

- **Returns:** the new task `{id, status, retry_of}` as JSON. Only `failed` / `needs-human-help` tasks are retryable (others rejected, e.g. `Cannot retry task in running state`).
- **Where it runs:** **direct Postgres only** — no stdio/API-proxy path.
- **Cache/mutation:** WRITE. Inserts a new `pipeline.tasks` row + `pending` event (re-running the trust gate) and marks the original `retried`.

#### `lore_list_task_group`

One-line purpose: list every task sharing one `task_group_id`, with a completed/total rollup.

- **When to use:** you have a `group_id` and want the whole multi-repo feature's progress.
- **When not to use:** for an unscoped newest-first listing use `lore_list_pipeline_tasks`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `group_id` | yes | — | Task-group UUID (the value passed as `group_id` to `lore_create_pipeline_task`). |

- **Returns:** a `completed/total` summary line plus rows as JSON (`id, description, task_type, status, target_repo, pr_url, created_at`); `No tasks found for group {id}` when empty.
- **Where it runs:** **direct Postgres only** (via the DB pool) — no stdio/API-proxy path.
- **Cache/mutation:** read-only.

#### `lore_sync_tasks`

One-line purpose: parse a speckit `tasks.md` and idempotently upsert each item as a spec-task row.

- **When to use:** the START of spec-driven multi-agent work — once per spec, before any claiming.
- **When not to use:** this does NOT claim, run, or evaluate readiness — find workable items with `lore_ready_tasks`, lock with `lore_claim_task`, finish with `lore_complete_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `tasks_markdown` | yes | — | Full markdown text of the `tasks.md` (the document, not a path). Parsed for phases, `[P]` parallel markers, `[DEPENDS ON: …]` dependencies, and file-path suffixes. |
| `repo` | no | auto-detect | Target repo as `owner/repo`. |
| `spec_slug` | yes | — | Feature slug grouping these spec-tasks within the repo (disambiguates on re-sync). |

- **Returns:** a `Synced N tasks (M new)` summary. Re-running after edits updates rows in place rather than duplicating.
- **Where it runs:** **direct Postgres only** (via the DB pool) — no stdio/API-proxy path.
- **Cache/mutation:** WRITE (upserts spec-task rows).

#### `lore_ready_tasks`

One-line purpose: list the repo's spec-tasks that are `pending` AND whose every dependency has completed/merged.

- **When to use:** dependency-aware "what can I start right now" for one repo.
- **When not to use:** general status listing → `lore_list_pipeline_tasks`; unclaimed tasks across repos → `lore_list_pending_tasks`. Spec-tasks must first be materialized with `lore_sync_tasks`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | no | auto-detect | Repo to scan as `owner/repo`. |

- **Returns:** a markdown bullet list of `spec_task_id (uuid): description`; `No ready tasks…` when nothing qualifies.
- **Where it runs:** **direct Postgres only** (via the DB pool) — no stdio/API-proxy path.
- **Cache/mutation:** read-only.

#### `lore_claim_task`

One-line purpose: atomically lock one `pending` spec-task and flip it to `running`.

- **When to use:** right before you start working a specific spec-task (typically one from `lore_ready_tasks`).
- **When not to use:** pick WHICH task → `lore_ready_tasks`; mark done afterward → `lore_complete_task`; dismiss a local pending NOTIFICATION → `lore_skip_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of the pending spec-task to claim. |
| `agent_id` | no | resolved | Identifier of the claiming agent, recorded as owner; resolved from `LORE_AGENT_ID` / `~/.lore/agent-id` / generated when omitted. |

- **Returns:** a claim-success message, or already-claimed/not-found text.
- **Where it runs:** **direct Postgres only** — no stdio/API-proxy path.
- **Cache/mutation:** WRITE. Locks via `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction (status + `agent_id`), best-effort records a `running` event.

#### `lore_complete_task`

One-line purpose: mark a `running` spec-task `completed` and report which dependents it unblocks.

- **When to use:** you finished a task claimed with `lore_claim_task`; pick the next with `lore_ready_tasks`.
- **When not to use:** local notification dismissal → `lore_skip_task`; cancelling → `lore_cancel_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of the running spec-task to mark completed. |

- **Returns:** a completion message plus newly-unblocked `spec_task_id: description` entries. Only `running` tasks complete (others: `Could not complete…it may not be in running state`).
- **Where it runs:** **direct Postgres only** — no stdio/API-proxy path.
- **Cache/mutation:** WRITE. Sets `status='completed'`, best-effort records a `completed` event.

#### `lore_get_task_logs`

One-line purpose: fetch the raw execution output of one pipeline TASK by UUID, with byte-offset polling.

- **When to use:** a user-created/delegated task's logs.
- **When not to use:** for a scheduled CronJob RUN use `lore_get_job_logs` (by `job_name` + `run_id`).

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of the pipeline task whose logs to fetch. |
| `offset` | no | `0` | Byte offset to start from; pass the previous `next_offset` to fetch only new bytes when polling. |

- **Returns:** JSON `{logs, next_offset, complete}` where `complete` reflects whether the task is still running.
- **Where it runs:** stdio mode → `GET /api/task-logs` over `LORE_API_URL`; GKE mode → direct GCS read of `{repo}/{task_id}/output.log`. `Task not found: {id}` for an unknown id.
- **Cache/mutation:** read-only. Proxy path caches **only once the task is complete** (TTL 86400s), so live polls always hit fresh bytes.

#### `lore_get_job_logs`

One-line purpose: fetch the FULL stdout/stderr of one scheduled batch/CronJob RUN.

- **When to use:** scheduled jobs like `context_reindex` or `spec_test_linker`.
- **When not to use:** for a user-created pipeline task's logs use `lore_get_task_logs` (by task UUID).

| Parameter | Required | Default | Description |
|---|---|---|---|
| `job_name` | yes | — | Name of the scheduled job (e.g. `context_reindex`, `spec_test_linker`). |
| `run_id` | yes | — | UUID of the specific run, from `pipeline.job_runs.id`. |

- **Returns:** JSON `{logs, complete:true}` — the whole body, no offset slicing (runs are bounded). A missing object returns empty logs.
- **Where it runs:** stdio mode → cached `GET /api/job-run-logs` over `LORE_API_URL`; GKE mode → direct GCS read of `__job_runs__/{job_name}/{run_id}/output.log`.
- **Cache/mutation:** read-only. Proxy path cached (TTL 86400s) only when the run is complete.

#### `lore_list_pending_tasks`

One-line purpose: show unclaimed `pending` backlog tasks you could pick up and run locally, grouped by repo.

- **When to use:** the "what can I grab" view before the GKE agent takes them.
- **When not to use:** general status-filterable listing → `lore_list_pipeline_tasks`; dependency-ready spec-tasks → `lore_ready_tasks`. After choosing one, run it with `lore_claim_and_run_locally`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | no | all | Filter the API view to one repo as `owner/repo`. |

- **Returns:** one short line per task, grouped by repo; `No pending tasks…` when empty.
- **Where it runs:** prefers a live `GET /api/tasks?status=pending` over `LORE_API_URL`; when the API is unconfigured/unreachable it falls back to the locally-cached `~/.lore/pending-tasks.json` (the local fallback **ignores** the `repo` filter).
- **Cache/mutation:** read-only.

#### `lore_skip_task`

One-line purpose: dismiss one pending-task notification LOCALLY.

- **When to use:** stop a pending task from showing in your statusline so GKE picks it up after its grace period.
- **When not to use:** cancel server-side → `lore_cancel_task`; mark a claimed spec-task done → `lore_complete_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | Id of the pending task to remove from the local notification cache (as shown by `lore_list_pending_tasks`). |

- **Returns:** a skip-confirmation message. Does NOT change server state — the task stays `pending`.
- **Where it runs:** entirely in the local sandbox: no network, no DB, no API.
- **Cache/mutation:** mutates the local `~/.lore/pending-tasks.json` cache file only.

#### `lore_enable_task_notifications`

One-line purpose: start a local 30s background poller that surfaces new `pending` tasks for watched repos/types.

- **When to use:** let new pending tasks appear in your statusline so you can choose to run one locally instead of waiting for GKE.
- **When not to use:** to actually run a surfaced task use `lore_claim_and_run_locally`; to dismiss one use `lore_skip_task`; to stop the poller use `lore_disable_task_notifications`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repos` | no | current repo | List of repos to watch, each `owner/repo`. Defaults to the git-remote-detected repo. |
| `task_types` | no | `['implementation','general','runbook','gap-fill']` | List of task types to surface. |

- **Returns:** a watching-confirmation message; `already active` (without spawning a second interval) when a notifier is already running.
- **Where it runs:** local sandbox; starts a `setInterval` and writes the local cache file (the poll itself reads the API or DB).
- **Cache/mutation:** read-only w.r.t. tasks (never claims/mutates them); writes local notifier state.

#### `lore_disable_task_notifications`

One-line purpose: stop the local pending-task notifier and clear its cache.

- **When to use:** undo `lore_enable_task_notifications`.
- **When not to use:** n/a — idempotent; safe to call when none is running.

| Parameter | Required | Default | Description |
|---|---|---|---|
| _(none)_ | — | — | Takes no parameters. |

- **Returns:** `Task notifications stopped.`
- **Where it runs:** local sandbox; no network, no DB.
- **Cache/mutation:** clears the polling interval and unlinks `~/.lore/pending-tasks.json`.

### Local runner

> All local-runner tools run only in a trusted local sandbox and operate on the `~/.lore/local-tasks.json` registry / git worktrees on YOUR machine. They use your local Claude subscription (zero API cost).

#### `lore_run_task_locally`

One-line purpose: start a BRAND-NEW ad-hoc task running now as a detached background Claude Code process in an isolated worktree.

- **When to use:** YOU supply a free-text description for new work.
- **When not to use:** run an EXISTING pending task by id → `lore_claim_and_run_locally`; register a server-side task without running locally → `lore_create_pipeline_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `description` | yes | — | Free-text instruction for what to implement/do. If it references an `owner/repo` other than the current repo, the call is refused with a wrong-repo warning. |
| `task_type` | no | `implementation` | One of `implementation`, `general`, `runbook`, `gap-fill`. |
| `model` | no | runner default | Anthropic model id override; falls back to the configured default, then `claude-sonnet-4-6`. |

- **Returns:** immediately with the task id, branch name, worktree path, log file path, and PID. The background process later validates, commits, pushes, and opens a PR.
- **Where it runs:** local sandbox at a git repo with a GitHub origin; the detected repo must match the task (else not-in-a-repo or wrong-repo warning, no worktree created). When `LORE_API_URL` + `LORE_INGEST_TOKEN` are set it first `POST /api/task` to register a server-side pipeline task and adopt its id.
- **Cache/mutation:** spawns a background process + git worktree; registers a server-side task when the API is configured.

#### `lore_claim_and_run_locally`

One-line purpose: claim an EXISTING pending pipeline task by id and run it on YOUR machine.

- **When to use:** pick up a pre-existing pending task surfaced by `lore_list_pending_tasks`.
- **When not to use:** start a brand-new task from free text → `lore_run_task_locally`; register for the GKE agent → `lore_create_pipeline_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | Id of the pending task; matched by exact id or unique id-prefix; must be `pending`. |
| `model` | no | runner default | Anthropic model id override (for non-`ingest-*` types). |

- **Returns:** for `ingest-*` types, runs in-process with zero LLM and no worktree (returns the ingest result); all other types spawn a detached background worktree task and return a "Claimed and running locally" report (task id, branch, log file, PID). Not-found message when the id is unknown or not pending.
- **Where it runs:** trusted local sandbox. Resolves from the local pending cache, or `GET /api/task/<id>` on a miss (adopted only if still `pending`); best-effort claims via `POST /api/task`.
- **Cache/mutation:** claims the task, removes it from the local pending list; may spawn a background process + worktree.

#### `lore_list_local_tasks`

One-line purpose: list every background task tracked on YOUR machine — running, completed, or failed.

- **When to use:** status of locally-spawned worktree tasks (PIDs, branches, PR URLs).
- **When not to use:** server-side pipeline tasks → `lore_list_pipeline_tasks`; unclaimed pickups → `lore_list_pending_tasks`; dependency-ready spec-tasks → `lore_ready_tasks`; group rollup → `lore_list_task_group`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| _(none)_ | — | — | Takes no input. |

- **Returns:** one line per task — `<8-char id> <status> <repo> <branch>` plus ` → <prUrl>` when a PR opened and ` ✗ <error>` when failed; `No local tasks.` when none.
- **Where it runs:** reads the local `~/.lore/local-tasks.json`; reconciles any `running` row whose PID is dead to `failed` before printing. No DB, no network, no cache.
- **Cache/mutation:** read (with the dead-PID reconciliation side effect).

#### `lore_cancel_local_task`

One-line purpose: stop a task running in a background worktree on YOUR machine.

- **When to use:** locally-spawned tasks from `lore_run_task_locally` / `lore_claim_and_run_locally`.
- **When not to use:** to cancel a SERVER-SIDE pipeline task by UUID use `lore_cancel_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | Local task id (from `lore_run_task_locally` or `lore_list_local_tasks`); must be in `running` status. |

- **Returns:** `Task <id> cancelled. Worktree cleaned up.` on success, or `Could not cancel: <reason>` when the id is unknown or not running.
- **Where it runs:** local registry and worktrees only — no shared DB.
- **Cache/mutation:** SIGTERMs the process, marks the local row `failed` (`Cancelled by user`), force-removes the worktree, and fire-and-forget updates the server-side task to `cancelled`.

#### `lore_configure_local_runner`

One-line purpose: view or update the local task-runner config (`~/.lore/local-runner.json`).

- **When to use:** govern which repos/task-types the local notifier watches and local concurrency/model bounds.
- **When not to use:** to actually run work use `lore_run_task_locally` (new) or `lore_claim_and_run_locally` (existing). No meaning on the shared GKE server.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `max_concurrent` | no | keep / `2` | Max local background tasks at once (positive integer). A `0` is ignored. |
| `repos` | no | keep | Allowlist of `owner/repo` slugs the notifier watches; replaces the whole list when provided. |
| `task_types` | no | keep | Allowlist of task-type names eligible to run locally; replaces the whole list. |
| `model` | no | keep / `claude-sonnet-4-6` | Default Anthropic model id for locally-run tasks. |

- **Returns:** the resulting config as pretty JSON. Called with no update args (or only `max_concurrent: 0`) it is read-only and returns the current config (built-in defaults — `enabled:false`, `max_concurrent:2`, the four standard task_types, model `claude-sonnet-4-6` — when the file is absent).
- **Where it runs:** local machine; no DB, no network.
- **Cache/mutation:** overwrites only the provided fields and persists.

### Spec-trace

> The trace graph is (re)built out of band — by the repo's CI ingest workflow and by
> `lore_ingest_files` for on-demand doc ingestion — not by an MCP tool. The tools below
> only READ the graph or run tests locally.

#### `lore-query-trace`

One-line purpose: query the spec-traceability graph for a spec — which statements are validated/implemented/decided by what, and which are drifted or violated.

- **When to use:** READ a spec's coverage and needs-attention from the already-built main-branch graph.
- **When not to use:** enumerate/run tests locally → `lore_list_tests` / `lore_run_test`. (The graph is (re)built by CI ingest / `lore_ingest_files`, not by an MCP tool.)

| Parameter | Required | Default | Description |
|---|---|---|---|
| `spec` | yes | — | Spec file path (e.g. `specs/auth/spec.md`). |
| `statement` | no | summary | Focus one statement: its ordinal (e.g. `3`) or a text substring. Omit for a coverage + needs-attention summary. |
| `repo` | no | current repo | `owner/repo`. |

- **Returns:** a formatted text report of coverage and validated_by/violated for the spec.
- **Where it runs:** reads the main-branch graph via the Lore API (`proxyGetApi`).
- **Cache/mutation:** read-only. Uses a 600s read-through cache. (Note: this tool keeps the legacy hyphenated name.)

#### `lore_list_tests`

One-line purpose: enumerate the current repo's tests by running its declared `list` command from `.lore/test-commands.yml` in your local checkout.

- **When to use:** discover what tests exist and their selectors before executing one.
- **When not to use:** run a single test → `lore_run_test`; read already-computed coverage without execution → `lore-query-trace`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| _(none)_ | — | — | Takes no input (repo root and manifest auto-resolved from the cwd's git toplevel). |

- **Returns:** a JSON array of descriptors `{id, name, file, startLine?, endLine?, suite?, spec?}` where `id` is the runner-native selector for `lore_run_test`; file paths are repo-relative (the manifest's `path_prefix_strip` is removed). `No test-command manifest declared for this repo.` when absent.
- **Where it runs:** **local sandbox only.** Executes an arbitrary shell command in the manifest's `cwd` subdir. On the shared cluster server (`LORE_DB_HOST` set) it **refuses** and returns "Test commands run only in a trusted sandbox — run in CI or locally." No DB, no network, no writes.
- **Cache/mutation:** read-only (executes the list command).

#### `lore_run_test`

One-line purpose: run a single test by its runner-native selector and report the code it covers.

- **When to use:** run ONE test and learn what it covers.
- **When not to use:** discover available tests/selectors → `lore_list_tests`; read coverage without running → `lore-query-trace`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `selector` | yes | — | Runner-native test id (from an `id` in `lore_list_tests` output) substituted at the manifest run command's `{selector}` placeholder. Runner-specific (e.g. pytest `tests/test_api.py::TestAuth::test_login`, vitest `src/auth.test.ts > logs in`, Go `TestLogin`). |

- **Returns:** JSON `{passed: boolean, covered: [{file, startLine, endLine}]}`. Covered paths are repo-relative. `No test-command manifest declared for this repo.` when absent.
- **Where it runs:** **local sandbox only.** Executes an arbitrary shell command in the manifest's `cwd` subdir. On the shared cluster server (`LORE_DB_HOST` set) it **refuses** with the same trusted-sandbox message. No DB, no network, no writes.
- **Cache/mutation:** read-only (executes the run command).

### Repos

#### `lore_list_repos`

One-line purpose: list every repo onboarded into Lore, annotated with a pipeline task count.

- **When to use:** inspect the Lore deployment's repo registry and per-repo pipeline activity.
- **When not to use:** to ADD a repo → `lore_onboard_repo`; to list pipeline TASKS rather than repos → `lore_list_pipeline_tasks`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| _(none)_ | — | — | Takes no parameters. |

- **Returns:** a JSON array of `lore.repos` rows (`id, owner, name, full_name, team, onboarded_at, last_ingested_at, onboarding_pr_url, onboarding_pr_merged, settings`) each annotated with an integer `task_count`, ordered newest-onboarded first. Guidance text when the DB is unset or no repos exist.
- **Where it runs:** **direct Postgres only** (`LORE_DB_HOST`); does not proxy over `LORE_API_URL`; unavailable in local stdio mode without a DB.
- **Cache/mutation:** read-only, not cached.

#### `lore_onboard_repo`

One-line purpose: onboard a GitHub repo into Lore (registry upsert + spawn an `onboard` task).

- **When to use:** register a brand-new repo with Lore.
- **When not to use:** to LIST already-onboarded repos → `lore_list_repos`; to push specific files into an onboarded repo's context store → `lore_ingest_files`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `full_name` | yes | — | Target repo in `owner/repo` format; both segments must be non-empty or it returns a malformed-name error. |

- **Returns:** JSON `{repo_id, task_id, status: 'onboarding-agent-spawned'}`. The branch + CLAUDE.md/AGENTS.md/PR-template files and the onboarding PR are authored later by the spawned agent task, NOT synchronously.
- **Where it runs:** **direct Postgres only** (`LORE_DB_HOST`); does not proxy over `LORE_API_URL`.
- **Cache/mutation:** WRITE. Upserts `lore.repos` (re-onboarding refreshes `onboarded_at`) and inserts an `onboard` task into `pipeline.tasks`.

#### `lore_ingest_files`

One-line purpose: fetch specific repo files from GitHub, embed them, and write them into Lore's context store on demand.

- **When to use:** right after merging an important file (a new ADR, an updated CLAUDE.md) to make it searchable now without waiting for nightly ingestion.
- **When not to use:** onboarding a repo → `lore_onboard_repo`; reading/searching content → `lore_search_context` / `lore_assemble_context`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `files` | yes | — | Repo-relative file paths to ingest, each resolved against the repo's commit/default branch (e.g. `["CLAUDE.md", "adrs/ADR-001.md", "src/auth.ts"]`). |
| `repo` | no | auto-detect | Target repo `owner/repo`; auto-detected from the cwd's git remote; fails with a detect-repo message if detection returns nothing. |

- **Returns:** `Ingested N files into Lore for <repo>. M errors.`
- **Where it runs:** runs locally in stdio mode and **proxies the embed work** to the GKE `/api/ingest` route over `LORE_API_URL` (requires `LORE_INGEST_TOKEN`); does not touch Postgres in this process. The ingested commit is local `HEAD` only when the resolved repo matches the cwd repo; otherwise GitHub's default branch is used.
- **Cache/mutation:** WRITE (the GKE route owns chunking + Vertex embedding + chunk inserts). Invalidates the `lore_assemble_context` read cache for the repo.

### Usage & analytics

#### `lore_my_usage`

One-line purpose: report the CALLING agent's own task count and token totals across three windows.

- **When to use:** "how much have I personally run/spent lately."
- **When not to use:** for an ORG-WIDE pulse (throughput, success/fail, per-type) use `lore_get_analytics` — this tool is single-agent only and reports no success rates or per-type counts.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `agent_id` | no | auto-detect | Agent whose usage to report (e.g. `loredana@re-cinq.com` or a UUID); auto-detected via `resolveAgentId`. Pass only to inspect a different agent than the caller's own. |

- **Returns:** JSON `{agent_id, usage: {today, 7_day, 30_day}}` where each window is `{tasks, input_tokens, output_tokens}`; tokens come from `pipeline.llm_calls` joined to that agent's `pipeline.tasks`.
- **Where it runs:** **direct Postgres only** (`LORE_DB_HOST`); does not proxy over `LORE_API_URL`.
- **Cache/mutation:** read-only.

#### `lore_get_analytics`

One-line purpose: return ORG-WIDE pipeline analytics for one fixed window.

- **When to use:** a team-wide pulse (throughput, success rate, token spend, task-type mix) across ALL agents.
- **When not to use:** for a SINGLE agent's footprint use `lore_my_usage` — this tool is not per-agent and does not filter by caller.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `period` | no | `month` | Window for the `created_at` filter: `today` (since current_date), `week` (start of ISO week), `month` (start of calendar month), `all` (no time filter). |

- **Returns:** JSON `{period, usage: {llm_calls, input_tokens, output_tokens}, tasks: {total, succeeded, failed}, by_type: [{task_type, tasks}]}`. `succeeded` = status `pr-created` or `merged`; `failed` = status `failed`. Note: `by_type[].tasks` comes back as a numeric STRING (raw pg bigint, not coerced).
- **Where it runs:** **direct Postgres only** (`LORE_DB_HOST`); does not proxy over `LORE_API_URL`.
- **Cache/mutation:** read-only.

---

## Choosing between similar tools

Quick-reference for the confusable clusters.

### Context & knowledge retrieval

| Use | Tool |
|---|---|
| Starting a task — ONE token-budgeted bundle (conventions, ADRs, memories, facts, graph) ordered by template. Mandatory first call; prefer over hand-assembling. | `lore_assemble_context` |
| Raw matching passages from ingested docs (chunk-level evidence, specific wording) — source-scored snippets, not a synthesized bundle. | `lore_search_context` |
| Past learnings, decisions, corrections, and extracted facts from prior sessions across the org — "has this been solved/observed before". | `lore_search_memory` |
| Structured entity relationships (X uses/owns/depends-on/replaced-by Y) — traverse who-touches-what, not passages. | `lore_query_graph` |

### Knowledge capture

| Use | Tool |
|---|---|
| A curated, addressable nugget retrievable by a key YOU choose — decision, convention, correction, session summary. Canonical stored value. | `lore_write_memory` |
| Raw, uncurated text (conversation turn, review, observation) for passive storage + auto fact/edge extraction. No key, dedup by content hash; bulk capture. | `lore_write_episode` |

### Listing tasks

| Use | Tool |
|---|---|
| General, status-filterable listing of ALL pipeline tasks newest-first. The default browse view. | `lore_list_pipeline_tasks` |
| Unclaimed pending tasks across repos you could pick up and run locally, grouped by repo. The "what can I grab" view. | `lore_list_pending_tasks` |
| Spec-tasks for one repo whose dependencies are satisfied (ready to claim). Dependency-aware, not status-aware. | `lore_ready_tasks` |
| Every task sharing a `group_id` with a completed/total rollup. Scoped to a single group. | `lore_list_task_group` |
| Background tasks running on YOUR machine (worktrees/PIDs/PR URLs), not server-side. | `lore_list_local_tasks` |

### Log retrieval

| Use | Tool |
|---|---|
| Execution output of a specific pipeline TASK (by task UUID), with byte-offset polling for a still-running task. | `lore_get_task_logs` |
| Full output of a scheduled batch/CronJob RUN (by `job_name` + `run_id`), e.g. `context_reindex` or `spec_test_linker`. | `lore_get_job_logs` |

### Running work

| Use | Tool |
|---|---|
| Register a NEW task for the server side — backlog by default, or `priority=immediate` for the GKE agent. Runs nothing on your machine. | `lore_create_pipeline_task` |
| Start a BRAND-NEW ad-hoc task running now in a background worktree on your machine (you supply the description; also registers a pipeline task). | `lore_run_task_locally` |
| An EXISTING pending pipeline task already exists — claim it (by `task_id`) and run it locally. | `lore_claim_and_run_locally` |

### Spec-task coordination lifecycle

| Use | Tool |
|---|---|
| START — materialize a `tasks.md`'s spec-tasks (with dependencies) into the pipeline DB. One-time per spec, before any claiming. | `lore_sync_tasks` |
| About to WORK a specific spec-task — atomically lock it so no other agent takes it. Server-side DB lock. | `lore_claim_task` |
| FINISHED a claimed/running spec-task — mark it done and unblock its dependents. Server-side DB state transition. | `lore_complete_task` |
| See a pending-task NOTIFICATION locally — dismiss it so GKE handles it instead. Local-only notification dismissal, not a server completion. | `lore_skip_task` |

### Spec-traceability

| Use | Tool |
|---|---|
| READ a spec's coverage/needs-attention from the already-built main-branch graph. Read path over the API. | `lore-query-trace` |
| Enumerate the repo's tests via its manifest in your local checkout. Local-only; refused on the shared cluster. | `lore_list_tests` |
| Execute ONE test by selector and see what code it covers. Local-only; refused on the shared cluster. | `lore_run_test` |

### Cancellation

| Use | Tool |
|---|---|
| Cancel a SERVER-SIDE pipeline task by UUID (DB-backed, may stop a running GKE agent). | `lore_cancel_task` |
| Stop a task running in a background worktree on YOUR machine and clean up the worktree. | `lore_cancel_local_task` |
