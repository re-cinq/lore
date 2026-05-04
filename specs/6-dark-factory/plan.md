# Implementation Plan: Dark Factory Mode

| Field     | Value                                                              |
|-----------|--------------------------------------------------------------------|
| Feature   | Dark Factory Mode                                                  |
| Branch    | 6-dark-factory                                                     |
| Status    | Implemented — Phases 1–9 complete; pilot + live verification deferred |
| Created   | 2026-04-28                                                         |
| Updated   | 2026-05-04 (as-built correction; 89% plan-to-reality divergence)   |
| Estimated | 8 working days (5 phases)                                          |

## Technical Context

| Component             | As-built                                                                              |
|-----------------------|---------------------------------------------------------------------------------------|
| Language              | TypeScript (ESM, strict, ES2022) — supervisor + MCP routes                            |
| Runtime               | Node.js 22                                                                            |
| Workflow definition   | YAML files `agent/src/workflows/*.yaml` (loaded by `agent/src/workflow/loader.ts`)    |
| Graph executor        | `agent/src/supervisor/graph-executor.ts` (not `workflow/executor.ts` as planned)      |
| Trailer module        | `shared/src/commit-trailers.ts` exported via `@re-cinq/lore-shared`                   |
| Lease                 | `agent/src/supervisor/lease.ts` — `LeaseBackend` interface; `DbLeaseBackend` (Postgres `pipeline.task_leases`) + `FileLeaseBackend` (`~/.lore/leases/`) selected via `leaseBackendForEnv()` |
| Path-allowlist match  | `agent/src/lib/path-match.ts` using `minimatch` (dot:true, ALL paths must match)      |
| Audit log             | `pipeline.audit_log` table; written via `agent/src/lib/audit.ts` `writeAuditLog()`    |
| Settings schema       | `mcp-server/src/dark-factory-settings.ts` (Zod + defaults); canonical types re-exported from `@re-cinq/lore-shared` (`shared/src/dark-factory-settings.ts`) |
| Settings AuthZ        | `mcp-server/src/dark-factory-authz.ts` — `verifyApproval()` ceremony; team-membership lookup stubbed (`team_membership_unresolved` error code) |
| OTEL                  | `lore.stage.*`, `lore.lease.*`, `lore.auto_merge.decision` spans                      |
| Web-ui timeline       | `web-ui/src/app/pipeline/[id]/Timeline.tsx` — polls every 10s                         |
| GitHub auto-merge     | `octokit.rest.pulls.merge()` with squash; exponential backoff (1s/4s)                 |
| Pod CLI entry         | `agent/src/supervisor/runner-cli.ts` — invoked by `entrypoint.sh` when `LORE_DARK_FACTORY_WORKFLOW` set; documented 10-code exit matrix |
| Agent node handler    | `agent/src/supervisor/claude-code-handler.ts` — spawns `claude --print`; decoupled from executor |

## Constitution Check

| Principle                           | Status   | Notes                                                                                                                                                |
|-------------------------------------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| P1 DX-First Delivery                | PASS     | Dark mode is opt-in per repo; existing flows unchanged for opt-out repos.                                                                            |
| P2 Zero Stored Credentials          | PASS     | Workload Identity preserved; no new credential surface.                                                                                              |
| P3 PR Description Quality Gates     | PASS     | `prFooter()` always emits `Lore-Task: <uuid>`; existing required sections preserved.                                                                 |
| P4 Three-Command Developer IF       | PASS     | No new commands; behavior change invisible to developers using existing 3 commands.                                                                  |
| P5 Single Interface (Lore MCP)      | PASS     | All settings + task ops go through MCP; no new dev-facing surface.                                                                                   |
| P6 Distributed Ownership            | PASS     | Two-key AuthZ uses CODEOWNERS — strengthens distributed ownership.                                                                                   |
| P7 Architecture Decisions Are Final | **NOTE** | Superseded row "Task tracking — Pipeline tasks via Lore MCP + GH Issues". ADR-016 authz via amendment procedure; constitution patched to v2.1.0.     |
| P8 Schema-Per-Team Isolation        | PASS     | New tables (`task_leases`, `dark_factory_baseline`, `audit_log`) live in `pipeline` schema.                                                          |
| P9 Intelligent Agents Over Scripts  | PASS     | Strengthened — supervisor agents own end-to-end flows via declarative YAML graph.                                                                    |
| P10 Opt-In Data Collection          | PASS     | No new data collection.                                                                                                                              |
| P11 Intelligent Memory Lifecycle    | PASS     | `Lore-Task:` trailer resolver augments retrospective episodes.                                                                                       |

