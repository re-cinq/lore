# Implementation Plan: Lore Agent Service

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Lore Agent Service                          |
| Branch         | 5-lore-agent                                |
| Status         | Planned                                     |
| Created        | 2026-03-29                                  |
| Estimated      | 4 working days (3 phases)                   |

## Technical Context

| Component         | Choice                                              |
|-------------------|-----------------------------------------------------|
| Language          | TypeScript (ESM, strict, ES2022)                    |
| Runtime           | Node.js 22                                          |
| LLM SDK           | @anthropic-ai/sdk                                   |
| Default model     | claude-haiku-4-5-20251001                            |
| GitHub            | octokit + @octokit/auth-app (reused from MCP server)|
| Database          | pg (PostgreSQL via existing CNPG)                   |
| Scheduler         | cron-parser + setInterval (30s tick)                 |
| Container         | node:22-slim, distroless prod stage                 |
| Deployment        | Helm chart in GKE, `lore-agent` namespace           |
| Config            | task-types.yaml (mounted from ConfigMap)             |
| Health            | HTTP /healthz on port 8080                          |

## Constitution Check

| Principle                          | Status | Notes                                   |
|------------------------------------|--------|-----------------------------------------|
| DX-First Delivery                  | PASS   | Replaces broken Klaus flow              |
| Zero Stored Credentials            | PASS   | Workload Identity for GKE; API key via K8s Secret |
| PR Description Quality Gates       | PASS   | Agent generates PRs with structured descriptions |
| Three-Command Developer Interface  | PASS   | Transparent — developers use same MCP tools |
| Single Interface (Lore MCP)        | PASS   | MCP server still handles CRUD; agent is backend worker |
| Distributed Ownership              | PASS   | No change to ownership model |
| Architecture Decisions Are Final   | NOTE   | This supersedes "Klaus in GKE" from Principle 7/9. ADR needed. |
| Schema-Per-Team Isolation          | PASS   | Agent resolves team schema from lore.repos |
| Intelligent Agents Over Scripts    | PASS   | Direct LLM calls — still intelligent, not mechanical |
| Opt-In Data Collection             | PASS   | No change to data collection |

**Gate:** Constitution Principle 7 lists "Klaus in GKE" as a final
decision. This feature replaces Klaus with a purpose-built service.
An ADR is required to document why the original decision is superseded.
This is justified by the production failures documented in the spec.

## Project Structure

```
agent/
├── src/
│   ├── index.ts          # Entry point: init DB, start worker + scheduler + health
│   ├── anthropic.ts      # Anthropic SDK wrapper: call LLM, log tokens/cost
│   ├── worker.ts         # Task poller: pick up pending, process, update status
│   ├── output.ts         # Parse LLM output: JSON extraction, fallback chain
│   ├── github.ts         # GitHub App: branch, commit, PR (adapted from MCP server)
│   ├── repo-context.ts   # Pre-fetch repo tree + files (adapted from MCP server)
│   ├── config.ts         # Load task-types.yaml, env vars
│   ├── scheduler.ts      # Cron job runner with DB persistence
│   ├── jobs/
│   │   ├── reindex.ts    # Nightly context re-embedding
│   │   ├── gap-detect.ts # Weekly gap detection via LLM
│   │   ├── spec-drift.ts # Weekly spec drift check via LLM
│   │   ├── merge-check.ts# Onboarding PR merge detection
│   │   └── ttl-cleanup.ts# Memory TTL expiration
│   ├── health.ts         # HTTP /healthz endpoint
│   └── db.ts             # PostgreSQL pool + query helpers
├── Dockerfile
├── package.json
└── tsconfig.json
```

## Phase 1: Core Agent (2 days)

### Task 1.1: Project Scaffold

Create `agent/` with package.json, tsconfig.json. Dependencies:
`@anthropic-ai/sdk`, `octokit`, `@octokit/auth-app`, `pg`, `yaml`,
`cron-parser`. Dev: `@types/node`, `@types/pg`, `typescript`.

### Task 1.2: Database Setup

