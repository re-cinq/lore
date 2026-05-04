| Branch       | 1-lore-platform                                 |
| Spec         | [spec.md](spec.md)                              |
| Constitution | [constitution.md](../../.specify/memory/constitution.md) |
| Status       | Shipped — Phases 0–4 complete with architectural pivots |
| Created      | 2026-03-25                                      |
| Updated      | 2026-05-04                                      |

## Architectural Pivots

Eight major technologies or architectural patterns were replaced or superseded
during implementation. The original plan referenced Klaus, Beads/Dolt,
Graphiti/FalkorDB, and an implicit hardcoded job chain. All were swapped
for alternatives before reaching production.

| Original Plan | Replacement | ADR |
|---------------|-------------|-----|
| Klaus | Anthropic Claude (direct HTTP calls) | — |
| Beads/Dolt | PostgreSQL (Cloud SQL) | — |
| Graphiti + FalkorDB | Live knowledge graph in PostgreSQL (`memory.entities` + `memory.edges`) | — |
| Context Cores as OCI bundles | YAML context assembly templates (`mcp-server/templates/`) | — |
| `specify-cli` | `/lore-feature` skill (interactive spec loop) | — |
| Implicit hardcoded job chain (`loretask-watcher` → `review-reactor` → `local-runner`) | Declarative YAML workflow graphs (`agent/src/workflows/*.yaml`) driven by `agent/src/supervisor/graph-executor.ts` | ADR-016 |
| Task state spread across CR / DB / Issue / PR | Branch-as-durable-state via `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:` commit trailers + `pipeline.task_leases` | ADR-016 |
| GitHub Issue per pipeline task (max chatter) | Issues only for exception surfaces (approval gates, escalations); PR is canonical artifact | ADR-016 |

## Technical Context

The Lore platform serves the re:cinq organization as an all-hands code agent.
It is built in 4 phases, shipping capabilities incrementally on a tight
critical path.

### Phase 0: Scaffolding — COMPLETE

Core infrastructure, PR integration, and prompt engineering baseline.

| Component | Purpose | Phase |
|-----------|---------|-------|
| GitHub App | OAuth + webhook receiver | 0 |
| MCP Server + tools | Agent orchestration + GitHub / K8s APIs | 0 |
| Anthropic API integration | LLM backbone | 0 |
| PostgreSQL schema | Memory and task state | 0 |
| K8s Job dispatch | Async task execution + worktree isolation | 0 |
| Prompt engineering | System block, tool schemas, few-shot tasks | 0 |
| PR template + `/lore-feature` | Feature request workflow | 0 |

### Phase 1: Context Assembly — COMPLETE

Ingesting and ranking rich GitHub context.

| Component | Purpose | Phase |
|-----------|---------|-------|
| Context assembly | YAML templates + jinja2 rendering for task PRs | 1 |
| Code graph | Symbol indexing + related-file ranking | 1 |
| Memory schema | `entities` + `edges` + `episodes` | 1 |
| Episode writer | Auto-curation of task summaries | 1 |

### Phase 2: Gap Detection — COMPLETE

Finding and ranking high-signal specification gaps.

| Component | Purpose | Phase |
|-----------|---------|-------|
| Gap detection | Diff-based spec vs. code divergence scoring | 2 |
| Spec drift CronJob | Daily run; publishes findings as `spec-drift-*` Issues | 2 |
| Autoresearch baseline | Pre-feature snapshot for delta analysis | 2 |

### Phase 3: Autoresearch Loop — COMPLETE

Closed-loop gap filling driven by the agent.