**Gate:** P7 violation justified by amendment procedure (clause 3): superseding ADR-016 with full alternatives-rejected plus constitution MINOR bump to v2.1.0 (P7 row updated to "Pipeline tasks via Lore MCP; GH Issues for exception surfaces").

## As-Built Project Structure

```
agent/
├── src/
│   ├── supervisor/
│   │   ├── lease.ts              # LeaseBackend interface + DbLeaseBackend + FileLeaseBackend
│   │   ├── graph-executor.ts     # executeGraph(), resumeFromTrailers(), IterationMaxExceededError
│   │   ├── runner-cli.ts         # Pod CLI entry point (LORE_DARK_FACTORY_WORKFLOW); 10-code exit matrix
│   │   └── claude-code-handler.ts # createClaudeCodeAgentHandler(); spawns claude --print
│   ├── workflow/
│   │   └── loader.ts             # parseWorkflow(), loadWorkflowDir(); DFS cycle detection + reachability
│   ├── workflows/
│   │   ├── gap-fill.yaml         # draft → validate → push → retrospective
│   │   ├── general.yaml          # implement → validate → push → review → retrospective
│   │   └── implementation.yaml   # implement → validate → push → review → (address loop, max 2) → retrospective
│   ├── jobs/
│   │   ├── lease-reaper.ts       # 60s tick; deletes leases >5 min past expiry; writes lease_expired audit
│   │   ├── auto-merge.ts         # evaluateAutoMerge() pure + evaluateAndMerge() end-to-end; 8-outcome enum
│   │   └── dark-factory-baseline.ts  # captureBaselineForRepo() + captureBaselineAllRepos()
│   └── lib/
│       ├── dark-factory.ts       # decideIssueCreate() + decideReviewMode() pure + DB-backed wrappers
│       ├── escalation.ts         # escalate(); renderEscalationBody() pure; 3-attempt backoff + audit-only fallback
│       ├── path-match.ts         # allPathsMatch() (ALL paths must match); matchingPatterns() for audit trace
│       ├── notify.ts             # decideNotify(); 4 levels (escalation/watched/completion/pr_open)
│       ├── audit.ts              # writeAuditLog(); writes to pipeline.audit_log
│       └── pr-body.ts            # prFooter({taskId, issueNumber?}); always emits Lore-Task:, optional Refs #N

shared/
└── src/
    ├── commit-trailers.ts        # formatTrailers() / parseTrailers() / lastStageOnBranch(); re-exported from @re-cinq/lore-shared
    └── dark-factory-settings.ts  # canonical DarkFactorySettings type + resolveSettings() defaults (shared by agent + mcp-server + pod)

mcp-server/
└── src/
    ├── dark-factory-settings.ts  # DarkFactorySettingsSchema (Zod), parseDarkFactorySettings(), resolveSettings(), twoKeyFieldsTouched()
    ├── dark-factory-authz.ts     # verifyApproval(), parsePrRef(), isCodeowner(), TwoKeyError (12 error codes)
    └── routes.ts                 # GET/PUT /api/repos/:o/:r/settings/dark-factory; GET /api/tasks/:uuid/timeline; GET /api/tasks/by-pr/:o/:r/:n

web-ui/
└── src/app/pipeline/[id]/
    └── Timeline.tsx              # Vertical stage-commit timeline; polls every 10s while in-flight

scripts/infra/
└── setup-dark-factory-schema.sh  # Idempotent: pipeline.task_leases, pipeline.dark_factory_baseline, pipeline.audit_log, tasks.dark_factory_overrides column

adrs/
└── ADR-016-dark-factory-mode.md  # Accepted; supersedes ADR-009

runbooks/
└── dark-factory-rollback.md     # P1 (cluster-wide) + P2 (per-repo) rollback procedures
```

