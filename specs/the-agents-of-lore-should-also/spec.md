# Feature Specification: Agents of Lore — Unified Hook & CLI Interface

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Agents of Lore — Unified Hook & CLI Interface |
| Branch            | agents-of-lore-unified-hooks               |
| Status            | Draft                                      |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days                           |
| Full Stack Target | 4-6 weeks                                  |

## Problem Statement

Claude Code and the Lore Agent service today have separate entry points and execution contexts:

- **Claude Code (local)** uses `/lore-feature`, `/lore-pr`, and `/lore-init` skills that are installed as shell scripts in `.claude/skills/`. They parse task files, manage state, and delegate to the MCP server. Context assembly, memory search, and workflow orchestration happen via hardcoded prompts.

- **Lore Agent (GKE)** processes pipeline tasks by calling Claude API directly. It has its own CLI tools, its own GitHub integration, and its own understanding of the repo's task structure. When spawning ephemeral Jobs via LoreTask, the agent injects a fresh Claude Code environment with duplicated context-loading logic.

**The result:** Two parallel implementations of the same logic. Context loading happens twice (once locally, once in the Job). Memory persistence, workflow enforcement, and autonomous learning are inconsistent. New agent types (e.g., review-reactor, auto-researcher, gap-filler) must reimplement the hooks. Skills cannot be tested independently or shared as library code.

## Vision

**One unified hook system** that works everywhere:
- Local Claude Code sessions (stdio MCP mode)
- Ephemeral K8s Job pods (LoreTask execution)
- Scheduled agent jobs (gap detection, review reaction, context reindex)
- Direct API calls (simple tasks via Haiku)
- GitHub issue dispatch (via webhook)

**One interface** that all agents speak:
- `@lore/hooks` — npm package with Session, Task, Memory, Graph, Context, and Config hooks
- `@lore/cli` — unified CLI tool (replaces shell scripts)
- Testable, composable, and versioned

**Multiple entry points**, same behavior:
- Start a feature session: `lore feature --repo re-cinq/my-service --spec my-feature`
- Run a review task: `lore review --repo re-cinq/my-service --pr 123`
- Ingest a document: `lore ingest --repo re-cinq/my-service --file CLAUDE.md`
- Delegate to agents: `lore delegate --task-type implementation --spec specs/my-feature/spec.md`
- Query memory: `lore memory search --query "how do we handle auth?"`

**Autonomous and self-learning:**
- Every hook execution is logged and indexed as an episode
- Facts are automatically extracted and validated
- Knowledge graph grows incrementally
- Agents learn from each other's successes and failures
- No manual context loading — just `lore <command>`

## User Personas

### Developer (Local)

A developer working on a feature in Claude Code. They run `lore feature` once and Claude Code handles the rest — context loading, task breakdown, session memory. No manual skill invocation. No duplicate context assembly calls.

### Lore Agent (GKE)

A background service that processes pipeline tasks. It uses the same hooks as local developers so tasks are consistent whether running in a Job pod or on a dev machine. New agent types (review, gap-fill, runbook) are built by composing hooks, not rewriting context logic.

### Job Pod Executor

An ephemeral container spawned by LoreTask CR. It clones the repo, runs `lore <task-type>`, and pushes the result. Same hooks as local, so execution is deterministic and testable.

### Scheduled Job

A cron task (gap detection, review reaction, context reindex). Runs `lore <job-name>` and produces output (GitHub Issues, PRs, memory updates). Uses the same Memory and Graph hooks as interactive sessions.

### GitHub Webhook

Receives `issues.labeled` events with `lore` or `lore:*` labels. Creates a pipeline task and hands it to the agent. The webhook uses the same Task hooks as the MCP server.

## User Scenarios & Acceptance Criteria

### Scenario 1: Developer Starts a Feature Session

**Actor:** Developer in Claude Code

**Flow:**
1. Developer runs `/lore-feature` (or calls the hook directly).
2. Hook prompts for repo and spec name.
3. Hook calls `assemble_context` to load org + team conventions, ADRs, memories, graph.
4. Hook parses `specs/{spec-name}/spec.md` and `tasks.md`.
5. Hook creates a session memory with `write_memory`.
6. Hook returns structured context block (spec, tasks, decisions, patterns).
7. Claude Code proceeds with implementation guided by the spec.
8. Developer works through tasks, marking them done.
9. When session ends, hook calls `write_episode` to capture learnings.