| Component | Purpose | Phase |
|-----------|---------|-------|
| Autoresearch loop | Daily CronJob; picks high-signal gaps; spawns gap-fill PRs | 3 |
| Auto-curation | Post-task episode snapshot (memory consolidation) | 3 |
| Spec Drift         | Lore Agent `spec-drift.ts` CronJob | 3 |
| Autoresearch       | Lore Agent `autoresearch.ts` CronJob | 3 |
| Memory Lifecycle   | `memory-lifecycle.ts` — importance decay + consolidation | 3 |
| Dark Factory mode  | Per-repo opt-out gates, branch-as-state, declarative YAML workflow graphs | 4 |
| Workflow supervisor | `agent/src/supervisor/` — graph executor, lease management, pod-death resume | 4 |
| Shared package     | `@re-cinq/lore-shared` (`shared/src/`) — commit trailers, dark-factory types, redact | 4 |
| Auto-merge engine  | `agent/src/jobs/auto-merge.ts` — path-allowlist + CI-gate + trust-tier merge | 4 |
| Review reactor     | `agent/src/jobs/review-reactor.ts` — webhook-driven (replaces polled cron path) | 4 |
| Two-key AuthZ      | `mcp-server/src/dark-factory-authz.ts` — CODEOWNERS-approval PR ceremony | 4 |

### Key Dependencies (As Built)

```
re-cinq/lore/
├── README.md
├── package.json (monorepo root)
├── tsconfig.json
├── jest.config.js
├── CLAUDE.md
├── AGENTS.md
├── CODEOWNERS
├── adrs/                     # MADR ADRs; ADR-016 covers Dark Factory mode
├── runbooks/
│   └── dark-factory-rollback.md  # rollout, rollback, pilot procedure, audit-log queries
├── teams/
│   ├── payments/CLAUDE.md
│   ├── platform/CLAUDE.md
│   ├── eng/CLAUDE.md
│   └── infra/CLAUDE.md
├── docs/
├── mcp-server/
│   ├── src/
│   │   ├── index.ts          # MCP server entrypoint, 30+ tools
│   │   ├── routes.ts         # HTTP API route handlers + /api/repos/:o/:r/settings/dark-factory
│   │   ├── context-assembly.ts
│   │   ├── github-client.ts  # GitHub App + token auth
│   │   ├── local-runner.ts   # Local task runner (worktrees)
│   │   ├── session-tracker.ts
│   │   ├── repo-validation.ts
│   │   ├── repo-validation-cli.ts  # CLI wrapper for K8s Job pods
│   │   ├── dark-factory-settings.ts  # Zod schema + resolveSettings() + twoKeyFieldsTouched()
│   │   ├── dark-factory-authz.ts     # verifyApproval() CODEOWNERS-approval PR ceremony
│   │   └── graph.ts          # Knowledge graph (PostgreSQL-backed)
│   ├── templates/            # YAML context assembly templates
│   └── package.json
├── shared/                   # @re-cinq/lore-shared workspace package
│   └── src/
│       ├── commit-trailers.ts  # formatTrailers / parseTrailers / lastStageOnBranch
│       ├── dark-factory-settings.ts  # canonical DF types + resolveSettings()
│       ├── redact.ts
│       ├── tasks.ts
│       └── types.ts
├── agent/
│   └── src/
│       ├── platform.ts       # CodePlatform interface
│       ├── github.ts         # GitHubPlatform implementation
│       ├── anthropic.ts      # callLLM / callLLMWithTool + prompt-cache integration
│       ├── worker.ts         # Job execution orchestration
│       ├── health.ts         # POST /api/trigger/review-reactor endpoint
│       ├── supervisor/
│       │   ├── graph-executor.ts   # walks workflow YAML, dispatches handlers, stage commits
│       │   ├── lease.ts            # DbLeaseBackend + FileLeaseBackend
│       │   ├── runner-cli.ts       # Job pod CLI entry point (LORE_DARK_FACTORY_WORKFLOW)
│       │   ├── claude-code-handler.ts  # agent-node handler (spawns claude --print)
│       │   └── handlers.ts         # validate / gate / retrospective handlers
│       ├── workflows/
│       │   ├── gap-fill.yaml
│       │   ├── general.yaml
│       │   └── implementation.yaml
│       ├── workflow/
│       │   └── loader.ts           # Zod schema, cycle detection, reachability check
│       ├── lib/
│       │   ├── audit.ts            # writeAuditLog() for pipeline.audit_log
│       │   ├── business-hours.ts   # IANA-TZ-aware gate for safety crons
│       │   ├── dark-factory.ts     # decideIssueCreate() / resolveReviewMode()
│       │   ├── episode-writer.ts   # shared episode writer + Haiku auto-curation
│       │   ├── escalation.ts       # escalate() → needs-human-help Issue
│       │   ├── notify.ts           # decideNotify() channel filter
│       │   ├── path-match.ts       # allPathsMatch() minimatch wrapper
│       │   ├── pr-body.ts          # prFooter() Lore-Task trailer composer
│       │   └── prompt-cache.ts     # getCacheControl() + analyzeCacheBreak()
│       └── jobs/
│           ├── reindex.ts
│           ├── gap-detect.ts
│           ├── autoresearch.ts
│           ├── spec-drift.ts
│           ├── context-core-builder.ts
│           ├── merge-check.ts
│           ├── memory-lifecycle.ts
│           ├── loretask-watcher.ts
│           ├── auto-merge.ts           # evaluateAutoMerge() + evaluateAndMerge()
│           ├── dark-factory-baseline.ts # 30-day counter snapshot for SC1/SC4/SC6
│           ├── lease-reaper.ts         # 60s tick, evicts leases >5min past expiry
│           └── review-reactor.ts       # reviewReactorJob (cron) + runReviewReactorForPR (webhook)
├── web-ui/                   # Next.js UI
├── scripts/
│   ├── install.sh
│   ├── helm/
│   │   └── lore/
│   │       ├── Chart.yaml
│   │       ├── values.yaml
│   │       └── templates/
│   │           ├── agent-deployment.yaml
│   │           ├── mcp-server-deployment.yaml
│   │           ├── postgres-statefulset.yaml
│   │           ├── cron-jobs.yaml
│   │           └── rbac.yaml
│   ├── graphiti/
│   │   └── ontology.yaml
│   └── db/
│       └── migrations/
│           ├── 001_memory_schema.sql
│           ├── 002_episodes.sql
│           ├── 003_gap_detection.sql
│           ├── 004_task_state.sql
│           ├── 005_task_leases.sql
│           ├── 006_dark_factory_baseline.sql
│           └── 007_audit_log.sql
├── tests/
├── .github/
│   └── workflows/
│       ├── ci.yaml
│       └── cd.yaml
└── .specify/
    └── memory/
        └── constitution.md
```