Migration script: `scripts/infra/setup-agent-schema.sh`
- Create `pipeline.llm_calls` table
- Create `pipeline.job_runs` table
- (See data-model.md for schema)

### Task 1.3: Anthropic LLM Client (`anthropic.ts`)

Wrapper around `@anthropic-ai/sdk`:
- `callLLM(prompt, systemPrompt, model?)` → `{ text, inputTokens, outputTokens, cost, durationMs }`
- Model defaults to `ANTHROPIC_MODEL` env or `claude-haiku-4-5-20251001`
- Logs every call to `pipeline.llm_calls`
- Cost calculation: Haiku input $0.80/MTok, output $4.00/MTok
- Retry: SDK handles 429/529 automatically
- Max tokens: 8192 (configurable per task type)

### Task 1.4: Output Parser (`output.ts`)

Extract structured JSON from LLM responses:
- Try `JSON.parse(raw)` — if has `.files`, return
- String-aware brace matching to find `{"files": ...}`
- Returns `{ files: Record<string, string> } | null`
- Adapted from the battle-tested extractJsonFromOutput in pipeline.ts

### Task 1.5: GitHub Operations (`github.ts`)

Adapted from `mcp-server/src/pipeline-github.ts`:
- `createBranch(repo, name, base)`
- `commitFile(repo, branch, path, content, message)`
- `createPR(repo, branch, title, body, base, labels)`
- `getOctokit()` — GitHub App auth
- No changes to logic, just standalone module

### Task 1.6: Repo Context Pre-Fetch (`repo-context.ts`)

Adapted from `mcp-server/src/repo-onboard.ts` (fetchRepoContext):
- `fetchRepoContext(fullName)` → `{ tree, files, samples }`
- Fetches top-level tree, key config files, source samples
- Used by onboard and implementation task types

### Task 1.7: Config Loader (`config.ts`)

Adapted from `mcp-server/src/pipeline-config.ts`:
- `loadTaskTypes(path)` — parse task-types.yaml
- `buildPrompt(taskType, description)` — template substitution
- `getTaskTypeConfig(taskType)` — timeout, review_required, model override
- Add `model` field to task type config (optional override per type)

### Task 1.8: Task Worker (`worker.ts`)

Core task processing loop:
- `startWorker(pool)` — starts polling every 10s
- `processTask(task)`:
  1. Update status: pending → queued → running
  2. If onboard: call `fetchRepoContext`, include in prompt
  3. Build prompt from config
  4. Call `callLLM` with system prompt enforcing JSON for onboard tasks
  5. Parse output (JSON for onboard, raw text for others)
  6. Create branch + commits + PR via github.ts
  7. Update status: running → pr-created
  8. On error: update status → failed with reason
- Crash recovery on startup: reset stale running/queued tasks

### Task 1.10: Feature Request Handler

In `agent/src/worker.ts`, add `handleFeatureRequest()`:
- Pre-fetches repo context (CLAUDE.md, existing specs as format examples, ADRs)
- Generates 3 artifacts with per-file LLM calls:
  1. `specs/{slug}/spec.md` — full spec matching repo conventions
  2. `specs/{slug}/data-model.md` — data changes (or SKIP if none)
  3. `specs/{slug}/tasks.md` — checklist task breakdown with file paths
- Creates branch, commits each file, opens PR with labels [spec, needs-review]

Also add to task-types.yaml config: `feature-request` type with model override to Haiku.

### Task 1.11: Claude Code Headless Module

New module `agent/src/claude-code.ts`:
- `isClaudeCodeAvailable()` — checks if `claude` CLI is in PATH
- `runClaudeCode({ prompt, workDir, model, maxTokens, taskId })` — runs `claude --print` via child_process, logs to pipeline.llm_calls
- `handleClaudeCodeTask` in worker.ts — clones repo, runs Claude Code, commits changes, pushes, creates PR

### Task 1.9: Entry Point (`index.ts`)

Wire everything together:
- Initialize DB pool
- Run crash recovery
- Start worker
- Start scheduler (Phase 2)
- Start health server

## Phase 2: Scheduler + Jobs (1.5 days)

