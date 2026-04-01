# Lore

Shared context infrastructure for Claude Code. One install command
gives developers full org awareness — conventions, ADRs, team patterns,
PR history, and task state.

## Architecture

**MCP server** (`mcp-server/src/index.ts`): TypeScript, serves context
to Claude Code via MCP protocol. Dual transport: stdio for local
(Phase 0), Streamable HTTP for GKE (Phase 1). Three core tools:
`get_context`, `get_adrs`, `search_context`. Phase 1 adds pipeline
delegation tools.

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
- `agent/src/platform.ts` — CodePlatform interface (branch, commit, PR, issue, repo content)
- `agent/src/github.ts` — GitHubPlatform implementation (only file importing Octokit)
- `evals/` — PromptFoo eval configs per team

## Agent Memory

11 MCP memory tools for persistent agent memory:
- **write_memory** — store a key-value memory with optional TTL
- **read_memory** — retrieve a memory by key (supports version history)
- **delete_memory** — soft-delete a memory
- **list_memories** — paginated listing of active memories
- **search_memory** — semantic search across memories and facts
- **shared_write** — write to a named shared pool (cross-agent)
- **shared_read** — read from a shared pool
- **create_snapshot** — snapshot all current memories for crash recovery
- **restore_snapshot** — restore memories from a snapshot
- **agent_health** — memory count, last active, snapshot count
- **agent_stats** — total memories, facts, searches, daily breakdown

Memory is stored in the PostgreSQL `memory` schema (tables:
`memories`, `memory_versions`, `facts`, `snapshots`, `shared_pools`,
`audit_log`). File-backed fallback to `~/.lore/memory/` when DB is
unavailable.

Fact extraction via configurable LLM (`LORE_FACT_LLM` env:
claude/openai/ollama) breaks unstructured text into individually
searchable facts with embeddings.

Agent ID resolved from: explicit parameter, `LORE_AGENT_ID` env,
`~/.lore/agent-id` file, or auto-generated UUID.

When the MCP server runs locally (stdio mode), all memory operations
are proxied to the GKE MCP server via `LORE_API_URL`. Local learnings
are shared across the org. AgentDB provides optional local read caching.

## Developer Setup

`install.sh` runs once per machine. It configures:
- MCP server (serves context for ALL onboarded repos)
- Skills (/lore-feature, /lore-pr)
- Hooks (SessionStart syncs context, PostToolUse tracks tasks)
- Agent ID (~/.lore/agent-id)

No per-repo install needed. The MCP server auto-detects which repo
you're in from the git remote and serves that repo's context.

## Running Locally

```bash
git clone git@github.com:re-cinq/lore.git && lore/scripts/install.sh
```

The MCP server runs locally via stdio. No infra needed for Phase 0.

## GKE Deployment

Four services in the `n8n-cluster` (europe-west1):
- PostgreSQL + pgvector: `alloydb` namespace
- Lore Agent: `lore-agent` namespace
- Lore MCP server: `mcp-servers` namespace
- LoreTask controller: `lore-agent` namespace (watches LoreTask CRs, creates Job pods)

Deploy order: `setup-db.sh` → `setup-schedulers.sh` → Helm install Lore Agent + MCP.

## Repo Onboarding

Add a repo to Lore via the UI (/onboard) or MCP tool (onboard_repo).
Creates a PR on the target repo with CLAUDE.md, AGENTS.md, PR
template, and CI workflows. After merge, nightly ingestion picks
up the repo's content. Repos table: lore.repos.

## Task Pipeline

Tasks created via UI, MCP, or PR trigger agents on GKE.
Pipeline tools: create_pipeline_task, get_pipeline_status,
list_pipeline_tasks, cancel_task, mark_task_merged,
submit_review_result. Task types configured in
scripts/task-types.yaml:

- **feature-request**: PM describes intent in plain language → agent generates spec.md, data-model.md, tasks.md following repo conventions. Opens a PR for engineer review.
- **onboard**: inspects repo, generates CLAUDE.md, AGENTS.md, ADRs, spec, CI workflows
- **general**: open-ended task with Lore context
- **runbook**: generates incident runbook
- **implementation**: implements from a spec file
- **gap-fill**: drafts missing documentation
- **review**: reviews a PR against conventions

Agent creates branch + PR when done. Simple tasks use direct
Anthropic API calls. Implementation tasks use ephemeral K8s Job
pods via the LoreTask CRD instead of running Claude Code inside
the agent pod:

1. Agent worker creates a LoreTask CR (custom resource)
2. The loretask-controller watches CRs and creates Jobs with the
   claude-runner image
3. Job pods: clone repo → run Claude Code → commit → push
4. A watcher job in the agent creates a PR when the Job completes
5. Agent deploys do NOT affect running Job pods — tasks survive
   rollout restarts

- Every task creates a GitHub Issue on the target repo (`lore-managed` label). Issues get status comments and are closed when the PR is created.
- Optional approval gates: tasks can require a human to add an `approved` label on the GitHub Issue before processing. Configured via settings UI or `lore.settings` table.