## Specification Sections

### Phase 0: PR Scaffolding — COMPLETE

Lore joins GitHub as a GitHub App. It:

- Receives new PR events and `@lore` mentions
- Renders context via YAML templates + jinja2 (code graph, memory, linked specs)
- Prompts Claude on the task PR description
- Dispatches a K8s Job per request; Job clones the repo, checks out the PR
  branch, and passes control to the agent process
- The agent calls Claude with the assembled context and tool schemas
- Tools invoke the MCP server (HTTP RPC), which carries out side effects
  (approve, request changes, commit, push)
- Task PR collects the agent's final commit; author (re:cinq/lore) merges
  when ready

**Phase 0 Verification:**
✓ `@lore /lore-feature` in any PR description spawns a feature request task  
✓ Agent approves or requests changes with reasoning  
✓ Task PR commits changes and pushes to origin  
✓ Memory is ingested; episodes are auto-curated  

---

### Phase 1: Rich Context Assembly — COMPLETE

Before Phase 1, context was static markdown. Phase 1 added live indexing:
symbol definitions, call chains, related files, memory episodes, and linked
specs.

**Symbol Indexing (Code Graph)**

Every task Job includes a `context-core-builder.ts` invocation that:

- Walks the tree (respecting `.gitignore`) and extracts symbol definitions
  (function, class, interface, type, const) in detected languages
- Builds a semantic adjacency graph: if `foo()` calls `bar()`, there's an
  edge
- Stores the graph as `memory.entities` (node = symbol + type + line range)
  and `memory.edges` (caller → callee + confidence)
