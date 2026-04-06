# Lore

Shared context infrastructure for Claude Code. One install command
gives developers full org awareness — conventions, ADRs, team patterns,
PR history, and task state.

## Architecture

**MCP server** (`mcp-server/src/index.ts` + `routes.ts`): TypeScript,
serves context to Claude Code via MCP protocol. Dual transport: stdio
for local (Phase 0), Streamable HTTP for GKE (Phase 1). Three core tools:
`assemble_context`, `search_context`, `search_memory`. Pipeline
delegation, local task runner, and 30+ tools total.

**Vector store**: PostgreSQL + pgvector via CloudNativePG on GKE.
Schema-per-team isolation. HNSW indexes for vector search, GIN for
BM25 keyword search. Hybrid search via Reciprocal Rank Fusion.
Embeddings from Vertex AI text-embedding-005 (768 dimensions).

**Cluster agents**: Lore Agent service on GKE processes pipeline tasks
via direct Anthropic API calls (simple tasks) or headless Claude Code
(complex tasks). Developers delegate through the Lore MCP server,
never directly.

**Observability**: OpenTelemetry traces + metrics → Cloud Monitoring.
Gap signal goes to Graphiti episodes in Phase 3.

**Task tracking**: Pipeline tasks via Lore MCP + GitHub Issues.

## Code Conventions

**TypeScript** for the MCP server. ESM modules, strict mode, ES2022
target. Zod for input validation on all MCP tools. Return errors as
text in MCP responses, never throw.

**Python** for glue scripts (lore-gen-constitution).
Keep them short (<100 lines). Handle missing tools gracefully with
clear error messages.

**Bash** for install.sh, lore-doctor, infra scripts. Must be
idempotent — safe to re-run. Prefix output with `[lore]`. Exit 0 on
success, 1 on failure.

**Helm charts** for K8s deployments (Lore Agent, MCP server).
Values files should have sane defaults. No hardcoded secrets — use
K8s Secrets.

**No long-lived credentials anywhere.** Workload Identity on GKE,
gcloud auth for local dev.

## Key Components

- `mcp-server/` — the MCP server (TypeScript)
- `mcp-server/src/routes.ts` — HTTP API route handlers (extracted from index.ts)
- `mcp-server/src/github-client.ts` — consolidated GitHub auth (App + token fallback)
- `mcp-server/src/local-runner.ts` — local task runner (worktrees, background Claude Code)
- `scripts/` — install.sh, lore-doctor, lore-init, glue scripts
- `scripts/infra/` — setup-db.sh, setup-schedulers.sh, generate-embeddings.sh
- `scripts/klaus-prompts/` — standing instructions for agents (legacy, migrating to lore-agent)
- `.claude/skills/` — platform skills (lore-feature, lore-pr, lore-init)
- `terraform/modules/` — K8s manifests, Helm charts (lore-db, gke-mcp)
- `docker/claude-runner/` — ephemeral container for Claude Code execution in K8s Jobs
- `terraform/modules/gke-mcp/loretask-crd/` — LoreTask CRD, RBAC, controller deployment
- `specs/` — speckit artifacts (spec, plan, tasks, research, contracts)
- `adrs/` — architecture decision records (MADR format)
- `teams/` — per-team CLAUDE.md files
- `agent/src/platform.ts` — CodePlatform interface (branch, commit, PR, issue, repo content, PR details)
- `agent/src/github.ts` — GitHubPlatform implementation (only file importing Octokit)
- `web-ui/src/lib/github.ts` — GitHub App client for web-ui (PR status fetching)
- `web-ui/src/app/pipeline/[id]/TaskLogs.tsx` — live Job log viewer (polls every 5s)
- `web-ui/src/app/pipeline/[id]/PRStatusCard.tsx` — live PR status card
- `agent/src/jobs/loretask-watcher.ts` — polls LoreTasks, creates PRs, triggers auto-review
- `mcp-server/src/context-assembly.ts` — context assembly with YAML templates
- `mcp-server/templates/` — YAML context assembly templates (default, review, implementation, research)
- `mcp-server/src/repo-validation.ts` — deterministic validation (lint/typecheck detection for Node/Go/Python/Rust)
- `mcp-server/src/repo-validation-cli.ts` — CLI wrapper for validation in K8s Job pods
- `scripts/slack-app-manifest.yaml` — Slack app manifest for /lore slash command
- `agent/src/lib/episode-writer.ts` — shared episode writer with Haiku-driven auto-curation
- `agent/src/jobs/memory-lifecycle.ts` — importance decay (eviction) + fact consolidation (pattern extraction)
- `mcp-server/src/session-tracker.ts` — passive session tracking (tool calls, ring buffer, exit dump)
- `evals/` — PromptFoo eval configs per team