> **Divergences from original plan:** The original plan named `agent/src/workflow/executor.ts`, `mcp-server/src/settings-authz.ts`, and `agent/src/supervisor/index.ts` as the primary entry point. The as-built structure splits authz from schema (`dark-factory-authz.ts` / `dark-factory-settings.ts`), places the executor inside `supervisor/` (`graph-executor.ts`), adds an explicit pod CLI (`runner-cli.ts`), separates the agent node handler (`claude-code-handler.ts`), and adds several `lib/` helpers that were implied but not named in the plan.

---

## Phase 1: Foundation — branch-as-state + lease

### Task 1.1: Schema migration
`scripts/infra/setup-dark-factory-schema.sh` (idempotent):
- `pipeline.task_leases` (`branch_name TEXT PK`, `task_id UUID`, `holder TEXT`, `acquired_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`, `phase TEXT`)
- `pipeline.dark_factory_baseline` (`id UUID PK`, `repo TEXT`, `captured_at TIMESTAMPTZ`, `window_start/end TIMESTAMPTZ`, `counters JSONB`)
- `pipeline.audit_log` (`id UUID PK`, `event_type TEXT`, `task_id UUID?`, `repo TEXT?`, `actor TEXT?`, `payload JSONB`, `created_at TIMESTAMPTZ`)
- `pipeline.tasks.dark_factory_overrides JSONB DEFAULT NULL` column

### Task 1.2: Commit-trailer module
`shared/src/commit-trailers.ts` (re-exported from `@re-cinq/lore-shared`):
- `formatTrailers({stage, iteration, taskId, extras?})` → string for `git commit -m`
- `parseTrailers(commitMessage)` → `{stage, iteration, taskId, extras}` or `null` (strict — all required keys must be present and iteration must be a valid integer)
- `lastStageOnBranch(branchName, gitDir?)` → async, walks `git log`, returns most-recent stage trailer

### Task 1.3: Lease module
`agent/src/supervisor/lease.ts` — `LeaseBackend` interface with two implementations:
- **`DbLeaseBackend`**: `acquire/refresh/release` via Postgres CTE (`INSERT … ON CONFLICT … WHERE expires_at < now()`). `acquire()` returns `AcquireResult{acquired, currentHolder?, tookOverFrom?}`. `refresh()` accepts optional `phase` for milestone tracking.
- **`FileLeaseBackend`**: parallel implementation using JSON files under `~/.lore/leases/` for local/worktree mode when no `LORE_DB_HOST` is set.
- `leaseBackendForEnv()` factory selects the backend at startup.
- OTEL spans: `lore.lease.acquire`, `lore.lease.refresh`, `lore.lease.release`.
- `agent/src/jobs/lease-reaper.ts`: 60s tick deletes rows where `expires_at < now() - interval '5 min'`; writes `lease_expired` audit entries; emits `lore.lease.expired` span.

### Task 1.4: Pod CLI entry point
`agent/src/supervisor/runner-cli.ts` — `main()` invoked by `entrypoint.sh` when `LORE_DARK_FACTORY_WORKFLOW` is set. Loads workflow from `/app/dist/workflows/`, acquires lease, drives `executeGraph()`, exits with documented codes:

| Code | Meaning |
|------|---------|
| 0 | Completed successfully |
| 2 | Not a valid git working directory |
| 3 | Workflow YAML failed to parse/validate |
| 4 | Named workflow not found in `/app/dist/workflows/` |
| 5 | Lease held by another pod (exit cleanly) |
| 6 | `iteration_max` exceeded (escalated) |
| 7 | Graph executor runtime error |
| 8 | Executor returned unexpected pending state (config bug) |
| 9 | Required env var missing (`MissingEnvError`) |
| 1 | Uncaught exception |

Auto-merge is **not** performed by the pod. `loretask-watcher` owns PR creation and triggers auto-merge after the pod completes.

### Task 1.5: PR body trailer
`agent/src/lib/pr-body.ts` — `prFooter({taskId, issueNumber?})`:
- Always emits `Lore-Task: <uuid>` (unconditional, per FR1.5).
- Appends `Refs #N` only when `issueNumber` is present (dark-mode PRs without Issues omit the `Refs` line).
- Wired into `worker.ts` (4 PR creation sites) and `loretask-watcher.ts`.

