# Lore MCP Tool Reference

This is the authoritative, per-tool reference for every tool exposed by the Lore MCP server: exact parameters, return shapes, where each tool runs, and how to disambiguate the confusable ones. It is generated from the tool registrations under `apps/mcp-server/src/transport/tools/` and is precise rather than friendly.

For a non-engineer, plain-language overview of what these tools are for, read the companion guide: [`docs/mcp-tools.md`](./mcp-tools.md). This document is the precise reference; that one is the gentle introduction.

---

## MCP server structure

**Local stdio adapter.** The shipped MCP server (`@re-cinq/lore-mcp`, [`apps/mcp-server`](../apps/mcp-server/README.md)) runs on the developer's machine over **stdio**, registered by `scripts/install.sh`. It holds no database pool: it auto-detects the current repo from the git remote and **proxies** operations to the shared backend over `LORE_API_URL` (bearer `LORE_INGEST_TOKEN`). Proxied reads pass through a read-through cache (`platform/proxy-cache.ts`); writes invalidate the caches they affect. The remote backend it talks to is [`@re-cinq/lore-api`](../apps/lore-api/README.md), a plain REST service that owns the direct PostgreSQL + pgvector access behind `/api/*` (ADR-032).

**One code path per handler.** The adapter holds no database pool — not in stdio mode, not in the HTTP gateway — so every data operation is an HTTP call to `LORE_API_URL` (bearer `LORE_INGEST_TOKEN`). A `~/.lore` file fallback exists for a subset of memory tools, and only when no API is configured at all. Handlers that used to carry a second, direct-DB branch no longer do: that branch was unreachable after the ADR-032 split, which is what made ten tools answer "requires PostgreSQL (LORE_DB_HOST not set)" on every call. The per-tool "Where it runs" notes below name the endpoint each tool calls.

**How tools register.** Each category lives in one file and exposes a `registerXTools(server, deps)` function called at startup. Inside, every tool is declared with:

```
server.tool(name, description, zodShape, handler)
```

The `description` is the long, self-disambiguating text an LLM reads to choose the tool; the `zodShape` is the parameter schema (each field carries a `.describe()` used verbatim below); the `handler` returns the result.

**ToolDeps / lazy `getPool`.** Every register function receives a `ToolDeps` object whose only member is `getPool()` — a lazy accessor for the pg pool. The pool is created in `main()` *after* tool registration, so handlers must call `getPool()` at invocation time rather than capturing a snapshot (`apps/mcp-server/src/transport/tools/shared/deps.ts`).

**Never-throw text-envelope contract.** No tool throws. Every handler wraps its body and returns `{ content: [{ type: "text", text }] }` — success payloads (usually JSON) and errors alike come back as text. Callers parse the text; they never catch exceptions.

**Bearer auth on `/api/*`.** Every HTTP API route the proxy targets enforces bearer-token validation before dispatch (`LORE_INGEST_TOKEN` full-access, or a scoped token from `pipeline.api_tokens`). The proxy helpers (`proxyToApi` / `proxyGetApi` / `proxyMemory` in `deps.ts`) attach the token, retry retriable statuses (`408/429/5xx`) with backoff `[200, 600, 1800]ms`, and classify outcomes as `ok` / `not_configured` / `unreachable` / `denied`. A `denied` (401/403) is never served from stale cache; an `unreachable` outage may fall back to a stale cached copy. `unreachable` and `denied` are surfaced as explicit error text (`unreachableError` / `deniedError`) rather than silently writing local state that would diverge from the org-wide DB.

**Local trust boundary.** Tools that execute arbitrary shell in your checkout — `lore_list_tests`, `lore_run_test` — run only in a trusted sandbox (dev machine, CI, or an agent pod on the ai-agent-subsystem). On the shared cluster server (`LORE_DB_HOST` set) the spec-trace local tools refuse and return *"Test commands run only in a trusted sandbox — run in CI or locally."*

---

## Naming convention

Every tool is namespaced with the **`lore_` prefix** (Anthropic-recommended namespacing) so it never collides with tools from other MCP servers a developer may have connected. Tools are grouped by category — Context & knowledge, Memory, Task pipeline, Local runner, Spec-trace, Repos, Usage & analytics — and that grouping is the structure of the reference below. (One legacy tool, `lore-query-trace`, predates the underscore convention and keeps a hyphen.)

---

## Tool reference