## Agent Memory

MCP memory tools for persistent agent memory:
- **write_memory** — store a key-value memory with optional TTL
- **read_memory** — retrieve a memory by key (supports version history)
- **delete_memory** — soft-delete a memory
- **list_memories** — paginated listing of active memories
- **search_memory** — semantic search across memories and facts (supports `include_invalidated` for historical queries)
- **write_episode** — ingest raw text (conversation, review, observation); auto-extracts facts and updates knowledge graph
- **query_graph** — query the live knowledge graph for entities and relationships
- **assemble_context** — retrieve and assemble context from all sources into a structured, token-budgeted block
- **agent_stats** — health, memory count, episode count, facts, searches, daily breakdown

Memory is stored in the PostgreSQL `memory` schema (tables:
`memories`, `memory_versions`, `facts`, `episodes`, `entities`,
`edges`, `snapshots`, `shared_pools`, `audit_log`). File-backed
fallback to `~/.lore/memory/` when DB is unavailable.

Facts have temporal validity (`valid_from`/`valid_to`). When a new
fact contradicts an existing one (cosine similarity >= 0.92), the
old fact is automatically invalidated. Search returns only valid
facts by default.

Episodes are raw text blobs (conversation turns, code reviews,
observations) that are passively ingested. Facts and knowledge
graph entities are automatically extracted from episodes.

The live knowledge graph (`memory.entities` + `memory.edges`)
tracks entities (services, teams, technologies) and their
relationships. Updated incrementally on every write_episode call.
Replaces the static `graphrag/graph.json` for new deployments.

Fact extraction via configurable LLM (`LORE_FACT_LLM` env:
claude/openai/ollama) breaks unstructured text into individually
searchable facts with embeddings.

Agent ID resolved from: explicit parameter, `LORE_AGENT_ID` env,
`~/.lore/agent-id` file, or auto-generated UUID.

When the MCP server runs locally (stdio mode), all memory operations
are proxied to the GKE MCP server via `LORE_API_URL`. Local learnings
are shared across the org. AgentDB provides optional local read caching.

## Required Workflow

Every Claude Code session connected to Lore MUST follow this order:

1. **First action**: Call `assemble_context` with a query describing
   the task. This loads conventions, ADRs, memories, facts, and
   graph relationships in one call. Do not skip this.

2. **Before planning or building**: Call `search_memory` to check
   if the problem was already solved or if previous sessions left
   relevant learnings. Search with multiple queries — exact terms,
   likely key names (e.g. `deployment-gotchas-{date}`), and broader
   descriptions. Never assume "no memory exists" after one search.

3. **During work**: Use `search_context` for patterns and history.
   Use `query_graph` to understand entity relationships. Use
   `create_pipeline_task` to delegate work to agents.

4. **Before session ends**: Call `write_memory` with a session
   summary of decisions, corrections, and non-obvious learnings.
   Call `write_episode` with raw observations for passive fact
   extraction.

This workflow is enforced via the system prompt injected by
`install.sh`. The install script configures hooks that remind
agents to follow this order.