---

## Phase 2: Workflow graph

### Task 2.1: YAML schema + loader
`agent/src/workflow/loader.ts`:
- `parseWorkflow(yaml)` validates against Zod schema (node types: `agent | validate | gate | retrospective`; edge conditions: `success | changes_requested | failed | always`; back-edges require `iteration_max`).
- `loadWorkflowDir(dir)` loads all `*.yaml` from a directory.
- DFS cycle detection with coloring: back-edges without `iteration_max` are rejected. Reachability check ensures every node is reachable from `entry`. Detailed error messages per violation via `WorkflowLoadError`.

### Task 2.2: Graph executor
`agent/src/supervisor/graph-executor.ts`:
- `executeGraph({workflow, handlers, leaseBackend, branchName, holder, gitDir, ctx})` → `ExecutionSummary{visited[], resumedFromNode?, reachedExit}`.
- On entry: calls `lastStageOnBranch()` → `resumeFromTrailers()` to skip already-committed phases.
- Per node: refreshes lease → dispatches to caller-provided handler → commits stage commit with `formatTrailers()` (allow-empty for non-file-changing nodes).
- Node dispatch is caller-provided via `handlers` map; `builtinHandlers` supplies stubs for `validate`, `gate`, `retrospective` (real implementations plugged by runner-cli or local-runner).
- `StageOutcome`: `"success" | "changes_requested" | "failed"`.
- `IterationMaxExceededError` thrown when a back-edge's `iteration_max` is reached; carries full context and fires the optional `onIterationMaxExceeded` hook before throwing so callers can call `escalate()`.
- `resumeFromTrailers(workflow, trailers)` is a pure function exported for testing.

### Task 2.3: Agent node handler
`agent/src/supervisor/claude-code-handler.ts` — `createClaudeCodeAgentHandler()`:
- Resolves prompt via `deps.resolvePrompt(promptRef, taskDescription)`.
- Spawns `claude --print` in the task's git dir (cluster path; no SDK fallback).
- Maps outcomes: exit 0 → `success`; non-zero → `"cli-nonzero"`; thrown error → `"cli-error"`; missing prompt → `"config-error"`.
- Records `Lore-CLI-Duration-Ms` as an extra trailer field.

### Task 2.4: Workflow YAML files
Three built-in workflows (all in `agent/src/workflows/`):

- **`gap-fill.yaml`**: `draft → validate → push → retrospective → done` (linear, no review loop)
- **`general.yaml`**: `implement → validate → push → review → retrospective → done` (linear; all review outcomes route to retrospective)
- **`implementation.yaml`**: `implement → validate → push → review → (changes_requested: address → validate back-edge, iteration_max=2) → retrospective` (bounded loop)

Additional planned workflows (`runbook.yaml`, `feature-request.yaml`, `onboard.yaml`, `review.yaml`) are not yet authored; the loader supports them as-is when files are added.

---

## Phase 3: Opt-out gates

### Task 3.1: Settings schema + AuthZ

Settings are split across two files:

**`mcp-server/src/dark-factory-settings.ts`** (also `shared/src/dark-factory-settings.ts` for cross-package sharing):
- `DarkFactorySettingsSchema` (Zod) — `enabled`, `create_issue`, `auto_merge{paths,min_trust,require_green_ci,require_bot_approval}`, `review`, `notify`.
- `resolveSettings(partial)` applies defaults when `enabled=true`:
  - `auto_merge.paths = ["specs/**", "adrs/**", "*.md", "CLAUDE.md", ".claude/**"]`
  - `min_trust = "docs"`, `require_green_ci = true`, `require_bot_approval = true`
  - `create_issue = "on_gate"`, `review = "trust_based"`, `notify = []` (escalations always fire regardless)
- `twoKeyFieldsTouched(patch)` — returns true when the patch touches `enabled`, `auto_merge.paths`, or downgrades `require_green_ci`/`require_bot_approval` to false. Only downgrades of security flags require two-key; upgrades do not.