- On subsequent tasks, the context assembly queries symbol definitions near
  edits and includes call stacks

**YAML Context Templates**

`mcp-server/templates/*.yaml` define task-type-specific contexts:

```yaml
# gap-fill.yaml
contexts:
  - name: spec_section
    selector: spec.md
    template: |
      ## {{ section_name }}
      {{ spec_text }}
      
      **Current Implementation:**
      {{ code_excerpts(files) }}
  - name: related_files
    selector: .
    template: |
      **Changed Files:**
      {{ changed_file_list }}
      
      **Related Symbols:**
      {{ symbol_calls(changed_symbols) }}
```

Rendering:
1. Selector picks files from the PR diff and repo
2. Each field is jinja2 templated with variables from memory + graph
3. Output is concatenated and passed to Claude in the system block

**Episode Auto-Curation**

After task completion, `episode-writer.ts` summarizes the task:

- Reads the task PR commits and their messages
- Composes a ~200-word episode: problem statement, approach, outcome, lessons
- Stores as `memory.episodes`, tagged with task type + date
- Episodes feed future context assembly (semantic similarity search)

**Phase 1 Verification:**
✓ Symbol indexing builds a connected call graph  
✓ Context templates render with symbol definitions and file excerpts  
✓ Gap-fill tasks reference spec sections and implementation side-by-side  
✓ Episodes are written for every task completion  

---

### Phase 2: Spec Drift Detection — COMPLETE

Phase 2 automated the discovery of spec-vs-code divergence.

**Diff-Based Divergence Scoring**

`gap-detect.ts` (runs nightly, publishes to `spec-drift-*` Issues):

1. Fetches the latest `spec.md` and HEAD source tree
2. For each spec section (h2 boundary), extracts:
   - Mentioned symbols (function, class, file, type)
   - Prose assertions (e.g. "uses PostgreSQL", "runs on CronJob")
3. Maps assertions to code:
   - Regex search for symbol definitions → found/missing
   - Grep for keywords (PostgreSQL, CronJob, etc.) → found/missing
4. Scores divergence:
   - 0–10% → ✓ (spec matches code)
   - 11–50% → ⚠️ (partial match; gap-fill candidate)
   - 51–100% → 🔴 (spec is wrong; high-signal gap)
5. Publishes `spec-drift-{phase}` Issue with:
   - Ranked list of gaps by score
   - Excerpt + link to spec line
   - Suggested task type (gap-fill, runbook, implementation)

Example:

```
## Phase 2 Gap: `memory.ts` missing episode consolidation

**Spec:** "Episodes are consolidated via `memory-lifecycle.ts`..."
**Finding:** No consolidation logic found in `memory.ts`
**Divergence:** 87%

**Suggested task:** gap-fill
Suspected PR: https://github.com/re-cinq/lore/pull/XXX
```

The autoresearch loop consumes these Issues.

**Phase 2 Verification:**
✓ Nightly gap-detect discovers spec vs. code divergence  
✓ Ranked output feeds autoresearch priorities  
✓ High-divergence sections (80%+) are flagged as critical  

---

### Phase 3: Closed-Loop Autoresearch — COMPLETE

Phase 3 closed the loop: gap detection → task generation → auto-curation.

**Autoresearch Loop**

`autoresearch.ts` (daily CronJob, 10 AM UTC):

1. Fetches all open `spec-drift-*` Issues (ranked by divergence score)
2. Filters by signal (ignore 0–10%, consider 11%+)
3. Picks the top 1 gap per phase (highest score)
4. Checks for in-flight task PRs with the same gap label
5. If none in-flight: spawns a new task PR
   - Task type inferred from gap (gap-fill, runbook, implementation)
   - Context assembled from spec section + call graph + memory
   - PR title: `[autoresearch] {phase} gap: {gap_summary}`
6. Waits for task PR merge
7. Auto-curates a memory episode from the commits

**Task Type Inference**

