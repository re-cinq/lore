<p align="center">
  <img src="web-ui/public/logo.svg" width="120" alt="Lore" />
</p>

<h1 align="center">Lore</h1>

<p align="center">
  Shared context infrastructure for Claude Code.<br/>
  Org awareness + agent memory + task pipeline in one platform.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-production-blue" alt="Status" />
  <img src="https://img.shields.io/badge/platform-GKE-4285F4?logo=google-cloud" alt="GKE" />
  <img src="https://img.shields.io/badge/agents-Claude_Code_+_API-orange" alt="Agents" />
  <img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License" />
</p>

---

## What is Lore?

Lore is the shared context layer that makes Claude Code organization-aware. Developers open Claude Code and it already knows: org-wide conventions, team-specific patterns, architectural decisions, and current task state — without any manual context loading.

Beyond context, Lore is an **agent operating system**. It runs background agents that onboard repos, detect documentation gaps, check for spec drift, and review PRs — all producing pull requests that humans review and merge.

## Three Ways to Use Lore

### Flow 1: Developer with Claude Code (local)

A developer works in their repo. Claude Code connects to the Lore MCP server (stdio, local) and gets org context automatically. The developer can also create tasks that the agent picks up.

```
Developer types in terminal
         │
    Claude Code
         │
    Lore MCP Server (stdio)
    ├── get_context        → "Here's how we do auth in this org"
    ├── search_context     → "Found 3 ADRs about database migrations"
    ├── write_memory       → persists across sessions
    └── create_task        → "onboard re-cinq/my-service"
                                    │
                              ┌─────▼──────┐
                              │ Lore Agent  │  (GKE)
                              │ picks up    │
                              │ the task    │
                              └─────┬──────┘
                                    │
                              Opens PR on
                              re-cinq/my-service
```

### Flow 2: Tasks via Web UI or API

A product owner or platform engineer creates a task through the dashboard. The Lore Agent processes it — either via direct API call (simple tasks) or by spawning Claude Code instances (complex tasks).

```
Web UI (lore.gcp.re-cinq.com)
         │
    Create task: "write a runbook for incident response"
         │
    ┌────▼─────────────────────────────┐
    │         Lore Agent (GKE)         │
    │                                  │
    │  Simple task (onboard, runbook)  │
    │  ──► Claude API (Haiku)          │
    │  ──► Parse output                │
    │  ──► Create PR                   │
    │                                  │
    │  Complex task (implementation)   │
    │  ──► Spawn Claude Code (headless)│
    │  ──► Full tool access            │
    │  ──► Multi-agent parallel work   │
    │  ──► Create PR                   │
    └──────────────────────────────────┘
```

### Flow 3: Product Manager → Spec (intent to implementation)

A PM describes what they want in plain language. Lore translates it into engineering artifacts following the repo's conventions.

```
PM opens Lore UI → picks repo → "New Task" (Feature Request)
         │
    Types: "I want users to export timesheets as PDF"
         │
    ┌────▼─────────────────────────────────────────┐
    │              Lore Agent                       │
    │                                              │
    │  1. Fetches repo context                     │
    │     ├ CLAUDE.md (architecture)               │
    │     ├ Existing specs (format examples)       │
    │     └ ADRs (constraints, decisions)          │
    │                                              │
    │  2. Generates per-file (one LLM call each)   │
    │     ├ specs/feature/spec.md                  │
    │     ├ specs/feature/data-model.md            │
    │     └ specs/feature/tasks.md                 │
    │                                              │
    │  3. Opens PR labeled [spec] [needs-review]   │
    └──────────────────────────────────────────────┘
         │
    Engineer reviews spec PR
         │
    Merges → /speckit.plan → /speckit.implement
```

### Agent Execution Modes