**`mcp-server/src/dark-factory-authz.ts`**:
- `verifyApproval(repo, approvalPrRef, octokit)` — checks `X-Lore-Approval-PR` is open + labeled `dark-factory-approval` + label applied by a CODEOWNERS member. Tries `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` in order.
- 12 typed error codes on `TwoKeyError`: `missing_header | invalid_pr_ref | pr_not_found | pr_state | label_missing | approver_not_codeowner | team_membership_unresolved | codeowners_unparseable | github_api | wrong_repo`.
- **Team-membership lookup is stubbed in v1** — returns `team_membership_unresolved` when a CODEOWNERS entry is a team (`@org/team`). Per-path CODEOWNERS tightening is a follow-up.

Routes `GET/PUT /api/repos/:owner/:repo/settings/dark-factory` in `mcp-server/src/routes.ts` require `admin` scope. PUT merges at the `auto_merge` sub-object level (not wholesale replace), runs two-key when `twoKeyFieldsTouched()` is true, writes `dark_factory_setting_changed` audit entry with prev/next states and ceremony metadata.

### Task 3.2: Issue creation gate
`agent/src/lib/dark-factory.ts`:
- `decideIssueCreate({approvalNeeded, settings, overrides})` → pure, 7 distinct decision reasons. `approval_required_overrides_dark_mode` wins over `create_issue: never` and per-task `with_issue: false`.
- `shouldCreateIssue(task)` → async DB-backed wrapper.
- Before creating an Issue: `create_issue: never` → skip; `create_issue: on_gate` → skip unless `approval_required: true`; `create_issue: always` → create; escalations always create regardless.

### Task 3.3: Auto-merge engine
`agent/src/jobs/auto-merge.ts`:
- `evaluateAutoMerge(inputs: AutoMergePolicyInputs)` → pure `AutoMergeDecision{outcome, rule}`. Testable without I/O.
- `evaluateAndMerge(inputs)` → calls `evaluateAutoMerge`, calls `octokit.rest.pulls.merge()` with squash strategy, writes `auto_merge_decision` audit entry, degrades to `deferred:api_failure` on final failure (PR stays open). Exponential backoff: 1s then 4s.
- `AutoMergeOutcome` enum (8 deferral reasons + `merged`): `merged | deferred:human_review | deferred:ci_failed | deferred:bot_changes_requested | deferred:path_outside_allowlist | deferred:trust_too_low | deferred:dark_mode_off | deferred:api_failure`.
- Trust level ordering: `"docs" < "tests" < "implementation" < "full"`.
- OTEL span `lore.auto_merge.decision` with attributes: `pr_number`, `task_id`, `repo`, `decision`, `path_match_count`, `trust_level`, `ci_status`, `bot_review_state`.

### Task 3.4: Notification gate
`agent/src/lib/notify.ts` — `decideNotify(level, settings)`:
- 4 levels: `escalation | watched | completion | pr_open`.
- 3 channel keywords: `escalation | watched | all`.
- `escalation` level always fires (never silenced), even with empty `notify` list.
- `pr_open` fires only with `all` channel (suppresses per-PR noise in dark mode).
- `watched` / `completion` fire only when `"watched"` is in the channel list.

### Task 3.5: Per-task overrides
`pipeline.tasks.dark_factory_overrides JSONB` accepts `{human_review?: 'required', with_issue?: boolean, notify_on_completion?: boolean}`. Merged with repo settings at supervisor start. `human_review: 'required'` forces review mode to `always` regardless of repo settings.

---

## Phase 4: Observability + UI

### Task 4.1: OTEL spans
- `lore.stage` — one per workflow node; attributes: `stage_name`, `commit_sha`, `iteration`, `outcome`.
- `lore.lease.*` — acquire / refresh / release / expired.
- `lore.auto_merge.decision` — wraps `evaluateAndMerge()`; full policy attribute set.

### Task 4.2: Timeline API
`mcp-server/src/routes.ts`:
- `GET /api/tasks/:uuid/timeline` — walks branch via Octokit `repos.listCommits`, parses trailers via shared `parseTrailers()`, computes phase durations, returns ordered phase list with timestamps / SHAs / outcomes / lease state / PR state. Degraded payload when branch is deleted.
- `GET /api/tasks/by-pr/:owner/:repo/:pr_number` — fast-path queries `pipeline.tasks` by `pr_number`; fallback fetches PR body + final commit and parses `Lore-Task:` trailer.