- `gap-fill`: spec section missing code; claude writes the code
- `runbook`: implicit process missing from docs; claude writes the runbook
- `implementation`: design doc missing from code; claude implements + spec

Each type has a different context template and system prompt.

**Post-Task Curation**

After the task PR merges:

1. `episode-writer.ts` reads the commits
2. Composes a ~200-word summary: problem, approach, outcome
3. Tags with task type, date, spec section
4. Stores in `memory.episodes`
5. Next autoresearch run sees the episode and de-prioritizes similar gaps

**Opt-in Auto-Review per Repo**

Opt-in per repo via `auto_review` setting:

- `auto_review: true` → autoresearch can spawn task PRs
- `auto_review: false` (default) → manual `/lore-feature` only
- Gap detection still runs; Issues remain open for manual triage

Approval workflow:
- Gap-fill task PR is authored by re:cinq/lore (bot)
- Re:cinq engineering approves via normal PR review
- Merge is manual (no auto-merge yet; Phase 4)
- Post-task auto-curation produces `auto-curation/*` memories after
  every task completion.

### Phase 4: Dark Factory Mode — COMPLETE

Phase 4 introduced per-repo opt-out human gates, branch-as-durable-state
semantics, declarative YAML workflow graphs, two-key authorization for
privileged settings, and an auto-merge engine for path-allowlisted PRs.
Landed 2026-04-28 via ADR-016. (Prompt caching and review reactor webhook
were completed under ADR-015 on 2026-04-17 but pragmatically included here
since Phase 3 did not capture them.)

#### What Was Built

**Branch-as-durable-state (FR1)**

Every workflow phase ends with a git commit carrying structured trailers:
`Lore-Stage:`, `Lore-Iteration:`, `Lore-Task:`, plus optional
`Lore-Outcome:` and `Lore-Cost-Tokens:`. The branch is the audit trail.
A supervisor pod that dies resumes by reading `git log` — no DB
checkpoints, no CR status sync. Trailers are emitted unconditionally for
both dark-mode and opt-out repos.

Concurrency enforced by `pipeline.task_leases` (Postgres CTE-based atomic
acquire). A second supervisor exits cleanly if the lease is held. Takeover
after expiry writes a `lease_expired` audit entry. `lease-reaper.ts`
(60-second tick) evicts leases more than 5 minutes past TTL.

Trailer helpers exported from `@re-cinq/lore-shared`
(`shared/src/commit-trailers.ts`): `formatTrailers()`, `parseTrailers()`,
`lastStageOnBranch()`.

**Declarative YAML workflow graphs (FR2)**

`agent/src/workflows/*.yaml` define `agent`, `validate`, `gate`, and
`retrospective` nodes with `success | changes_requested | failed | always`
edge conditions. Cycles require `iteration_max`. `workflow/loader.ts`
validates with Zod, detects cycles (DFS coloring), checks reachability.

`agent/src/supervisor/graph-executor.ts` (`executeGraph()`) walks from
`entry`, dispatches per-node-type handlers, emits stage commits
(allow-empty for non-file-changing nodes), refreshes lease per node.
Resume semantics: reads last `Lore-Stage:` trailer and follows the
outcome-matching outgoing edge.

`agent/src/supervisor/runner-cli.ts` is the Job pod CLI entry point when
`LORE_DARK_FACTORY_WORKFLOW` is set. Loads workflows from
`/app/dist/workflows/`, drives the supervisor, exits with a documented
matrix (0/2/3/4/5/6/7/8/9) consumed by `entrypoint.sh`.

`agent/src/supervisor/claude-code-handler.ts` is the agent-node handler
for the cluster path; spawns `claude --print`, maps non-zero exit →
`cli-nonzero`, thrown errors → `cli-error`.

**Opt-out human gates (FR3)**

Per-repo `lore.repos.settings.dark_factory` block:
- `enabled` (default false), `create_issue` (never/on_gate/always)
- `auto_merge.{paths, min_trust, require_green_ci, require_bot_approval}`
- `review` (trust_based/always/never), `notify` ([escalation])