| Mode | When | How |
|------|------|-----|
| **API call** | Onboarding, runbooks, gap-fill, review, review-reactor fixes | Direct `@anthropic-ai/sdk` call to Claude Haiku. Fast, cheap ($0.01-0.07/task). Plain text in, plain text out. |
| **Claude Code (headless)** | Implementation, refactoring, complex analysis | Spawns a headless Claude Code process with full tool access (file read/write, bash, search). Can reason about code, run tests, iterate. |
| **Multi-agent** | Large implementation tasks | Spawns multiple Claude Code instances in parallel. Each works on a different part of the task (e.g., one agent per file or module). Results merged into a single PR. |
| **Feature request** | PM intent | Fetches repo context, generates spec/data-model/tasks as individual files. Each artifact gets its own focused LLM call. |

The agent service decides which mode to use based on the task type configured in `task-types.yaml`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Developer Machine                                          │
│                                                             │
│  Claude Code ──► Lore MCP Server (stdio, no infra needed)   │
│                  ├── Context retrieval (CLAUDE.md, ADRs)     │
│                  ├── Hybrid search (vector + keyword)        │
│                  ├── Agent memory (persistent, searchable)   │
│                  ├── Task dispatch (pipeline)                │
│                  └── Memory proxy to GKE (local learnings    │
│                       become org knowledge)                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│  GKE Cluster                                                │
│                                                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │  MCP Server   │  │  Lore Agent   │  │  Web UI          │ │
│  │              │  │               │  │                  │ │
│  │  Context     │  │  Task worker  │  │  Repo dashboard  │ │
│  │  Memory      │  │  ├ API calls  │  │  Onboarding      │ │
│  │  Pipeline    │  │  ├ Claude Code│  │  Pipeline view   │ │
│  │  Ingest      │  │  └ Multi-agent│  │  Cost tracking   │ │
│  │              │  │               │  │                  │ │
│  │              │  │  Scheduler    │  │                  │ │
│  │              │  │  ├ Reindex    │  │                  │ │
│  │              │  │  ├ Gap detect │  │                  │ │
│  │              │  │  ├ Spec drift │  │                  │ │
│  │              │  │  └ TTL/merge  │  │                  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘ │
│         │                 │                                 │
│  ┌──────▼─────────────────▼──────┐   ┌─────────────────┐  │
│  │  PostgreSQL + pgvector (CNPG) │   │  GitHub App      │  │
│  │  ├── org_shared (context)     │   │  ├ Read repos    │  │
│  │  ├── memory (agent memory)    │   │  ├ Create PRs    │  │
│  │  ├── pipeline (tasks, jobs)   │   │  └ Set secrets   │  │
│  │  └── lore (repos registry)    │   └─────────────────┘  │
│  └───────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | What it does |
|-----------|-------------|
| **MCP Server** | Serves org context to Claude Code via MCP protocol. Hybrid search (vector + BM25). Agent memory. Task CRUD. Push-triggered ingest API. |
| **Lore Agent** | Processes pipeline tasks. Calls Claude API for simple tasks, spawns Claude Code for complex ones. Runs 5 scheduled maintenance jobs. Creates PRs via GitHub App. Every task automatically creates a GitHub Issue on the target repo, so developers see what Lore is doing without checking the dashboard. Issues are updated with status changes and closed when the PR is created. |
| **Web UI** | Next.js dashboard with GitHub OAuth. Repo-centric view. One-click onboarding. Pipeline monitoring with cost tracking. Analytics dashboard. Global settings. |
| **PostgreSQL** | CloudNativePG with pgvector. Schema-per-team isolation. HNSW indexes for vector, GIN for keyword. |
| **GitHub App** | Reads repo content for onboarding. Creates branches, commits, and PRs. Sets Actions secrets for ingest automation. |

### Search

Hybrid search combines vector similarity (Vertex AI `text-embedding-005`, 768 dimensions) with BM25 keyword matching via Reciprocal Rank Fusion (k=60). Degrades gracefully to keyword-only when embeddings are unavailable.

### Agent Memory

11 MCP tools for persistent memory across sessions and restarts: `write_memory`, `read_memory`, `delete_memory`, `list_memories`, `search_memory`, `shared_write`, `shared_read`, `create_snapshot`, `restore_snapshot`, `agent_health`, `agent_stats`. Every memory is versioned, timestamped, and semantically searchable. When running locally, all memory operations are proxied to the GKE MCP server so learnings are shared org-wide. File-backed fallback only when the proxy is unreachable.