### Task 4.3: Web-ui timeline
`web-ui/src/app/pipeline/[id]/Timeline.tsx` — client component, vertical stage-commit timeline. Node-type icons, outcome badges (success green / changes_requested amber / failed red), commit SHA links to GitHub, lease holder + expiry indicator. Polls `/api/pipeline/:id/timeline` every 10s while task is in active states or `current_stage` is not `retrospective`.

### Task 4.4: Repo dashboard panel
`web-ui/src/app/repos/[owner]/[repo]/page.tsx` — "Dark Factory" panel: Mode (Enabled / Off legacy), Trust level, Tasks (7d), Auto-merged (7d), Escalations (7d). Counts query `pipeline.audit_log` by `event_type`; degrades gracefully if the table doesn't exist on legacy clusters.

---

## Phase 5: ADR + cutover

### Task 5.1: ADR-016
`adrs/ADR-016-dark-factory-mode.md` (MADR, status: accepted). Decision: per-repo dark-factory mode, 4 sub-decisions. 5 alternatives rejected. Constitutional impact documented.

### Task 5.2: Constitution patch
`.specify/memory/constitution.md` patched to v2.1.0 (MINOR). P7 task-tracking row updated. Sync Impact Report added at top. `last_amended: 2026-04-28`.

### Task 5.3: Baseline capture
`agent/src/jobs/dark-factory-baseline.ts` — `captureBaselineForRepo()` / `captureBaselineAllRepos()`. Counters written to `pipeline.dark_factory_baseline` (one row per repo per capture):
- `job_pods_per_impl_task_p50` — static placeholder (4) until OTEL integration.
- `issues_per_week` — computed from `audit_log` window.
- `bot_pr_no_human_review_share` — placeholder (0) until pr-merge-check data accumulates.
- `median_time_to_merge_hours` — computed from `pipeline.tasks` window.

### Task 5.4: Pilot rollout (deferred)
Enable `dark_factory.enabled = true` on three repos at trust tiers `docs`, `tests`, `implementation`. Monitor for 14 days each against SC1–SC7 thresholds. After all three pass: declare GA; new repo onboardings default `enabled: true` (existing repos unchanged).

### Task 5.5: Documentation
- `CLAUDE.md` updated — 14 new dark-factory component entries; "Dark Factory mode" subsection with settings, two-key, branch-as-state, auto-merge, rollback reference.
- `runbooks/dark-factory-rollback.md` — pre-flight forensics, per-repo P2 rollback (two-key disable + lease reconciliation), cluster-wide P1 rollback (bulk SQL + audit trail + Slack escalation).

---

## Deferred Items

| Task | Reason deferred |
|------|-----------------|
| T005 | DB migration verification — shared-state action; runs at deploy |
| T024 / T029 / T035 / T038 / T043 / T046 / T053 | Live quickstart verification — requires pilot cluster |
| T058 | Legacy local-runner deletion — waits for pilot proving the new path |
| T059 | Pilot rollout (live action — 14-day soak per repo tier) |
| T060 | Measured-results memo vs SC1–SC8 (runs after T059) |
| Team-membership CODEOWNERS | `team_membership_unresolved` error code; per-path CODEOWNERS tightening is follow-up |
| Remaining workflow YAMLs | `runbook.yaml`, `feature-request.yaml`, `onboard.yaml`, `review.yaml` not yet authored |

---

## Out of Scope (deferred to future specs)

- Operation phase (deploy / canary / auto-rollback / auto-incident-remediation)
- Parallel red-team agents (security-review, perf-review, doc-coverage)
- Removal of LoreTask CRD
- Multi-provider model routing
- Workflow graph visualization (Mermaid renders, drag-and-drop editor)

---

## Quickstart (Verification Scenarios)

See `quickstart.md` for the seven verification scenarios derived from `spec.md`'s acceptance criteria (Scenarios A–G). All deferred to pilot rollout (T059).