### Task 2.1: Scheduler (`scheduler.ts`)

Cron-based job runner:
- Loads job definitions (name, cron expression, handler function)
- 30-second tick checks if any job is due
- Records start/end in `pipeline.job_runs`
- Missed run detection: if last_run + interval < now, run immediately
- No concurrent runs of the same job (skip if still running)

### Task 2.2: Merge Check Job (`jobs/merge-check.ts`)

Runs every 60s. Adapted from `mcp-server/src/repo-onboard.ts`:
- Query repos with unmerged onboarding PRs
- Check PR status via GitHub API
- On merge: update lore.repos, trigger ingestion task

### Task 2.3: Memory TTL Cleanup (`jobs/ttl-cleanup.ts`)

Runs hourly. Adapted from `k8s/memory-ttl-cronjob.yaml`:
- `DELETE FROM memory.memories WHERE ttl_expires_at < now()`
- Log count of expired entries

### Task 2.4: Context Reindex Job (`jobs/reindex.ts`)

Runs daily at 2 AM:
- Query all onboarded repos from `lore.repos`
- For each repo: fetch changed files since last_ingested_at
- Re-embed via Vertex AI (reuse ingest.ts pattern from MCP server)
- Update `last_ingested_at`

### Task 2.5: Gap Detection Job (`jobs/gap-detect.ts`)

Runs weekly Monday 9 AM:
- For each onboarded repo: check if CLAUDE.md covers key patterns
- Uses LLM to compare repo structure vs documented conventions
- Creates pipeline tasks for detected gaps (type: gap-fill)

### Task 2.6: Spec Drift Job (`jobs/spec-drift.ts`)

Runs weekly Monday 10 AM:
- For repos with specs: compare `.specify/spec.md` against actual code
- Uses LLM to identify drift
- Creates pipeline tasks for drift (type: general)

## Phase 3: Deployment + Cutover (0.5 days)

### Task 3.1: Dockerfile

Multi-stage build:
- Builder: node:22-slim, npm ci, tsc
- Runner: node:22-slim, copy dist + node_modules + task-types.yaml

### Task 3.2: Helm Chart

`terraform/modules/gke-mcp/agent-helm/`:
- Deployment (1 replica, port 8080)
- Service (ClusterIP)
- ServiceAccount with Workload Identity annotation
- ConfigMap mounting task-types.yaml
- Secrets: ANTHROPIC_API_KEY, GITHUB_APP_PRIVATE_KEY, DB password
- Env: LORE_DB_HOST, GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID

### Task 3.3: GitHub Actions CI