Two-gate enablement: per-repo flag AND
`LORE_DARK_FACTORY_CLUSTER_ENABLED=true` on the agent deployment. Either
gate off → legacy `claude --print` path. Prevents the helm flag from
outpacing the `claude-runner` image.

Canonical types and `resolveSettings()` defaults live in
`@re-cinq/lore-shared` (`shared/src/dark-factory-settings.ts`) so agent,
mcp-server, and Job pod runner share one source.

GitHub Issues narrow to exception surfaces: approval-gated tasks,
on-the-fly escalations (`needs-human-help`), or
`create_issue: always` override.

**Auto-merge engine**

`agent/src/jobs/auto-merge.ts`: pure `evaluateAutoMerge()` decision +
`evaluateAndMerge()` end-to-end with backoff. Outcome enum captures 7
deferral reasons + `merged`. OTEL span `lore.auto_merge.decision` records
the rule trace. Runs after `[stage:retrospective]` for gap-fill/runbook
tasks. Conditions: green CI + bot APPROVED + every changed path matches
allowlist + trust ≥ `min_trust`.

`agent/src/jobs/dark-factory-baseline.ts`: pre-feature 30-day counter
snapshot per repo written to `pipeline.dark_factory_baseline` for
SC1/SC4/SC6 delta comparisons.

**Two-key authorization (FR3.9)**

Privileged settings changes — `dark_factory.enabled`, `auto_merge.paths`,
downgrade of `require_green_ci`/`require_bot_approval` — require admin
token AND an open PR labeled `dark-factory-approval` by a CODEOWNERS
member of the repo's `CLAUDE.md`. `mcp-server/src/dark-factory-authz.ts`
validates via Octokit. All mutations write `dark_factory_setting_changed`
audit entries.

**Review reactor (event-driven)**

`agent/src/jobs/review-reactor.ts` is now webhook-driven (ADR-015). GitHub webhooks
arrive at mcp-server, which POSTs `{repo, pr_number}` to
`POST /api/trigger/review-reactor` on the agent (`health.ts`), authenticated
via `LORE_AGENT_INTERNAL_TOKEN`. Agent returns 202 and runs
`runReviewReactorForPR` in the background. A business-hours safety cron
(`7 7-17 * * 1-5` UTC, gated by `isBusinessHours()` in
`agent/src/lib/business-hours.ts`) catches any dropped webhook deliveries.

**Prompt caching on agent LLM calls**

`agent/src/anthropic.ts` uses `getCacheControl(jobName)` from
`agent/src/lib/prompt-cache.ts` to place two cache breakpoints per
request — one on the system block, one on the tool schemas (ADR-015). Returns
`{type: "ephemeral", ttl: "1h"}` for jobs in `LORE_CACHE_1H_JOBS`
allowlist, `{type: "ephemeral"}` (5m) otherwise. Emits
`cache hit | first-call | break:system | break:tools | break:ttl(Nm)` on
existing log lines. `response.usage.cache_*` feeds cost accounting.

**New database tables (strictly additive)**

- `pipeline.task_leases` — supervisor concurrency
- `pipeline.dark_factory_baseline` — SC delta counters
- `pipeline.audit_log` — every privileged mutation and auto-merge decision

All migrations use `IF NOT EXISTS`; `dark_factory.enabled` defaults to
false at migration time.

**Phase 4 Verification:**
- Two-gate enablement: per-repo off → legacy path; cluster off → legacy path.
- Pod-death resume: kill supervisor mid-stage; replacement resumes from `git log`.
- Auto-merge: green CI + allowlist path + trust ≥ min_trust → squash-merge.
- Two-key authZ rejects privileged settings change without ceremony PR.
- Lease reaper evicts stale leases after 5-minute grace window.
- Deferred (pilot, T059): live SC1–SC7 verification across 14-day pilot on 3 repos.

---

## Open Items