### Repo Onboarding

One-click onboarding inspects the target repo, checks what files already exist, and generates only what's missing:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Context loading order, workflow commands, conventions for AI agents |
| `adrs/ADR-*.md` | Architectural decisions inferred from the codebase |
| `.specify/spec.md` | System specification describing what the repo does today |
| `.github/PULL_REQUEST_TEMPLATE.md` | Structured PR template (Why, Alternatives, ADRs) |
| `.github/workflows/pr-description-check.yml` | CI enforcing PR description quality |
| `.github/workflows/lore-ingest.yml` | Push-triggered context ingestion |

After the PR is merged, the agent automatically configures ingest secrets so context stays fresh on every push.

### Scheduled Jobs

| Job | Schedule | What it does |
|-----|----------|-------------|
| Context reindex | Daily 2 AM | Re-embed changed content for all repos |
| Gap detection | Monday 9 AM | Find missing documentation, create gap-fill tasks |
| Spec drift | Monday 10 AM | Compare specs against actual code |
| Merge check | Every 60s | Detect merged onboarding PRs, trigger ingestion |
| Review reactor | Every 5 min | Detect human review feedback on agent PRs, generate fixes, commit to branch |
| Approval check | Every 60s | Check for approved label on tasks awaiting approval |
| Memory TTL | Every hour | Clean up expired memory entries |

## Getting Started

```bash
git clone git@github.com:re-cinq/lore.git
cd lore && scripts/install.sh
```

This configures the MCP server, skills, hooks, and agent ID. No infrastructure needed — the MCP server runs locally via stdio with file-based search.

For the full platform (vector search, agent pipeline, web UI), deploy to GKE:

```bash
scripts/infra/setup-db.sh           # PostgreSQL + pgvector
scripts/infra/setup-agent-schema.sh  # Pipeline + job tables
helm install lore-mcp terraform/modules/gke-mcp/mcp-helm/ -n mcp-servers
helm install lore-agent terraform/modules/gke-mcp/agent-helm/ -n lore-agent

# Remove Klaus (replaced by lore-agent)
helm uninstall klaus -n klaus  # if still running
```

## Project Structure

```
lore/
├── mcp-server/          # MCP server (TypeScript, serves context + memory + pipeline)
├── agent/               # Lore Agent service (TypeScript, task runner + scheduler)
├── web-ui/              # Next.js dashboard (repo-centric UI, GitHub OAuth)
├── scripts/             # install.sh, lore-doctor, infra setup scripts
├── terraform/modules/   # Helm charts (mcp-helm, agent-helm, dolt-helm)
├── k8s/                 # Ingress manifests, CronJobs
├── adrs/                # Architecture decision records (MADR format)
├── specs/               # Feature specifications (speckit workflow)
├── teams/               # Per-team CLAUDE.md overrides
└── .github/workflows/   # CI: build + push containers for MCP, agent, UI
```

## Design Principles

1. **DX-first** — developer experience validated before infrastructure investment
2. **Zero stored credentials** — Workload Identity everywhere, no secrets in code
3. **Single interface** — developers talk to the Lore MCP server, never directly to agents or databases
4. **Intelligent agents over scripts** — agents that understand code, not scripts that chunk text
5. **Schema-per-team isolation** — SQL-level access control without a separate auth layer

Architecture decisions are documented as ADRs in `adrs/`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| MCP Server | TypeScript, `@modelcontextprotocol/sdk`, Zod |
| Agent | TypeScript, `@anthropic-ai/sdk`, Claude Code (headless) |
| Web UI | Next.js 15, NextAuth v4 (GitHub OAuth) |
| Database | PostgreSQL 16 + pgvector (CloudNativePG) |
| Embeddings | Vertex AI `text-embedding-005` (768 dim) |
| Search | Hybrid: HNSW vector + BM25 keyword, RRF fusion |
| GitHub | Octokit + `@octokit/auth-app` (GitHub App) |
| Observability | OpenTelemetry traces + metrics |
| Infrastructure | GKE, Helm, cert-manager, external-dns |