`.github/workflows/build-agent.yml`:
- Trigger: push to main (paths: agent/**)
- Build + push to ghcr.io/re-cinq/lore-agent:latest

### Task 3.4: DB Migration

Run `setup-agent-schema.sh` on the cluster to create new tables.

### Task 3.5: Remove Klaus Dependencies from MCP Server

- Remove pipeline poller (startPoller) from MCP server index.ts
- Remove Klaus client import and calls
- Remove merge checker from MCP server
- Remove onboarding PR check interval
- MCP server keeps: task CRUD tools, task creation, status queries
- Agent service takes over: task processing, PR creation, scheduling

### Task 3.6: ADR

Write `adrs/ADR-XXX-lore-agent-replaces-klaus.md`:
- Decision: Replace Klaus with purpose-built lore-agent service
- Context: Klaus output parsing failures, session fragility, model inflexibility
- Rationale: Direct API control, predictable output, cost efficiency
- Supersedes: Constitution Principle 7 "Klaus in GKE" row

### Task 3.8: Remove Klaus

- `helm uninstall klaus -n klaus`
- Update constitution to v1.2.0 (Principles 7, 9)
- Update CLAUDE.md architecture section
- Mark klaus-client.ts as deprecated

### Task 3.9: Local Task Proxy

- Add `/api/task` REST endpoint to MCP server HTTP handler
- Update `create_pipeline_task` MCP tool to proxy via fetch when LORE_DB_HOST not set
- Update install.sh to prompt for LORE_INGEST_TOKEN and set LORE_API_URL env

### Task 3.10: GitHub Issue Sync

Wire GitHub Issue lifecycle into the task worker:
- `github.ts`: add `createIssue`, `commentOnIssue`, `closeIssue`, `addIssueLabel`
- `worker.ts`: create issue on task pickup, comment on status changes, link PR to issue, close on completion
- `setup-agent-schema.sh`: add `issue_number`, `issue_url`, `actor` columns to pipeline.tasks
- Non-fatal: if GitHub App lacks Issues permission, log warning and proceed

### Task 3.11: Analytics Dashboard

- Web UI page at /analytics with 6 sections (cost cards, task summary, by type, by repo, daily trend, job runs)
- `get_analytics` MCP tool returning cost + task stats for any period

### Task 3.12: Review Reactor

- Scheduled job every 5 minutes polling agent PRs for human feedback
- Context assembly: diff + comments + conventions
- LLM call to generate fixes, commit to existing branch
- Max 3 iterations, `needs-human` label escape hatch
- Feedback stored in agent memory

### Task 3.13: Platform Abstraction

- `platform.ts`: CodePlatform interface with all operations
- `github.ts`: GitHubPlatform implementation
- All modules migrated to `platform()` singleton
- Zero Octokit imports outside github.ts

### Task 3.14: Global Settings

- `lore.settings` table (key-value)
- Settings page: API URL, ingest token, regenerate, dev install command

### Task 3.15: Approval Gates

- `approval.ts`: config from lore.settings, requiresApproval() per task type and repo
- `worker.ts`: gate at awaiting_approval, comment on issue
- `jobs/approval-check.ts`: poll issues for approved label every 60s
- `platform.ts` + `github.ts`: getIssueLabels, removeIssueLabel
- Settings page: approval config UI

### Task 3.16: Memory Proxy

- `/api/memory` REST endpoint on MCP server (write, read, search, delete, list)
- All memory MCP tools proxy via `LORE_API_URL` when `LORE_DB_HOST` not set
- File-backed fallback only when proxy unreachable

### Task 3.17: CI Auto-Deploy

- All 3 CI workflows (MCP, agent, UI) now auto-deploy to GKE after successful build
- Uses Workload Identity Federation for GKE auth

### Task 3.18: DX Polish (AgentDB Caching)

- AgentDB provides optional sub-ms local read caching for memory queries
- Writes always go to the org database; reads check local cache first

### Task 3.7: Deploy and Verify

- Helm install agent chart
- Create a test onboarding task
- Verify multi-file PR is created
- Monitor health endpoint
- Remove Klaus deployment after verification

## Phase 4: DX Polish

Tasks completed to fix developer experience flaws across all flows:

- install.sh: git clone --depth 1, conditional npm ci, remove team prompt, clear token instructions, silent AgentDB
- get_context: reads cwd CLAUDE.md, queries by repo in DB, merges org context
- systemPromptSuffix: auto-load context on conversation start
- create_pipeline_task: lists task types, auto-detects repo, returns feedback message
- list_pipeline_tasks / get_pipeline_status: proxy to GKE when local
- /api/tasks and /api/task/:id REST endpoints
- ingest_files MCP tool for manual ingestion
- Memory proxy already wired (write, read, search, delete, list → /api/memory)

## Quickstart (Verification Scenarios)

### Scenario A: Onboard a new repo

1. Create task in DB: `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by) VALUES ('re-cinq/test-repo', 'onboard', 're-cinq/test-repo', 'test')`
2. Add pending event
3. Wait 30 seconds
4. Check: task should be `pr-created` with a PR URL
5. Check: PR should have multiple files (CLAUDE.md, AGENTS.md, ADRs)
6. Check: `pipeline.llm_calls` should have a row with cost < $0.10

### Scenario B: Health endpoint

1. `curl http://lore-agent:8080/healthz`
2. Should return JSON with status, task counts, job schedules

### Scenario C: Crash recovery

1. Set a task to status 'running' with updated_at 1 hour ago
2. Restart the agent service
3. Check: task should be reset to 'pending' within 30s of startup
4. Check: task should be processed and reach 'pr-created'