## Developer Setup

`install.sh` runs once per machine. It configures:
- MCP server (serves context for ALL onboarded repos)
- Skills (/lore-feature, /lore-pr)
- Hooks (SessionStart syncs context, Stop captures episode)
- System prompt (enforces assemble_context + search_memory workflow)
- Agent ID (~/.lore/agent-id)

No per-repo install needed. The MCP server auto-detects which repo
you're in from the git remote and serves that repo's context.

## Running Locally

```bash
git clone git@github.com:re-cinq/lore.git && lore/scripts/install.sh
```

The MCP server runs locally via stdio but proxies all operations
(context, memory, pipeline, search) to the GKE backend via
`LORE_API_URL`. The backend must be running for any functionality
beyond the initial install. There is no offline or local-only mode.

## GKE Deployment

Four services in the `n8n-cluster` (europe-west1):
- PostgreSQL + pgvector: `lore-db` namespace
- Lore Agent: `lore-agent` namespace
- Lore MCP server: `mcp-servers` namespace
- LoreTask controller: `lore-agent` namespace (watches LoreTask CRs, creates Job pods)

All secrets managed by External Secrets Operator (ESO) pulling from
GCP Secret Manager. Single `terraform apply` deploys everything.
See `terraform/` for the full configuration.

Deploy requires `secrets.tfvars` (copy from `secrets.tfvars.example`)
plus four variables passed on the command line or in the file:

- `lore_api_url` — external URL for the MCP server API
- `lore_ui_url` — external URL for the web UI
- `lore_ui_hostname` — hostname for the UI ingress
- `github_org` — GitHub organization name

```bash
cd terraform && terraform apply \
  -var-file=secrets.tfvars \
  -var='lore_api_url=https://lore-api.example.com' \
  -var='lore_ui_url=https://lore.example.com' \
  -var='lore_ui_hostname=lore.example.com' \
  -var='github_org=your-github-org'
```

CI workflows also require the GitHub Actions variable `GCP_PROJECT_ID`
(`gh variable set GCP_PROJECT_ID --body "your-gcp-project-id"`).

## Repo Onboarding

Add a repo to Lore via the UI (/onboard) or MCP tool (onboard_repo).
Creates a PR on the target repo with CLAUDE.md, AGENTS.md, PR
template, and CI workflows. After merge, nightly ingestion picks
up the repo's content. Repos table: lore.repos.

## Task Pipeline

Tasks created via UI, MCP, or PR trigger agents on GKE.
Pipeline tools: create_pipeline_task, get_pipeline_status,
list_pipeline_tasks, cancel_task, retry_task. Local runner tools:
run_task_locally, list_local_tasks, cancel_local_task.
Task types configured in
scripts/task-types.yaml:

- **feature-request**: PM describes intent in plain language → agent generates spec.md, data-model.md, tasks.md following repo conventions. Opens a PR for engineer review.
- **onboard**: inspects repo, generates CLAUDE.md, AGENTS.md, ADRs, spec, CI workflows
- **general**: open-ended task with Lore context
- **runbook**: generates incident runbook
- **implementation**: implements from a spec file
- **gap-fill**: drafts missing documentation
- **review**: reviews a PR against conventions

Agent creates branch + PR when done. Simple tasks use direct
Anthropic API calls. Implementation and review tasks use ephemeral
K8s Job pods via the LoreTask CRD:

1. Agent worker creates a LoreTask CR (custom resource)
2. The loretask-controller watches CRs and creates Jobs with the
   claude-runner image
3. Job pods: pre-load context via API → run Claude Code → run
   deterministic validation (lint/typecheck) → commit → push
4. If validation fails: one retry with fix prompt → if still fails,
   mark `needs-human-help` (no PR created)
5. A watcher job in the agent creates a PR when the Job completes
6. Agent deploys do NOT affect running Job pods — tasks survive
   rollout restarts