30 tools across seven categories. For each: purpose, when to use / not use, parameters (only what the zod shape actually declares), return shape, where it runs, and cache/mutation notes.

### Context & knowledge

#### `lore_assemble_context`

One-line purpose: assemble ONE context block for a task. Under `backend: "lore-v2"` the block is built from the task's own questions over Lore's stores: a repo primer, key facts with their sources, where to look, and previous work (issues, pull requests, sessions), with the repositories it depends on read beside it. Every other backend, and a `lore-v2` call when the API has no model for the `context` use or the builder fails, gets the template assembly (conventions, ADRs, memories, facts, episodes, graph in a template's order).

- **When to use:** the mandatory first call when starting a task — you want a single synthesized briefing rather than hand-stitching the narrower retrieval tools.
- **When not to use:** for raw matching passages / exact wording use `lore_search_context`; for past learnings and facts use `lore_search_memory`; for entity relationships use `lore_query_graph`. Those three are the building blocks this tool already combines.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `query` | yes | — | Natural-language description of the context needed (e.g. `implement auth middleware`, `review PR #42`). Drives retrieval and ranking across all sources. |
| `template` | no | `default` | Chooses the template assembly's section order; ignored under `lore-v2`. |
| `max_tokens` | no | `8000` | Caps the block's length (the builder writes at most 900 words, fewer under a smaller budget); floor 2000. |
| `repo` | no | auto-detect | Target repo as `owner/repo`; auto-detected from the git remote when omitted. |
| `agent_id` | no | ambient | Overrides the agent id used to scope memories/facts. **Direct-DB path only; ignored when proxying.** |
| `cross_repo` | no | `false` | Also pull context from linked repos. If `false` but the repo's `settings.cross_repo` is true, cross-repo is still enabled. **Direct-DB path only; ignored when proxying.** |
| `backend` | no | repo's `settings.context_backend`, then `utopia` | `lore-v2` runs the context builder over Lore's stores. `utopia` (default), `lore`, or `both` — compare Lore's stores with Utopia; Utopia sources fill in as their readers land. Under `utopia` each section reads `<source>: no Utopia reader yet`; under `both` Lore's block comes first and Utopia's second, each on half the budget (ADR-052 amendment 2026-10-16). |

- **Returns:** from the context builder, a markdown block with the sections `Repo primer`, `Key facts` (answered questions with sources, then one `Unanswered:` line), `Where to look` and `Previous work`. From the template assembly: on the direct-DB path, a single text block prefixed with an HTML comment carrying `template/sections/tokens` metadata; `No relevant context found for this query.` when every source is empty. On the proxy path, the API text as-is (no metadata comment), optionally prefixed with a `<!-- lore-cache: HIT/STALE -->` marker.
- **Where it runs:** direct Postgres when `LORE_DB_HOST` is set; otherwise proxies `GET /api/context` to `LORE_API_URL`.
- **Cache/mutation:** read-only. Proxy path uses a 600s read-through cache. Records a latency row via `trackLatency`. On the proxy path `query`, `template`, `repo`, `max_tokens`, `cross_repo`, `agent_id` and `backend` are forwarded.

#### `lore_search_context`

One-line purpose: search the ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and return the raw matching passages as source-scored snippets.

- **When to use:** you want chunk-level evidence or the exact wording of a convention/ADR that lives in ingested docs.
- **When not to use:** for one token-budgeted startup bundle use `lore_assemble_context` (the mandatory first call); for prior-session learnings/facts use `lore_search_memory`; for entity relationships use `lore_query_graph`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `query` | yes | — | Natural-language search query (e.g. `how are pipeline tasks authenticated`). |
| `team` | no | `org_shared` | Scope: a Postgres team schema name; an empty/no-result team transparently retries `org_shared`. Omit to search org-wide. |
| `limit` | no | `8` | Maximum number of passages to return. |
| `backend` | no | `lore` | `lore`, `utopia`, or `both`. Sent to `GET /api/search-context`; `utopia` returns no passages and the note `search_context: no Utopia reader yet`, `both` Lore's passages and that note. Without an API, `utopia`/`both` are refused rather than answered from local files. |

- **Returns:** one text block; each hit is `**Score:** <rrf>` (DB path) or `**Source:** <relative-path>` (file path) followed by the passage, joined by `---`; or a no-results message.
- **Where it runs:** always through `GET /api/search-context` (hybrid vector + BM25 fused by Reciprocal Rank Fusion, server-side). With no `LORE_API_URL` it says so; there is no local file scan.
- **Cache/mutation:** read-only, not cached.

### Memory

#### `lore_write_memory`

One-line purpose: store one curated, addressable key/value memory scoped to the repo the call names (or the one detected on a laptop), else to `agent_id`.

- **When to use:** you have a nugget to retrieve later by a key YOU choose — a decision, convention, correction, or session summary.
- **When not to use:** for raw uncurated text you want passively stored with auto fact-extraction and no chosen key, use `lore_write_episode`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `key` | yes | — | Caller-chosen retrieval key, slash-namespaced by convention (e.g. `auth-pattern`, `session-summary/2026-03-30`). |
| `value` | yes | — | The memory text; this exact string is the canonical stored value and is embedded for semantic search. |
| `agent_id` | no | ambient | Override the resolved agent ID for this write. |
| `repo` | no | auto-detect on a laptop | Repo the memory is scoped to, as `owner/repo`. Detected from the git remote only on a laptop; the shared agent gateway has no checkout, so there only a named `repo` scopes the memory and an omitted one writes an agent-scoped memory. A value that is not owner/name is rejected before any API call. |
| `ttl` | no | none | Time-to-live in seconds; sets `expires_at`. Omit for a permanent memory. |
| `extract_facts` | no | `false` | When true, fire async fact extraction from `value` (fire-and-forget; does not block). |

- **Returns:** the write result `{key, version, agent_id, created_at}`.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else proxies to `/api/memory` (write scope); `~/.lore` file fallback only when no API is configured.
- **Cache/mutation:** WRITE. Versioned (a repeat key bumps version, never overwrites). Embeds the value and invalidates memory-derived read caches (`lore_search_memory`, `lore_read_memory`, `lore_list_memories`, `lore_assemble_context`). Repo-scoped memories (an explicit `repo`, or the repo detected on a laptop) are shared org-wide with everyone in the same repo; no-repo memories are agent-scoped.

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
- **When not to use:** to cancel a server-side pipeline task use `lore_cancel_task` (unrelated).

| Parameter | Required | Default | Description |
|---|---|---|---|
| `key` | yes | — | Exact memory key to soft-delete. |
| `agent_id` | no | ambient | Override the resolved agent ID; deletion is scoped to this agent and key. |

- **Returns:** `{key, deleted: true}`.
- **Where it runs:** local DB when `LORE_DB_HOST` is set; else proxies to `/api/memory` (write scope); `~/.lore` file fallback when no API is configured.
- **Cache/mutation:** WRITE. Soft-delete flips `is_deleted` on every version row of that agent+key (history kept; not a hard purge, no restore here). Scope is `agent_id`, NOT repo. Invalidates memory-derived read caches.

#### `lore_list_memories`

One-line purpose: list memory keys for a repo, newest-first and paginated.

- **When to use:** browse what memories exist by key without ranking.
- **When not to use:** find by meaning → `lore_search_memory`; fetch one value → `lore_read_memory`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | gateway: yes; laptop: no | auto-detect on a laptop | Repo to list, as `owner/repo`. Detected from the git remote only on a laptop; the shared agent gateway has no checkout and answers "No repo given" when it is omitted. A value that is not owner/name is rejected before any API call. |
| `agent_id` | no | — | Scope to one agent when no repo is given or detected (ignored when one is — repo scope wins). |
| `limit` | no | `50` | Maximum number of memories to return. |
| `offset` | no | `0` | Rows to skip for pagination. **DB path only; not forwarded over the proxy.** |

- **Returns:** `{memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}`. Expired and soft-deleted memories are excluded. Scope precedence: the given or detected repo, then `agent_id`, then org-wide.
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
| `repo` | no | detected | `owner/repo` whose Utopia memory base is searched beside the org's. Detected from the git remote on a laptop; the shared gateway searches org-wide when it is omitted. |
| `backend` | no | repo setting, then `utopia` | `lore`, `utopia`, or `both`. `utopia` answers `{results, notes}` from the mirrored memories and episodes (each hit carries `backend: utopia`), or the `search_memory: no Utopia reader yet` note when the deployment cannot read Utopia or no base holds a memory source; `both` adds Lore's hits labelled `lore` first. Without an API, `utopia`/`both` are refused rather than answered from the `~/.lore` file store. |

- **Returns:** `{results: [...]}`, a relevance-ranked list of `{key, value, score, agent_id, source, id?, confidence?}` where `source` is `memory|fact|episode|graph`; only currently-valid facts unless `include_invalidated`. With `utopia` or `both` the answer also carries `notes`, and each hit carries `backend: lore|utopia`; Utopia's hits are memories and episodes only (no facts, pools, `include_invalidated` or `graph_augment`). The adapter wraps the API's bare list for a `lore` search in `{results}`.
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
- **Where it runs:** proxies `GET /api/agent-stats` (read scope) over `LORE_API_URL`; the `memory.*` aggregation runs in lore-api. No file fallback.
- **Cache/mutation:** read-only.

### Task pipeline

#### `lore_get_pipeline_status`

One-line purpose: return one pipeline task's full record by UUID — current status plus the ordered event timeline.

- **When to use:** check where a specific delegated task stands.
- **When not to use:** multi-task listing → `lore_list_pipeline_tasks`; live GitHub PR/CI state → `lore_get_pr_status`; execution transcript → `lore_get_task_logs`; group rollup → `lore_list_task_group`.

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

#### `lore_get_ci_failures`

One-line purpose: what CI said about a branch — the judged sha, the verdict, and every failed check with its annotations (`path:line message`), failed steps, and log tail.

- **When to use:** before reproducing any build. CI already ran it; a pod on a red branch reads the verdict here instead of `npm ci` + the suite.
- **When not to use:** for more of one job's log use `lore_get_ci_job_log`; for the pull request's review state use `lore_get_pr_status`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | gateway: yes; laptop: no | git remote of the cwd (laptop) | Repository as `owner/name`; required on the shared agent gateway, which has no checkout. |
| `branch` | no | checked-out branch of the cwd | Branch to report on. A pod has no checkout, so it passes `branch` (the output of `git branch --show-current`) or `pr_number`. |
| `pr_number` | no | — | Alternative to `branch`: the pull request whose head branch to report on. |

- **Returns:** JSON `{branch, judged_sha, conclusion, failures[]}`; each failure is `{name, app, job_id, annotations[], steps[], tail[], npm_script, unreadable[]}`; `unreadable` names the reads GitHub refused as `what (status)` (e.g. `log (403)` when the GitHub App lacks Actions read), so an empty part beside an entry there was not readable rather than silent; `npm_script` is `{package, script}` when the failed step ran through npm — reproduce it as `npm run <script> -w <package>`, never at the repo root. `conclusion` is `success | failure | pending | none`; `judged_sha` is the newest commit not marked `[skip ci]`.
- **Where it runs:** `GET /api/repos/:o/:r/ci-failures` over `LORE_API_URL`; lore-api reads GitHub with its App credential — no token in the caller.
- **Cache/mutation:** read-only.

#### `lore_get_ci_job_log`

One-line purpose: the tail of one GitHub Actions job's log, timestamps stripped, optionally filtered.

- **When to use:** a failure from `lore_get_ci_failures` needs more than its annotations and tail.
- **When not to use:** never to re-run the job locally; the log is what it printed.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | gateway: yes; laptop: no | git remote of the cwd (laptop) | Repository as `owner/name`; required on the shared agent gateway, which has no checkout. |
| `job_id` | yes | — | The `job_id` of a failure reported by `lore_get_ci_failures`. |
| `tail` | no | 200 | Last N lines to return, max 2000. |
| `grep` | no | — | Case-insensitive substring; only matching lines are kept, before the tail is taken. |

- **Returns:** JSON `{job_id, lines[], total, truncated}` — `total` counts the lines the filter kept.
- **Where it runs:** `GET /api/repos/:o/:r/ci-jobs/:job_id/log` over `LORE_API_URL`.
- **Cache/mutation:** read-only.

#### `lore_list_pipeline_tasks`

One-line purpose: list pipeline tasks newest-first, optionally filtered to one status. The general browse view.

- **When to use:** browse across ALL tasks and statuses.
- **When not to use:** one feature's group → `lore_list_task_group`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `status` | no | all | Filter to one status; DB mode validates against `pending`, `queued`, `running`, `pr-created`, `review`, `merged`, `failed`, `cancelled` (invalid rejected with the list). |
| `limit` | no | `20` | Maximum number of tasks, newest-first; clamped to ≤100. |

- **Returns:** `{tasks, total}` JSON.
- **Where it runs:** direct Postgres when `LORE_DB_HOST` is set; else `GET /api/tasks` over `LORE_API_URL`.
- **Cache/mutation:** read-only, not cached.

#### `lore_cancel_task`

One-line purpose: cancel a SERVER-SIDE pipeline task by UUID.

- **When to use:** tasks tracked in the Lore pipeline (a backlog ticket, an onboarding).
- **When not to use:** to re-run a failed task → `lore_retry_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of a non-terminal task (not merged/failed/cancelled). |

- **Returns:** the new status as JSON; rejected for already merged/failed/cancelled tasks (`Cannot cancel task in {state} state`).
- **Where it runs:** proxies `POST /api/task` with `{action:"cancel"}` (task scope). The server refuses an unknown id (404) or a terminal state (409) and the refusal reaches you verbatim.
- **Cache/mutation:** WRITE. Flips to `cancelled`, best-effort stops a running GKE agent, records a `cancelled` event.

#### `lore_retry_task`

One-line purpose: re-run a failed or escalated task by cloning it into a NEW task linked via `retry_of`.

- **When to use:** give a failed task a second attempt.
- **When not to use:** to stop an unwanted live task → `lore_cancel_task`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of the original `failed` or `needs-human-help` task. |

- **Returns:** the new task `{id, status, retry_of}` as JSON. Only `failed` / `needs-human-help` tasks are retryable (others rejected, e.g. `Cannot retry task in running state`).
- **Where it runs:** proxies `POST /api/task` with `{action:"retry"}` (task scope).
- **Cache/mutation:** WRITE. Inserts a new `pipeline.tasks` row + `pending` event (re-running the trust gate) and marks the original `retried`.

#### `lore_list_task_group`

One-line purpose: list every task sharing one `task_group_id`, with a completed/total rollup.

- **When to use:** you have a `group_id` and want the whole multi-repo feature's progress.
- **When not to use:** for an unscoped newest-first listing use `lore_list_pipeline_tasks`.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `group_id` | yes | — | Task-group UUID. |

- **Returns:** a `completed/total` summary line plus rows as JSON (`id, description, task_type, status, target_repo, pr_url, created_at`); `No tasks found for group {id}` when empty.
- **Where it runs:** proxies `GET /api/task-groups/{id}` (read scope); the rollup is computed server-side.
- **Cache/mutation:** read-only.

#### `lore_get_task_logs`

One-line purpose: fetch the execution transcript of one pipeline TASK by UUID (NDJSON turn envelopes; raw captured output for tasks with no recorded turns), with code-unit-offset polling.

- **When to use:** a user-created/delegated task's logs.
- **When not to use:** for a scheduled CronJob RUN use `lore_get_job_logs` (by `job_name` + `run_id`).

| Parameter | Required | Default | Description |
|---|---|---|---|
| `task_id` | yes | — | UUID of the pipeline task whose logs to fetch. |
| `offset` | no | `0` | UTF-16 code-unit offset (not bytes) to start from; pass the previous `next_offset` to fetch only new content when polling. |

- **Returns:** JSON `{logs, next_offset, complete}`; responses may be capped, and `complete` is true only when the task has settled AND nothing remains past the returned slice — keep polling until it is true.
- **Where it runs:** stdio mode → `GET /api/task-logs` over `LORE_API_URL`; GKE mode → direct GCS read of `{repo}/{task_id}/output.log`. `Task not found: {id}` for an unknown id.
- **Cache/mutation:** read-only. Proxy path caches **only once the task is complete** (TTL 86400s), so live polls always hit fresh bytes.

#### `lore_get_job_logs`

One-line purpose: fetch the FULL stdout/stderr of one scheduled batch/CronJob RUN.

- **When to use:** scheduled jobs like `daily_digest` or `spec_upkeep`.
- **When not to use:** for a user-created pipeline task's logs use `lore_get_task_logs` (by task UUID).

| Parameter | Required | Default | Description |
|---|---|---|---|
| `job_name` | yes | — | Name of the scheduled job (e.g. `daily_digest`, `spec_upkeep`). |
| `run_id` | yes | — | UUID of the specific run, from `pipeline.job_runs.id`. |

- **Returns:** JSON `{logs, complete:true}` — the whole body, no offset slicing (runs are bounded). A missing object returns empty logs.
- **Where it runs:** stdio mode → cached `GET /api/job-run-logs` over `LORE_API_URL`; GKE mode → direct GCS read of `__job_runs__/{job_name}/{run_id}/output.log`.
- **Cache/mutation:** read-only. Proxy path cached (TTL 86400s) only when the run is complete.

### Update

#### `lore_update`

One-line purpose: rebuild the installed local MCP adapter (`~/.re-cinq/lore`) from the latest `origin/main`.

- **When to use:** only after the user consents — `lore_assemble_context` prefixes `lore_mcp_update_available` when the running adapter is behind `origin/main` (the SessionStart hook pulls the checkout but never rebuilds `dist/`).
- **When not to use:** unprompted, or on the shared gateway — the tool is not registered in `agent` server mode, and an agent pod has no checkout to rebuild.

| Parameter | Required | Default | Description |
|---|---|---|---|
| _(none)_ | — | — | Takes no input. |

- **Returns:** the updater's combined output plus `Restart Claude Code to load the rebuilt MCP.` — a running process cannot hot-swap its own code.
- **Where it runs:** local machine; runs the audited `scripts/lore-update.sh` (`git pull` + `npm ci --ignore-scripts` + build shared→server-core→mcp). No DB, no API.
- **Cache/mutation:** rewrites the installed `dist/` and the `~/.lore/mcp-build-head` marker; resets the cached update status.

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

#### `lore_next_ready_issue`

One-line purpose: preview the backlog ticket the implementation loop would start next for a repo.

- **When to use:** check what the loop will pick, or whether a repo's `backlog_ranking.criteria` setting orders the backlog the way you meant, without dispatching anything.
- **When not to use:** to start work on a ticket → label it `priority:*` and let the loop take it.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | yes | — | Target repo in `owner/repo` format. |

- **Returns:** JSON `{issue, because}`, where `because` names the repo's first ranking criterion and the issue's unblocks count, e.g. `priority (unblocks: 2)`. `{issue: null, reason}` when nothing is ready or the API is unreachable, never an error. How the queue is ranked: `docs/using-lore/developer.md`, "How the loop picks the next ticket".
- **Where it runs:** proxies `GET /api/repos/:o/:r/implementation-loop` over `LORE_API_URL`.
- **Cache/mutation:** read-only.

### Usage & analytics

#### `lore_my_usage`

One-line purpose: report the CALLING agent's own task count and token totals across three windows.

- **When to use:** "how much have I personally run/spent lately."
- **When not to use:** for an ORG-WIDE pulse (throughput, success/fail, per-type) use `lore_get_analytics` — this tool is single-agent only and reports no success rates or per-type counts.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `agent_id` | no | auto-detect | Agent whose usage to report (e.g. `loredana@re-cinq.com` or a UUID); auto-detected via `resolveAgentId`. Pass only to inspect a different agent than the caller's own. |

- **Returns:** JSON `{agent_id, usage: {today, 7_day, 30_day}}` where each window is `{tasks, input_tokens, output_tokens}`; tokens come from `pipeline.llm_calls` joined to that agent's `pipeline.tasks`.
- **Where it runs:** proxies `GET /api/usage` (read scope); the windowed SQL runs in lore-api.
- **Cache/mutation:** read-only.

#### `lore_get_analytics`

One-line purpose: return ORG-WIDE pipeline analytics for one fixed window.

- **When to use:** a team-wide pulse (throughput, success rate, token spend, task-type mix) across ALL agents.
- **When not to use:** for a SINGLE agent's footprint use `lore_my_usage` — this tool is not per-agent and does not filter by caller.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `period` | no | `month` | Window for the `created_at` filter: `today` (since current_date), `week` (start of ISO week), `month` (start of calendar month), `all` (no time filter). |

- **Returns:** JSON `{period, usage: {llm_calls, input_tokens, output_tokens}, tasks: {total, succeeded, failed}, by_type: [{task_type, tasks}]}`. `succeeded` = status `pr-created` or `merged`; `failed` = status `failed`. Note: `by_type[].tasks` comes back as a numeric STRING (raw pg bigint, not coerced).
- **Where it runs:** proxies `GET /api/analytics` (read scope); the aggregate queries run in lore-api.
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
| Every task sharing a `group_id` with a completed/total rollup. Scoped to a single group. | `lore_list_task_group` |

### Log retrieval

| Use | Tool |
|---|---|
| Execution transcript of a specific pipeline TASK (by task UUID), with code-unit-offset polling for a still-running task. | `lore_get_task_logs` |
| Full output of a scheduled batch/CronJob RUN (by `job_name` + `run_id`), e.g. `daily_digest` or `spec_upkeep`. | `lore_get_job_logs` |

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