## How To

### For Developers: Get org context in Claude Code

After running `install.sh`, Claude Code automatically loads org context for whatever repo you're in. The MCP server runs locally via stdio — no infrastructure needed.

Context loads automatically at the start of every conversation -- Claude calls `get_context` behind the scenes.

```bash
# Context retrieval — Claude Code just knows
claude "how do we handle auth in this repo?"
# → Pulls from CLAUDE.md, ADRs, team patterns via get_context / search_context

claude "what was the decision on database migrations?"
# → Returns relevant ADRs with rationale and alternatives rejected

# Persistent memory across sessions — shared org-wide
claude "remember that we decided to use UUIDs for all new tables"
# → Stored via write_memory, searchable next session via search_memory

# Memories are shared across the entire org
claude "remember that we always use UTC timestamps in database columns"
# → Stored in org-wide PostgreSQL, not just local files
# → Every developer in the org can search for this via search_memory

claude "what do we know about timestamp conventions?"
# → Semantic search across ALL org memories — finds what others stored

# Delegate work to the agent pipeline (proxied to GKE)
claude "create a runbook for database failover in re-cinq/my-service"
# → Calls create_pipeline_task → proxied to GKE → agent picks it up → PR created

# Check task status
claude "what's the status of my last pipeline task?"
# → Returns status, PR link, cost, duration
```

When running locally without a database, task creation and all memory operations are **proxied** to the GKE MCP server via `LORE_API_URL`. The install script configures this automatically. AgentDB provides optional sub-ms local caching for read queries. Writes always go to the org database.

**All MCP tools available to Claude Code:**

| Tool | Category | What it does |
|------|----------|-------------|
| `get_context` | Context | Merged CLAUDE.md for current repo (auto-detected from git remote) |
| `get_adrs` | Context | ADRs filtered by domain and status |
| `search_context` | Context | Hybrid search (vector + keyword) across all org context |
| `write_memory` | Memory | Store a persistent memory with optional TTL and fact extraction |
| `read_memory` | Memory | Retrieve by key, supports version history |
| `search_memory` | Memory | Semantic search across all memories and extracted facts |
| `list_memories` | Memory | Paginated listing of active memories |
| `delete_memory` | Memory | Soft-delete (preserved in history) |
| `shared_write` / `shared_read` | Memory | Cross-agent shared memory pools |
| `create_snapshot` / `restore_snapshot` | Memory | Point-in-time backup and restore |
| `agent_health` / `agent_stats` | Memory | Usage stats, daily breakdown |
| `create_pipeline_task` | Pipeline | Create task (proxied to GKE when local) |
| `get_pipeline_status` | Pipeline | Task status and event timeline |
| `list_pipeline_tasks` | Pipeline | List tasks with status filter |
| `cancel_task` | Pipeline | Cancel a running or pending task |
| `list_repos` | Repos | All onboarded repos with activity stats |
| `onboard_repo` | Repos | Onboard a new repo to Lore |
| `ingest_files` | Ingest | Manually ingest files into Lore's context store |

### GitHub Issue Notifications

Every pipeline task creates an issue on the target repo labeled `lore-managed`. You'll see it in your GitHub notifications when:
- A task starts on your repo (issue opened)
- The agent creates a PR (comment with PR link, issue closed)
- A task fails (issue stays open with `lore-failed` label)

Filter with `label:lore-managed` to see all Lore activity on any repo.

### For Platform Engineers: Onboard a repo

**Via UI:**
1. Go to `lore.gcp.re-cinq.com/onboard`
2. Enter `owner/repo` (e.g., `re-cinq/my-service`)
3. Click "Onboard Repository"
4. Agent inspects the repo, generates CLAUDE.md, ADRs, spec, CI workflows
5. PR appears on the target repo — review and merge
6. Ingest secrets are configured automatically

**Via CLI:**
```bash
claude "onboard re-cinq/my-service to lore"
```

For repos not yet onboarded, developers can still ingest specific files manually:
```bash
claude "ingest CLAUDE.md and the ADRs into Lore"
```

