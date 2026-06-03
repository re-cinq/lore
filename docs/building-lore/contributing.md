# Contributing to Lore

**For people developing the Lore platform.** This guide gets you from a clone to a running local stack, then orients you in the codebase — the repo layout, the technologies in play, and the design principles that decisions are measured against. For the PR checklist and code conventions, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CLAUDE.md](../../CLAUDE.md).

---

## Run the full stack locally

`scripts/install.sh` runs once per machine and configures the MCP server, skills, hooks, statusline, and agent ID — that's enough to *use* Lore against a deployed backend. To run the **entire** stack on your own machine instead:

```bash
npm start
```

This runs `scripts/dev-local.sh`, which brings up a Docker Postgres (pgvector, data persisted to the git-ignored `.lore-pgdata/`), builds `shared` → `mcp-server` → `agent`, then runs all four components under `concurrently` with live reload.

Ports:

| Component | Port |
|-----------|------|
| web-ui | `:3000` |
| mcp-server | `:3001` |
| agent | `:8080` |
| Postgres | `:5432` |

Useful sub-commands:

- `npm run db:up` / `npm run db:down` — manage the Postgres container on its own
- `npm run db:schema` — apply the schema DDL

On first run, `scripts/infra/setup-local-schema.sh` bootstraps the `lore`/`lore_ui` roles, the pgvector extension, and all schemas by shimming `kubectl` → `docker exec` so the existing `setup-*.sh` scripts run unmodified against the container (no SQL duplication). It then applies the `ui-helm/migrations/*.sql` incremental migrations the same way the GKE Helm hook does — tracked in `lore.schema_migrations`, in filename order, one transaction per file, skipping already-applied ones — so migration-added tables exist locally even though local dev has no Helm hook. `npm start` runs this automatically once Postgres is ready.

## Project structure

```
lore/
├── mcp-server/          # MCP server (TypeScript, serves context + memory + pipeline)
├── agent/               # Lore Agent service (TypeScript, task runner + scheduler)
├── shared/              # @re-cinq/lore-shared — npm workspace package (chunker, redact, types)
├── web-ui/              # Next.js dashboard (repo-centric UI, GitHub OAuth)
├── scripts/             # install.sh, lore-doctor, infra setup scripts
├── docker/claude-runner/ # Ephemeral container for Claude Code in K8s Jobs
├── terraform/modules/   # Helm charts (mcp-helm, agent-helm, ui-helm), LoreTask CRD
├── k8s/                 # Ingress manifests, CronJobs
├── adrs/                # Architecture decision records (MADR format)
├── specs/               # Feature specifications (speckit workflow)
├── teams/               # Per-team CLAUDE.md overrides
└── .github/workflows/   # CI: build + push containers for MCP, agent, UI, runner
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| MCP Server | TypeScript, `@modelcontextprotocol/sdk`, Zod |
| Agent | TypeScript, `@anthropic-ai/sdk`, Claude Code (headless) |
| Web UI | Next.js 15, NextAuth v4 (GitHub OAuth) |
| Database | PostgreSQL 16 + pgvector (CloudNativePG) |
| Embeddings | Vertex AI `text-embedding-005` (768 dim) |
| Search | Hybrid: HNSW vector + BM25 keyword, RRF fusion. AST-based code chunking via tree-sitter |
| Code parsing | web-tree-sitter (TypeScript, Python, Go) |
| GitHub | Octokit + `@octokit/auth-app` (GitHub App) |
| Observability | OpenTelemetry traces + metrics |
| Slack | Slack Web API (`chat.postMessage`), HMAC-SHA256 verification |
| Infrastructure | GKE, Helm, cert-manager, external-dns, ESO |

## Design principles

1. **DX-first** — developer experience is validated before infrastructure investment.
2. **Zero stored credentials** — Workload Identity everywhere, no secrets in code.
3. **Single interface** — developers talk to the Lore MCP server, never directly to agents or databases.
4. **Intelligent agents over scripts** — agents that understand code, not scripts that chunk text.
5. **Schema-per-team isolation** — SQL-level access control without a separate auth layer.

Architecture decisions are documented as ADRs in `adrs/` (MADR format).

## Development workflow

Use the `/lore-feature` skill to start or continue a feature — it guides you through spec → plan → tasks → implementation interactively. When you're ready to open a PR, `/lore-pr` drafts a description from your spec and changed files against the template in `.github/pull_request_template.md`. Full conventions live in [CLAUDE.md](../../CLAUDE.md); the PR checklist is in the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## See also

- [Architecture](architecture.md) — how the components you're editing fit together.
- [Scheduled Jobs](scheduled-jobs.md) — the recurring jobs the agent runs.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CLAUDE.md](../../CLAUDE.md) — PR checklist and full code conventions.
- [Back to README](../../README.md)