**Acceptance Criteria:**
- `@lore/hooks` exports a `useSession` hook that loads context and task state in one call.
- Hook is testable in isolation (takes repo, spec name, optional memory store as inputs).
- Context assembly call happens exactly once per session start.
- Session memory is written exactly once at session end.
- Developer sees no difference between local Claude Code and ephemeral Job execution.

### Scenario 2: Agent Processes Implementation Task

**Actor:** Lore Agent (running on GKE)

**Flow:**
1. Agent receives a pipeline task of type `implementation` with a spec file.
2. Agent creates a LoreTask CR with the spec and task context.
3. Controller spawns a Job pod with the claude-runner image.
4. Job pod runs: `lore implementation --spec {spec-file} --repo {repo} --task-id {id}`
5. CLI hook calls `useSession` → loads spec, memories, context, graph.
6. Claude Code runs inside the Job, using the exact same context as a dev would.
7. Claude Code implements, commits, pushes.
8. Job pod exits with status 0.
9. Watcher picks up the completed Job → creates PR on the repo.
10. Auto-review task is created if `auto_review: true`.

**Acceptance Criteria:**
- `@lore/cli` exports a command `lore implementation <args>` that a Job pod can invoke.
- CLI hook returns context + task state in the same format as local `useSession`.
- Execution is deterministic: same spec + same memories = same output (modulo LLM variance).
- Job pod does not need to re-authenticate or reconfigure the MCP server.
- All task state changes are persisted via MCP (no local files).

### Scenario 3: Review Task in Auto-Review Loop

**Actor:** Lore Agent (review-reactor job)

**Flow:**
1. Agent receives notification that an implementation PR was created.
2. Agent creates a LoreTask CR of type `review` with the PR branch.
3. Job pod runs: `lore review --repo {repo} --pr {number} --spec {spec-file}`
4. CLI hook calls `useReview` (specialized hook for review context).
5. Hook loads spec, conventions, PR diff, ADRs.
6. Claude Code reviews and outputs comments + approval status.
7. Job pod posts comments via `gh pr comment` and outputs APPROVED / CHANGES_REQUESTED.
8. Watcher reads output and updates task state.
9. If APPROVED: PR is ready for merge. If CHANGES_REQUESTED: new implementation task on same branch.

**Acceptance Criteria:**
- `useReview` hook loads review-specific context (spec, conventions, PR diff, relevant ADRs).
- Spec is fetched from the branch if not passed explicitly.
- Review output format is machine-readable (JSON with `status` and `comments` fields).
- Review comments are posted exactly once per review Job.
- Review logic is testable without a live PR.

### Scenario 4: Scheduled Job — Gap Detection

**Actor:** Gap detection cron job

**Flow:**
1. Cron job runs: `lore gap-detect --org re-cinq`
2. CLI hook calls `useGapDetect` (specialized hook for org-wide analysis).
3. Hook loads all onboarded repos from the database.
4. Hook searches memory for known gaps and patterns.
5. Hook queries knowledge graph for underutilized services.
6. Hook runs gap analysis on each repo (missing ADRs, outdated specs, etc.).
7. Hook creates one GitHub Issue per gap on the target repo labeled `lore-gap`.
8. Hook writes a comprehensive episode with findings.
9. Cron job logs output and exits.

**Acceptance Criteria:**
- `useGapDetect` hook can list repos and analyze multiple repos in one call.
- Gap detection output is structured (repo, gap type, severity, suggested action).
- GitHub Issues are created exactly once per gap (no duplicates across runs).
- Gap learnings are captured in an episode for future analysis.
- Cron job output is loggable (plain text with structured fields).

### Scenario 5: GitHub Webhook — Issue Dispatch

**Actor:** GitHub webhook handler

**Flow:**
1. Developer adds `lore` label to a GitHub Issue.
2. GitHub sends a webhook event to `POST /api/webhook/github`.
3. Webhook handler calls `lore delegate --issue {issue-url} --label {label}`
4. CLI hook calls `useIssueDispatch` to parse the issue and determine task type.
5. Hook creates a pipeline task in the database.
6. Hook returns task ID.
7. Webhook responds with 200 OK.
8. Agent picks up the task on next run.