**What gets generated** (only files that don't already exist):
- `AGENTS.md` — context loading, commands, conventions for AI agents
- `adrs/ADR-001-*.md` — architectural decisions inferred from code
- `.specify/spec.md` — system spec describing what the repo does
- `.github/PULL_REQUEST_TEMPLATE.md` — structured PR template
- `.github/workflows/pr-description-check.yml` — CI for PR quality
- `.github/workflows/lore-ingest.yml` — push-triggered ingestion

### For Product Managers: Describe a feature

1. Open `lore.gcp.re-cinq.com` → pick your repo → "New Task"
2. Select "Feature Request"
3. Describe what you want in plain language:

   > *"I want users to be able to export their approved timesheets as PDF,
   > grouped by project, with the company logo. Should work for a single
   > month or a custom date range. The export button should be on the
   > time tracking page."*

4. Click "Create Task"
5. Within 10 minutes, a PR appears on the repo with:
   - `specs/export-timesheets-pdf/spec.md` — proper engineering spec
   - `specs/export-timesheets-pdf/data-model.md` — data changes needed
   - `specs/export-timesheets-pdf/tasks.md` — implementation checklist

6. Engineers review the spec PR, refine, merge
7. Then: `/speckit.plan` → `/speckit.implement` to build it

You don't need to know speckit, MADR, or any engineering convention. The agent matches the repo's existing style automatically.

### Full Flow: PM → Spec → Engineer → PR

```
PM types feature intent in plain language (Lore UI)
         │
    Lore Agent picks up the task
    ├── Fetches repo context (CLAUDE.md, ADRs, memories)
    ├── Generates specs/{feature}/spec.md
    ├── Generates specs/{feature}/data-model.md
    ├── Generates specs/{feature}/tasks.md
    └── Opens PR + GitHub Issue on the repo
         │
    Engineer gets notification (GitHub Issue)
    ├── Reviews spec PR, refines, merges
    └── Opens Claude Code in the repo:
         │
    /lore-feature
    ├── Claude shows available specs
    ├── Engineer picks one
    ├── Claude reads spec + tasks
    ├── Creates feature branch
    ├── Implements tasks one by one
    ├── Marks [x] in tasks.md after each
    ├── Commits atomically per task
    └── When done:
         │
    /lore-pr
    ├── Claude reads spec + diff + ADRs
    ├── Drafts PR description
    └── Creates PR via gh CLI
```

### For Engineers: Work from a spec

After a spec is merged (from a PM feature request or manual creation):

```bash
# Plan the implementation
/speckit.plan

# Generate task breakdown
/speckit.tasks

# Implement (can use multiple agents in parallel)
/speckit.implement
```

The speckit workflow produces: `research.md` (decisions), `data-model.md` (entities), `contracts/` (API schemas), `plan.md` (phased approach), `tasks.md` (checklist with file paths).

### Monitoring

**Web UI** (`lore.gcp.re-cinq.com`):
- Pipeline page shows all tasks with status, cost, and PR links
- Repo view shows context, active tasks, and memory for each repo
- Search page queries across all onboarded repos

**Agent health** endpoint:
```bash
curl https://lore-api.gcp.re-cinq.com/healthz
# Returns: uptime, tasks processed, job schedules, DB status
```

**LLM costs** tracked per task in `pipeline.llm_calls` table — visible in the pipeline dashboard.

### Analytics

The analytics dashboard at `lore.gcp.re-cinq.com/analytics` shows:
- Cost overview cards (today, 7-day, 30-day)
- Task summary by status
- Cost breakdown by task type and by repo
- Daily cost trend chart
- Scheduled job run history

Also available programmatically via the `get_analytics` MCP tool.

### Global Settings

Platform configuration at `lore.gcp.re-cinq.com/settings`:
- **API URL** — the external MCP server endpoint
- **Ingest Token** — shared auth token for API calls
- **Regenerate Token** — rotates the token (invalidates all existing)
- **Dev Install Command** — copy-paste for new developer onboarding
- **Approval Gates** — require human approval before agents process tasks (per-repo or global)

## License

Apache License 2.0 — see [LICENSE](LICENSE).