| Item | Severity | Notes |
|------|----------|-------|
| Helm bool coercion on `LORE_DARK_FACTORY_CLUSTER_ENABLED` | Medium | Use `--set-string` not `--set` to avoid YAML bool coercion; documented in CLAUDE.md |
| Context Core OCI promotion | Low | `context-core-builder.ts` exists; OCI artifact push and `crane pull` in install.sh not wired |
| Graphiti + FalkorDB deployment | Low | `scripts/graphiti/ontology.yaml` exists; deployment deferred indefinitely |
| Langfuse dependency in autoresearch | Low | `autoresearch.ts` reads gap signals from Langfuse (`LANGFUSE_PK/SK/HOST`). If Langfuse is not configured, the autoresearch loop silently skips. Cloud Monitoring gap metrics (`lore/gap_candidates`) are written but not consumed by autoresearch. |
| Dark Factory pilot SC1–SC7 verification | High | Live acceptance-criteria checks deferred to T059 (pilot). Three repos must pass 14 days each before T058 (legacy code deletion). |
| Legacy local-runner code deletion (T058) | Medium | Planned post-pilot follow-up. Gated on 3 pilot repos passing SC1–SC7 over 14 days (SC8). |
| Dark Factory cluster gate helm flag | Medium | Use `--set-string` not `--set` for `LORE_DARK_FACTORY_CLUSTER_ENABLED` to avoid YAML bool coercion. Must stay in sync with `claude-runner` image shipping `/app/dist/`. |

## Risk Register

| Risk | Severity | Likelihood | Notes |
|------|----------|------------|-------|
| Symbol indexing false negatives (unused symbols not indexed) | Medium | Low | Graph is best-effort; context assembly falls back to regex search |
| Memory table row explosion | Medium | Low | Episodes are consolidated via `memory-lifecycle.ts`; importance decay cleans up stale rows |
| Context assembly latency (large repos) | Medium | Medium | Mitigation: incremental indexing + caching (symbol defs are rarely updated) |
| Knowledge graph depth limited without Graphiti | Medium | Low | Flat PostgreSQL graph covers most use cases; temporal traversal is Phase 3+ |
| Context Core OCI promotion gap | Medium | Low | Current YAML templates serve context adequately; OCI adds distribution, not quality |
| Knowledge graph depth limited without Graphiti | Medium | Low | Flat PostgreSQL graph covers most use cases; temporal traversal is Phase 3+ |
| Developer adoption friction | High | Medium | Phase 0 gate enforced; lore-doctor diagnoses issues |
| Dark Factory misconfiguration blast radius | High | Low | Two-key AuthZ, path allowlist, trust ramp, default-off, every mutation audited |
| Helm bool coercion on cluster gate | Medium | Medium | Use `--set-string` for `LORE_DARK_FACTORY_CLUSTER_ENABLED`; documented in CLAUDE.md and runbook |
| Agent branch history rewriting invalidates audit trail | High | Low | Agents enforce by construction (no `--amend`, no force-push); documented constraint |
| GitHub API budget growth from auto-merge | Low | Low | ~+150 calls/day at 50 dark-mode tasks; well under 5000/hour installation limit |

## Critical Path

```
Phase 0 (scaffolding + GitHub App + PR template)
  → Phase 1 (code graph + context assembly + episode auto-curation)
    → Phase 2 (gap detection + spec-drift automation)
      → Phase 3 (autoresearch loop)
        → Phase 4 (dark factory pilot SC1–SC7)
          → Phase 4.1 (legacy code deletion)
```

PR description quality is the foundation. Without rich alternatives-rejected
sections in PRs, the ingested content is thin and gap detection finds nothing
to improve. Phase 4 adds a second gate: the pilot's SC1–SC7 verification must
pass before the legacy local-runner paths can be deleted.

## Generated Artifacts

Schema dump (CloudSQL): `script/db/schema.sql`  
OTEL traces: Cloud Trace  
Audit log: `pipeline.audit_log` (queryable via runbook)  
Helm chart: `scripts/helm/lore/`  