**Acceptance Criteria:**
- Issue dispatch hook creates exactly one pipeline task per unique issue.
- Duplicate label additions do not create duplicate tasks.
- Task type is inferred from the issue template and label (e.g., `lore:implementation` → implementation task).
- Issue URL is stored in the task for linking.
- Hook works without needing to authenticate as a developer or agent.

## Functional Requirements

### 1. @lore/hooks Package

- **1.1** Export TypeScript hook interface with session, task, memory, graph, context, and config objects.
- **1.2** `useSession(repo, spec?, options?)` hook loads org context, spec, memories, graph in one call. Takes optional `memoryStore` parameter for testing.
- **1.3** `useReview(repo, prNumber, specFile?, options?)` hook loads review-specific context (spec, PR diff, conventions, ADRs).
- **1.4** `useGapDetect(org?, options?)` hook provides repo list and gap analysis utilities.
- **1.5** `useIssueDispatch(issueUrl, options?)` hook parses GitHub Issue and infers task type.
- **1.6** `useTask(taskId, options?)` hook loads task state, status, and context from pipeline database.
- **1.7** All hooks are composable and can be used in isolation (e.g., memory hook without session hook).
- **1.8** All hooks return structured, documented types (not raw JSON).
- **1.9** Hooks handle MCP server unavailability gracefully (fallback to file-backed store or error with actionable message).
- **1.10** All hooks accept a `LORE_TEST_MODE` environment variable to use mock implementations.

### 2. @lore/cli Package

- **2.1** Single `lore` command with subcommands: `feature`, `review`, `gap-detect`, `delegate`, `ingest`, `memory`, `graph`, `health`, `status`.
- **2.2** `lore feature --repo {repo} --spec {spec-name}` starts a feature session. Returns context block to stdout as JSON or structured text.
- **2.3** `lore review --repo {repo} --pr {number}` runs review. Outputs machine-readable JSON with `status` and `comments` fields.
- **2.4** `lore implementation --repo {repo} --spec {spec-file}` runs implementation from a spec file (used by Job pods).
- **2.5** `lore gap-detect --org {org}` detects gaps across all repos. Outputs structured gap list and creates GitHub Issues.
- **2.6** `lore delegate --issue {issue-url} --label {label}` creates a pipeline task from a GitHub Issue.
- **2.7** `lore ingest --repo {repo} --file {path}` manually ingests a file into context.
- **2.8** `lore memory search --query {query}` searches memory with semantic search.
- **2.9** `lore graph query --entity {entity-type}` queries knowledge graph.
- **2.10** `lore health` reports MCP server status, DB connectivity, authentication state.
- **2.11** `lore status --repo {repo}` shows repo onboarding status, memory count, last ingestion.
- **2.12** CLI accepts `--output json` flag for machine-readable output on all commands.
- **2.13** CLI respects `LORE_API_URL`, `LORE_AGENT_ID`, `LORE_TEST_MODE` environment variables.
- **2.14** All CLI commands exit with 0 on success, non-zero on failure. Errors logged to stderr.

### 3. Session Execution Model

- **3.1** Every session (local or Job pod) begins with `assemble_context` call (not two separate calls).
- **3.2** `assemble_context` accepts a `query` parameter describing the task and returns context in one structured block.
- **3.3** Context assembly template is selected based on context type (`default`, `review`, `implementation`, `research`).
- **3.4** Memory search happens once at session start with multiple query variations (exact, fuzzy, broader description).
- **3.5** Session ID is generated at start and included in all MCP calls for tracing.
- **3.6** Session end triggers exactly one `write_episode` call with raw session notes for passive fact extraction.
- **3.7** No MCP call is made twice in a single session unless explicitly requested.

### 4. Autonomous Learning & Memory

- **4.1** Every hook execution is logged as an episode in the database.
- **4.2** Episodes are tagged with: repo, agent-id, session-id, execution-type (local, job, scheduled), outcome (success, failure, partial).
- **4.3** Facts are automatically extracted from episodes via configurable LLM (`LORE_FACT_LLM`).
- **4.4** Contradictory facts are automatically invalidated (cosine similarity >= 0.92).
- **4.5** Knowledge graph is updated incrementally on every `write_episode` call (entities and relationships extracted and versioned).
- **4.6** Fact validity windows are tracked: `valid_from`, `valid_to` timestamps. Search returns only valid facts by default.
- **4.7** `search_memory` hook supports `include_invalidated=true` for historical queries.
- **4.8** Memory retrieval latency is tracked per hook and aggregated in analytics dashboard (p50/p95/p99).
- **4.9** Agents can query graph for entity relationships: `query_graph(entity='service-name')` returns connected entities and temporal edges.
- **4.10** Cross-session learning: fact extracted in one session is automatically available to all agents in subsequent sessions.

