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
| **API call** | Onboarding, runbooks, gap-fill, review | Direct `@anthropic-ai/sdk` call to Claude Haiku. Fast, cheap ($0.01-0.07/task). Plain text in, plain text out. |
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
│                  └── Task dispatch (pipeline)                │
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
| **Lore Agent** | Processes pipeline tasks. Calls Claude API for simple tasks, spawns Claude Code for complex ones. Runs 5 scheduled maintenance jobs. Creates PRs via GitHub App. |
| **Web UI** | Next.js dashboard with GitHub OAuth. Repo-centric view. One-click onboarding. Pipeline monitoring with cost tracking. |
| **PostgreSQL** | CloudNativePG with pgvector. Schema-per-team isolation. HNSW indexes for vector, GIN for keyword. |
| **GitHub App** | Reads repo content for onboarding. Creates branches, commits, and PRs. Sets Actions secrets for ingest automation. |

### Search

Hybrid search combines vector similarity (Vertex AI `text-embedding-005`, 768 dimensions) with BM25 keyword matching via Reciprocal Rank Fusion (k=60). Degrades gracefully to keyword-only when embeddings are unavailable.

### Agent Memory

11 MCP tools for persistent memory across sessions and restarts: `write_memory`, `read_memory`, `delete_memory`, `list_memories`, `search_memory`, `shared_write`, `shared_read`, `create_snapshot`, `restore_snapshot`, `agent_health`, `agent_stats`. Every memory is versioned, timestamped, and semantically searchable. File-backed fallback when DB is unavailable.

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

## License

Apache License 2.0 — see [LICENSE](LICENSE).