**Deterministic validation** (Minions-inspired): After the agent
edits code, the runner detects repo tooling (package.json, go.mod,
pyproject.toml, Cargo.toml) and runs lint/typecheck as mandatory
pipeline stages. This happens in both local runner (`monitorTask`)
and GKE runner (`entrypoint.sh`). Validation is scoped to changed
files to avoid false positives from pre-existing issues.

**Pre-run context hydration**: Before spawning Claude Code, both
runners fetch assembled context from the Lore API (`/api/context`
with `query` param). The agent starts with conventions, ADRs,
memories, and graph on turn 1 instead of spending its first action
calling `assemble_context`.

**Subdirectory convention rules**: `.claude/rules/*.md` files are
loaded conditionally during context assembly based on task query
keywords. All four templates include a `rules` source at priority 1.

**Slack integration**: `/lore [task_type] description` slash command
creates pipeline tasks. Channel-to-repo mapping in
`lore.repos.settings.slack_channel_id`. Watcher posts PR links,
issue links, and failure messages back to the originating channel
via `LORE_SLACK_BOT_TOKEN`.

**Passive memory capture**: MCP server tracks all tool calls in
memory (session-tracker.ts). On exit, dumps to
`~/.lore/last-session.json`. Stop hook POSTs to
`/api/session-summary` for automatic episode + fact extraction.
No agent cooperation needed.

**Post-task auto-curation**: After every task completion (PR created,
no-changes, failure), an episode is automatically written via
`episode-writer.ts`. For high-signal events (PRs, failures), Haiku
extracts a "lesson learned" and stores it as a memory entry
(`auto-curation/{ref}`).

**Importance-based memory decay**: Daily job scores memories 0-10
based on recency, content length, and key pattern. Evicts lowest-
scoring when agent exceeds 500 memories. Also cleans up invalidated
facts older than 30 days beyond 2000 cap.

**Automatic consolidation**: Daily job groups recent facts (7-day
lookback) by repo and calls Haiku to extract higher-level patterns.
Stored as `consolidated/{repo}/{timestamp}` memories.

**Privacy filtering**: All memory writes (episodes, memories) pass
through `sanitizeContent()` / `redactSecrets()` to strip API keys,
JWTs, private keys, connection strings, and bearer tokens before
storage in the org-wide database.

**API security**: Centralized auth in `routes.ts` — every `/api/*`
route enforces bearer token validation before dispatch. Supports
legacy single token (`LORE_INGEST_TOKEN`, full access) and per-client
scoped tokens (`pipeline.api_tokens` table with SHA-256 hashes).
Scopes: read, write, task, webhook, admin. Token management via
`/api/tokens` endpoint. Webhooks (GitHub, Slack) use their own HMAC
signature verification. Rate limiting: 30/min webhooks, 60/min task
ops, 200/min other (in-memory sliding window). 1MB body size limit.

**Job pod security**: Pods run as non-root (uid 1000), drop all
Linux capabilities, disallow privilege escalation. NetworkPolicy
restricts egress to DNS + HTTPS + internal Lore API only.

**Autonomous review loop** (opt-in per repo via `auto_review` setting):
- After implementation PR is created, watcher auto-creates a review
  LoreTask CR
- Review Job pod clones the PR branch, reads spec + conventions,
  posts PR comments via `gh`, outputs APPROVED or CHANGES_REQUESTED
- Approved: task marked reviewed, PR ready for human merge
- Changes requested (iteration < 2): new implementation LoreTask
  with feedback on the same branch
- Changes requested (iteration >= 2): escalate to human review

- Every task creates a GitHub Issue on the target repo (`lore-managed` label). Issues get status comments and are closed when the PR is created.
- Optional approval gates: tasks can require a human to add an `approved` label on the GitHub Issue before processing. Configured via settings UI or `lore.settings` table.