### 5. Multi-Entry Point Support

- **5.1** Same task can be triggered via: `/lore-feature` skill, `lore feature` CLI, MCP `create_pipeline_task`, GitHub issue label.
- **5.2** All entry points produce the same execution output (deterministic context, same task breakdown).
- **5.3** Task execution produces a GitHub Issue on the target repo (`lore-managed` label) tracking progress.
- **5.4** GitHub Issue is updated with status comments as task progresses (started, PR created, failed).
- **5.5** All entry points support approval gates: tasks can require human approval via GitHub Issue `approved` label before processing.
- **5.6** Task audit trail includes: who created it, what label triggered it, execution logs, PR link, cost.

### 6. Job Pod Execution

- **6.1** LoreTask CRD spawns Job pods with `claude-runner` image.
- **6.2** Job pod environment includes: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GITHUB_TOKEN`, `LORE_API_URL`, `LORE_AGENT_ID`, `LORE_SESSION_ID`.
- **6.3** Job pod runs `lore <task-type> --repo {repo} --task-id {id}` from the repo root.
- **6.4** Job pod clones repo, installs dependencies, runs hook, commits, and pushes atomically.
- **6.5** Job pod exits with 0 on success, 1 on failure. Logs are captured and stored in `lore.pipeline_logs` table.
- **6.6** Watcher service monitors completed Jobs and creates PRs within 30 seconds.
- **6.7** Job pods are isolated from agent service (different pods, separate resource quotas, kill on timeout).
- **6.8** Job pod cleanup is automatic: completed/failed Jobs deleted after 24 hours.

### 7. Testing & Validation

- **7.1** All hooks are exported from `@lore/hooks` with TypeScript types and JSDoc.
- **7.2** Hooks can be tested in isolation with mock MCP store (in-memory or SQLite).
- **7.3** CLI commands can be run with `--dry-run` flag (no side effects, show what would happen).
- **7.4** `lore health` command validates: MCP connectivity, DB connectivity, GitHub App permissions, required env vars.
- **7.5** Hook unit tests are in `mcp-server/src/__tests__/hooks/*.test.ts` (Jest).
- **7.6** CLI integration tests are in `agent/src/__tests__/cli/*.test.ts` (spin up test DB + MCP server).
- **7.7** Test coverage for all hooks: >= 80% lines, >= 90% branches.

### 8. Documentation & Discoverability

- **8.1** `@lore/hooks` package exports a `hookRegistry` object listing all available hooks with signatures and examples.
- **8.2** `lore --help` lists all commands with examples.
- **8.3** `lore <command> --help` shows command-specific options, environment variables, and exit codes.
- **8.4** `CLAUDE.md` section on hooks: "Using the Lore Hooks" explains the execution model and when to call which hook.
- **8.5** Example specs in `specs/` demonstrate proper session + task structure (e.g., how to structure spec tasks for `lore implementation`).
- **8.6** Runbook: "Debugging a failed Lore task" explains how to read logs, replay locally, and file issues.

## Non-Functional Requirements

### Performance

- **P1** `assemble_context` latency: < 2s (p95) for <= 50 MB of org context.
- **P2** `search_memory` latency: < 500ms (p95) for semantic search on <= 10,000 memories.
- **P3** Hook initialization (MCP connection + auth): < 1s per session start.
- **P4** Job pod startup (clone + install + session init): < 3 minutes end-to-end.
- **P5** GitHub webhook response: < 5s (async task creation).
- **P6** Session memory write: batched and async, < 100ms user-facing latency.

### Reliability

- **R1** Session initialization must not fail due to transient network issues. Retry MCP calls up to 3 times with exponential backoff.
- **R2** If MCP server is unavailable, fall back to file-backed store (`~/.lore/memory/`) for memory operations.
- **R3** Job pods must survive agent service restarts. Store task state in PostgreSQL, not in-memory.
- **R4** GitHub API failures (rate limit, network) must be retried and logged. Do not fail the task immediately.
- **R5** Contradictory fact invalidation is asynchronous and eventually consistent (may take up to 1 minute).
- **R6** All side effects (branch creation, PR creation, GitHub comments) must be idempotent. Detect and skip duplicates.

### Security

- **S1** No credentials stored in hooks or CLI code. All auth via Workload Identity (GKE) or GitHub App.
- **S2** Job pod environment variables scrubbed before logging (no `GITHUB_TOKEN` in logs).
- **S3** Memory and graph data scoped to repo and team. Cross-org queries forbidden.
- **S4** CLI commands validate inputs (repo format, spec file path, issue URL) before calling MCP.
- **S5** GitHub webhook validates HMAC signature on every request.

### Observability

- **O1** Every hook call is traced via OpenTelemetry. Trace context propagated across MCP calls.
- **O2** Hook execution duration and outcome logged (success, failure, context: repo, agent-id, session-id).
- **O3** Memory search queries logged with: query text, number of results, latency, token cost.
- **O4** Job pod execution logged with: repo, task-id, start/end time, exit code, git operations (clone, push), error messages.
- **O5** Analytics dashboard shows: hook usage by type, latency percentiles, error rates, cost breakdown.
- **O6** Slow hook calls (p99 > 5s) trigger alerts to Slack channel `#lore-alerts`.

## Out of Scope

- **Offline mode.** Hooks require MCP server connectivity. No local-only execution (context is too large to embed).
- **GUI for hooks.** Hooks are CLI and SDK only. Web UI remains task/repo-centric, not hook-centric.
- **Hook versioning.** All agents run the same hook version (pinned in `package.json`). No per-repo hook overrides.
- **Custom hook types.** Hooks are extensible via TypeScript but not via configuration. New hook types require code changes.
- **Rollback of facts.** Invalidated facts cannot be restored. History is preserved but not restored.
- **Real-time memory sync.** Memory updates are eventually consistent (up to 1 minute). Not a real-time shared cache.

## Key Entities

### Hook Execution

```typescript
interface HookExecution {
  id: string;                    // UUID
  repo_id: string;              // Foreign key to repos table
  hook_type: string;            // "session", "review", "gap-detect", etc.
  agent_id: string;             // Agent that executed the hook
  session_id: string;           // Unique session identifier
  started_at: timestamp;        // ISO 8601
  completed_at?: timestamp;
  status: "running" | "success" | "failure" | "partial";
  input_context: JSON;          // User query, spec name, etc.
  output_context: JSON;         // Returned context block
  memory_reads: number;         // Count of memory queries
  memory_writes: number;        // Count of memory updates
  error_message?: string;       // If status = failure
  duration_ms: number;          // Wall-clock time
  llm_calls: number;           // Count of API calls to Anthropic
  llm_tokens_in: number;       // Input tokens
  llm_tokens_out: number;      // Output tokens
  llm_cost_usd: number;        // Cost of LLM calls
  trace_id: string;            // OpenTelemetry trace ID
}
```

### Episode & Fact Extraction

```typescript
interface Episode {
  id: string;
  hook_execution_id: string;     // Foreign key to hook_executions table
  repo_id: string;
  agent_id: string;
  session_id: string;
  raw_text: string;              // Captured conversation, logs, or observations
  extracted_facts: Fact[];        // Auto-extracted via LLM
  entities_detected: Entity[];    // Services, teams, technologies mentioned
  ingested_at: timestamp;
}

interface Fact {
  id: string;
  episode_id: string;
  repo_id: string;
  content: string;               // "We use UUIDs for all new tables"
  embedding: vector;             // 768-dim from Vertex AI
  valid_from: timestamp;
  valid_to?: timestamp;          // NULL if still valid
  invalidated_by?: string;       // Fact ID that contradicted this one
  confidence: number;            // 0.0 to 1.0
}

interface Entity {
  id: string;
  type: string;                  // "service", "team", "technology", "pattern"
  name: string;
  repo_id: string;
  first_mentioned: timestamp;
  last_mentioned: timestamp;
  mention_count: number;
}

interface Edge {
  id: string;
  from_entity: string;           // Entity ID
  to_entity: string;
  relation: string;              // "uses", "depends-on", "implements", "documents"
  strength: number;              // Co-occurrence count
  valid_from: timestamp;
  valid_to?: timestamp;
}
```

### Task & Session State

```typescript
interface Session {
  id: string;
  repo_id: string;
  agent_id: string;
  spec_name?: string;            // For feature sessions
  task_id?: string;              // For task-driven sessions
  created_at: timestamp;
  started_at?: timestamp;
  completed_at?: timestamp;
  status: "pending" | "active" | "completed" | "failed";
  memory_snapshot?: JSON;        // Memories loaded at session start
  total_context_tokens: number;
}
```

## Success Criteria

### Quantitative

1. **Unified execution:** 100% of agents use `@lore/hooks` for context loading (not duplicated code).
2. **Session performance:** `assemble_context` latency p95 < 2s on all repo sizes.
3. **Learning:** Knowledge graph grows by >= 10 new facts per day (from episodes).
4. **Fact validity:** >= 95% of facts are valid (< 5% contradiction rate).
5. **Job reliability:** >= 99.5% of Job pods complete with correct output.
6. **Test coverage:** >= 85% line coverage on `@lore/hooks` package.
7. **Adoption:** >= 80% of new agent types built using hooks (not reimplemented).

### Qualitative

1. **Developer experience:** New developers can trigger a feature session in 10 seconds (`lore feature --repo ... --spec ...`).
2. **Agent consistency:** A feature implemented locally vs. in a Job pod produces identical code (barring LLM variance).
3. **Self-learning:** Agents discover and reuse solutions from prior sessions without manual context loading.
4. **Observability:** Platform engineer can debug a failed task using logs + trace ID in < 5 minutes.
5. **Documentation:** No developer asks "how do I use Lore hooks?" — the CLI help and CLAUDE.md examples are self-explanatory.

## Assumptions

1. **MCP server always available.** Hooks are designed to fail gracefully if MCP is down, but all core functionality requires connectivity.
2. **Repo is always on main.** Hooks assume they're running against a clean checkout of the main branch. Feature branches are created by the hook itself.
3. **Git credentials pre-configured.** Job pods inherit `GITHUB_TOKEN` from environment; local developers use `gh auth` or git credential store.
4. **Spec files are canonical.** Once a spec is merged, it is the source of truth for implementation. Hooks do not reconcile conflicting specs.
5. **Team conventions are stable.** CLAUDE.md and AGENTS.md do not change per-session. Updates are merged as PRs and take effect on next session.
6. **LLM variance is acceptable.** Hooks do not guarantee deterministic output (LLM inference). Tests account for minor semantic changes.
7. **Fact extraction is lossy.** Not all context from episodes is captured as facts. Broader themes are preserved in memory, but fine details may be lost.
8. **GitHub Issue dispatch is opt-in.** Not all repos have the webhook configured. Fallback is manual task creation via UI or MCP.

---

## Implementation Roadmap

### Phase 0 (2-3 days)
- [ ] Design `@lore/hooks` TypeScript interface and export from `mcp-server/src/hooks/index.ts`
- [ ] Implement `useSession`, `useReview` hooks with mock implementations
- [ ] Create `@lore/cli` package (TypeScript, single `lore` command)
- [ ] Implement `lore feature`, `lore review` CLI commands (proxy to hooks)
- [ ] Write unit tests for hooks (jest, mock MCP store)
- [ ] Update `.claude/skills/` to use new hooks (backwards compatible)

### Phase 1 (4-6 weeks)
- [ ] Integrate hooks with existing MCP server (replace duplicated code)
- [ ] Implement Job pod execution model with LoreTask CRD
- [ ] Implement gap detection, issue dispatch, scheduled jobs using hooks
- [ ] Autonomous learning: episode ingestion, fact extraction, graph updates
- [ ] Testing infrastructure: integration tests with test DB + MCP server
- [ ] Analytics dashboard: hook usage, latency, cost breakdown
- [ ] Documentation: CLAUDE.md section on hooks, API reference, runbooks

---

## References

- **Related specs:** "Lore — Shared Context Infrastructure" (completed), "Lore Agent" (in progress)
- **Architecture decisions:** ADR-001 (MCP for org context), ADR-003 (ephemeral Job pods)
- **Codebase:** `mcp-server/src/`, `agent/src/`, `.claude/skills/`, `terraform/modules/loretask-crd/`