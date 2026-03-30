<p align="center">
  <img src="web-ui/public/logo.svg" width="120" alt="Lore" />
</p>

<h1 align="center">Lore</h1>

<p align="center">
  Shared context infrastructure for Claude Code.<br/>
  One install command gives every developer full org awareness.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-production-blue" alt="Status" />
  <img src="https://img.shields.io/badge/platform-GKE-4285F4?logo=google-cloud" alt="GKE" />
  <img src="https://img.shields.io/badge/model-Claude_Haiku-orange?logo=anthropic" alt="Claude" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## What is Lore?

Lore makes Claude Code organization-aware. Developers open Claude Code and it already knows: org-wide conventions, team-specific patterns, architectural decisions, PR history, and current task state — without any manual context loading.

- **One install** configures everything. No per-repo setup.
- **Repo onboarding** is one click. Lore inspects the repo, generates CLAUDE.md, ADRs, specs, and CI workflows, then opens a PR.
- **Context stays fresh** automatically via push-triggered ingestion.
- **Agents handle the work** — background tasks, gap detection, spec drift checks, and code review all run as pipeline tasks.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Developer Machine                                      │
│                                                         │
│  Claude Code ──► Lore MCP Server (stdio)                │
│                  ├── get_context    (merged CLAUDE.md)   │
│                  ├── get_adrs       (decision records)   │
│                  ├── search_context (hybrid search)      │
│                  ├── write_memory   (persistent memory)  │
│                  └── create_task    (pipeline dispatch)  │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTP (GKE mode)
┌─────────────────────▼───────────────────────────────────┐
│  GKE Cluster (europe-west1)                             │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  MCP Server   │  │  Lore Agent  │  │  Web UI      │  │
│  │  (mcp-servers)│  │  (lore-agent)│  │  (lore-ui)   │  │
│  │              │  │              │  │              │  │
│  │  Context API  │  │  Task runner │  │  Dashboard   │  │
│  │  Memory API   │  │  Scheduler   │  │  Onboarding  │  │
│  │  Pipeline API │  │  LLM calls   │  │  Pipeline    │  │
│  │  Ingest API   │  │  PR creation │  │  Search      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
│         │                 │                              │
│  ┌──────▼─────────────────▼──────┐                      │
│  │  PostgreSQL + pgvector (CNPG) │                      │
│  │  ├── org_shared (context)     │                      │
│  │  ├── memory (agent memory)    │                      │
│  │  ├── pipeline (tasks, jobs)   │                      │
│  │  └── lore (repos registry)    │                      │
│  └───────────────────────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

### Key Components

| Component | What it does |
|-----------|-------------|
| **MCP Server** | Serves context to Claude Code via MCP protocol. Hybrid search (vector + BM25 via RRF). Memory tools. Task CRUD. Ingest API. |
| **Lore Agent** | Processes pipeline tasks via Anthropic API (Haiku). Runs 5 scheduled jobs. Creates branches and PRs via GitHub App. |
| **Web UI** | Next.js dashboard. Repo-centric view. One-click onboarding. Pipeline monitoring. GitHub OAuth. |
| **PostgreSQL** | CloudNativePG with pgvector. Schema-per-team isolation. HNSW indexes for vector search, GIN for BM25. |

### Search

Hybrid search combines vector similarity (Vertex AI `text-embedding-005`, 768 dimensions) with BM25 keyword matching via Reciprocal Rank Fusion (k=60). Degrades gracefully to keyword-only when Vertex AI is unavailable.

### Agent Memory

11 MCP tools for persistent memory across sessions: `write_memory`, `read_memory`, `delete_memory`, `list_memories`, `search_memory`, `shared_write`, `shared_read`, `create_snapshot`, `restore_snapshot`, `agent_health`, `agent_stats`. File-backed fallback when DB is unavailable.

### Pipeline

Tasks created via UI or MCP tools are picked up by the Lore Agent service. The agent calls Claude Haiku, parses the output, and creates PRs on the target repo. Task types: `onboard`, `general`, `runbook`, `implementation`, `gap-fill`, `review`.

### Scheduled Jobs

| Job | Schedule | What it does |
|-----|----------|-------------|
| Context reindex | Daily 2 AM | Re-embed changed content for all repos |
| Gap detection | Monday 9 AM | Find missing documentation |
| Spec drift | Monday 10 AM | Compare specs against code |
| Merge check | Every 60s | Detect merged onboarding PRs |
| Memory TTL | Every hour | Clean up expired memories |

## Getting Started

```bash
git clone git@github.com:re-cinq/lore.git
cd lore && scripts/install.sh
```

This configures the MCP server, skills, hooks, and agent ID. No infrastructure needed — the MCP server runs locally via stdio and falls back to file-based search.

### Onboarding a Repo

Via the UI at `lore.gcp.re-cinq.com/onboard`, or:

```bash
# Via MCP tool
claude "onboard re-cinq/my-service to lore"
```

The agent inspects the repo, generates onboarding files, sets up ingest secrets, and opens a PR. Merge it and the repo is live.

## Project Structure

```
lore/
├── mcp-server/          # MCP server (TypeScript)
├── agent/               # Lore Agent service (TypeScript)
├── web-ui/              # Next.js dashboard
├── scripts/             # install.sh, lore-doctor, infra scripts
├── terraform/modules/   # Helm charts (mcp, agent, dolt)
├── k8s/                 # Ingress, CronJob manifests
├── adrs/                # Architecture decision records
├── specs/               # Feature specs (speckit workflow)
├── teams/               # Per-team CLAUDE.md files
├── evals/               # PromptFoo eval configs
└── .github/workflows/   # CI: build MCP, agent, UI containers
```

## Design Decisions

Architecture decisions are documented as ADRs in `adrs/`. Key ones:

- **ADR-007**: Replace Klaus with purpose-built Lore Agent (direct Anthropic API, predictable output, cost tracking)
- **PostgreSQL + pgvector** over managed AlloyDB (CNPG on existing GKE, no vendor lock-in)
- **Schema-per-team isolation** (SQL-level access control, no separate auth layer)
- **Hybrid search** (vector + BM25 via RRF, not vector-only)
- **Zero stored credentials** (Workload Identity everywhere)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| MCP Server | TypeScript, `@modelcontextprotocol/sdk`, Zod |
| Agent | TypeScript, `@anthropic-ai/sdk` (Haiku), `cron-parser` |
| Web UI | Next.js 15, NextAuth (GitHub OAuth) |
| Database | PostgreSQL 16 + pgvector (CloudNativePG) |
| Embeddings | Vertex AI `text-embedding-005` (768 dim) |
| GitHub | Octokit + `@octokit/auth-app` (GitHub App) |
| Observability | OpenTelemetry → Cloud Monitoring |
| Infrastructure | GKE, Helm, cert-manager, external-dns |

## License

MIT
