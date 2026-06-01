# Implementation Plan: Dark Factory Mode

| Field     | Value                                       |
|-----------|---------------------------------------------|
| Feature   | Dark Factory Mode                           |
| Branch    | 6-dark-factory                              |
| Status    | Planned                                     |
| Created   | 2026-04-28                                  |
| Estimated | 8 working days (5 phases)                   |

## Technical Context

| Component             | Choice                                                                |
|-----------------------|-----------------------------------------------------------------------|
| Language              | TypeScript (ESM, strict, ES2022) — supervisor + MCP routes            |
| Runtime               | Node.js 22                                                            |
| Workflow definition   | YAML files under `workflows/` (per Q1 clarification)                  |
| Graph executor        | New module `agent/src/workflow/executor.ts`                           |
| Trailer module        | New module `@re-cinq/lore-shared/commit-trailers.ts` (write + parse)  |
| Lease                 | Postgres `pipeline.task_leases` table with TTL (per Q4 clarification) |
| Path-allowlist match  | `minimatch` (glob, ESM)                                               |
| Audit log             | Existing `pipeline.audit_log` table; new event types                  |
| Settings AuthZ        | Two-key per Q3 clarification: admin-token + CODEOWNERS-label PR       |
| OTEL                  | Existing instrumentation; add `lore.stage.*` and `lore.lease.*` spans |
| Web-ui                | Existing Next.js app; add `/pipeline/[id]/timeline` view              |
| GitHub auto-merge     | `gh api` via existing `agent/src/platform.ts`; verify App permission  |
| Default model         | claude-haiku-4-5-20251001 (review nodes); existing per-flow overrides |

## Constitution Check

| Principle                          | Status     | Notes                                                                                                                                                |
|------------------------------------|------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| P1 DX-First Delivery               | PASS       | Dark mode is opt-in per repo; existing flows unchanged for opt-out repos.                                                                            |
| P2 Zero Stored Credentials         | PASS       | Workload Identity preserved; no new credential surface.                                                                                              |
| P3 PR Description Quality Gates    | PASS       | PR body adds `Lore-Task:` line; existing required sections preserved.                                                                                |
| P4 Three-Command Developer IF      | PASS       | No new commands; behavior change is invisible to developers using the existing 3 commands.                                                           |
| P5 Single Interface (Lore MCP)     | PASS       | All settings + task ops go through MCP; no new dev-facing surface.                                                                                   |
| P6 Distributed Ownership           | PASS       | Two-key AuthZ uses CODEOWNERS — strengthens distributed ownership.                                                                                   |
| P7 Architecture Decisions Are Final | **NOTE** | Supersedes the row "Task tracking — Pipeline tasks via Lore MCP + GH Issues". ADR-016 required (see Phase 5).                                       |
| P8 Schema-Per-Team Isolation       | PASS       | New tables (`task_leases`) live in `pipeline` schema; no cross-team leakage.                                                                         |
| P9 Intelligent Agents Over Scripts | PASS       | Strengthened — supervisor agents own end-to-end flows.                                                                                               |
| P10 Opt-In Data Collection         | PASS       | No new data collection.                                                                                                                              |
| P11 Intelligent Memory Lifecycle   | PASS       | Memory loop unchanged; `Lore-Task:` resolver augments retrospective episodes.                                                                        |

**Gate:** P7 violation justified by amendment procedure (clause 3): a superseding ADR with full alternatives-rejected (Phase 5, Task 5.1) plus a constitution MINOR bump (Phase 5, Task 5.2). Spec already cites this in `## Constitutional Impact`. No other gate violations.

## Project Structure

```
agent/
├── src/
│   ├── supervisor/
│   │   ├── index.ts            # NEW: supervisor entry — acquire lease, walk graph, release lease
│   │   ├── lease.ts            # NEW: acquire/refresh/release task_leases rows
│   │   └── graph-executor.ts   # NEW: interpret workflow YAML, dispatch nodes, emit stage commits
│   ├── workflows/              # NEW: built-in workflow YAML definitions
│   │   ├── implementation.yaml
│   │   ├── gap-fill.yaml
│   │   ├── runbook.yaml
│   │   ├── review.yaml
│   │   ├── feature-request.yaml
│   │   ├── onboard.yaml
│   │   └── general.yaml
│   ├── jobs/
│   │   ├── lease-reaper.ts     # NEW: expire stale leases (60s tick)
│   │   └── auto-merge.ts       # NEW: evaluate path-allowlist + trust + CI + bot-approval, merge if all green
│   └── (existing modules unchanged)

mcp-server/
├── src/
│   ├── routes.ts               # MODIFY: gate Issue creation behind dark_factory; new settings endpoints
│   ├── pipeline.ts             # MODIFY: support dark_factory_overrides per task; emit Lore-Task: trailer
│   └── settings-authz.ts       # NEW: two-key authorization for dark_factory.*

shared/  (the @re-cinq/lore-shared workspace)
└── src/
    └── commit-trailers.ts      # NEW: write/parse Lore-Stage:, Lore-Iteration:, Lore-Task: trailers

web-ui/
└── src/app/pipeline/[id]/
    └── Timeline.tsx            # NEW: render stage commit timeline from /api/tasks/:id/timeline

scripts/infra/
└── setup-dark-factory-schema.sh  # NEW: idempotent migration for task_leases + audit event types

specs/6-dark-factory/
├── spec.md                     # DONE
├── plan.md                     # this file
├── research.md                 # decisions on deferred items
├── data-model.md               # task_leases, settings shape, audit events
├── contracts/
│   ├── workflow-yaml-schema.md # YAML graph contract
│   ├── dark-factory-settings.md # settings API + AuthZ contract
│   └── timeline-api.md         # /api/tasks/:id/timeline contract
└── quickstart.md               # verification scenarios
```

## Phase 1: Foundation — branch-as-state + lease (2 days)

### Task 1.1: Schema migration

`scripts/infra/setup-dark-factory-schema.sh` (idempotent):

- `pipeline.task_leases` (`branch_name TEXT PRIMARY KEY`, `task_id UUID`, `holder TEXT`, `acquired_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`, `phase TEXT`)
- New audit_log event types: `auto_merge_decision`, `dark_factory_setting_changed`, `lease_expired`, `escalation_issued`
- New JSONB column `pipeline.tasks.dark_factory_overrides` (nullable, default null)
- New JSONB column `lore.repos.settings` is already JSONB; document the `dark_factory` sub-shape (see data-model.md)

### Task 1.2: Commit-trailer module

`shared/src/commit-trailers.ts`:

- `formatTrailers({stage, iteration, taskId, extras?})` → `string` ready for `git commit -m`
- `parseTrailers(commitMessage)` → `{stage, iteration, taskId, extras}` or `null`
- `lastStageOnBranch(branchName, gitDir?)` → walks `git log` and returns most recent stage trailer
- Tests: round-trip, multi-line bodies, no-trailer commits, malformed trailers
- Exported from `@re-cinq/lore-shared`

### Task 1.3: Lease module

`agent/src/supervisor/lease.ts`:

- `acquireLease(branchName, taskId, holder, ttlSec=600)` → `{acquired: boolean, currentHolder?: string}` using `INSERT … ON CONFLICT (branch_name) DO UPDATE … WHERE expires_at < now()`
- `refreshLease(branchName, holder, ttlSec=600)` → no-op if not held by `holder`
- `releaseLease(branchName, holder)` → DELETE WHERE branch_name AND holder
- `lease-reaper` job (`agent/src/jobs/lease-reaper.ts`) deletes rows where `expires_at < now() - interval '5 min'` every 60s
- OTEL spans: `lore.lease.acquire`, `lore.lease.refresh`, `lore.lease.release`, `lore.lease.expired`

### Task 1.4: Supervisor skeleton

`agent/src/supervisor/index.ts`:

- Entry: `runSupervisor({taskId, branchName, workflowName, gitDir})`
- Steps: acquire lease → load workflow YAML → call graph executor → release lease (always, in `finally`)
- On lease-already-held: log + exit cleanly (no work)
- On crash: lease TTL covers recovery; replacement supervisor re-acquires after expiry

### Task 1.5: PR body + trailer wiring

- `mcp-server/src/pipeline.ts` and `agent/src/jobs/loretask-watcher.ts`: when creating PRs, append `Lore-Task: <uuid>` line to PR body. Replace `Refs #<issue>` with `Lore-Task:` for dark-mode tasks; preserve `Refs #` for opt-out repos that still get an Issue.
- The final commit on every branch carries `Lore-Task:` trailer (FR1.1). Trailers are unconditional per Q5 clarification.

## Phase 2: Workflow graph (2 days)

### Task 2.1: YAML schema + loader

`agent/src/workflow/loader.ts`:

- Load and validate workflow YAML files from `agent/src/workflows/*.yaml` and from per-repo `settings.workflows[]` overrides if present
- Zod schema (see `contracts/workflow-yaml-schema.md`): nodes typed `agent | validate | gate | retrospective`, edges with conditions (`on: success | changes_requested | failed | always`), `entry` and `exit` node refs
- Cycle detection at load time; refuse cyclic graphs (loops via explicit `iteration` cap, not edges)

### Task 2.2: Graph executor

`agent/src/supervisor/graph-executor.ts`:

- `executeGraph({graph, ctx})` walks from `entry`, dispatches each node by type:
  - `agent`: render prompt, call LLM (or Claude Code headless), apply edits, commit with `Lore-Stage:<node-name>` trailer
  - `validate`: run lint/typecheck on changed files (existing `repo-validation.ts`), commit empty stage commit on success
  - `gate`: evaluate condition (e.g. `auto_merge_eligible`); branch follows on/off-edges
  - `retrospective`: write episode, curated memory, final empty `Lore-Stage:retrospective` commit
- Resume logic: at start, read `lastStageOnBranch(branchName)` and skip nodes already passed
- Refresh lease before each node

### Task 2.3: Migrate existing flows

Convert each entry in `scripts/task-types.yaml` to a workflow YAML graph in `agent/src/workflows/`. Behavior must match today on opt-out repos (verified by quickstart Scenario E). Map:

- `general` → linear: implement → validate → push → review → end
- `implementation` → loop: implement → validate → push → review → (if changes_requested AND iter < 2: address → loop) → end
- `gap-fill`, `runbook`, `feature-request`, `onboard` → linear with no review
- `review` → standalone: review → end (used as a node inside other graphs and as a standalone task)

### Task 2.4: Local runner adopts the graph executor

`mcp-server/src/local-runner.ts` reuses `graph-executor.ts` as a thin wrapper (T011a). Migration lands in Phase 2 so the MVP pilot has a single codepath across local + GKE (FR2.3). Lease is file-based (`~/.lore/leases/`) when no `LORE_DB_HOST` is configured. Legacy code paths superseded by this migration are deleted in Phase 10 (T058) once the new path has soaked.

## Phase 3: Opt-out gates (1.5 days)

### Task 3.1: Settings schema + AuthZ

`mcp-server/src/settings-authz.ts`:

- `setDarkFactorySettings(repo, patch, actor, ceremony)` — validates patch against Zod schema, requires admin scope; for `enabled` and `auto_merge.paths` keys, requires `ceremony.codeowners_label_pr` proof (PR URL with `dark-factory-approval` label by a CODEOWNERS member)
- All mutations write `audit_log` entry with type `dark_factory_setting_changed`, prev/new values, actor, ceremony evidence
- New routes: `GET/PUT /api/repos/:repo/settings/dark-factory`

### Task 3.2: Issue creation gate

`mcp-server/src/pipeline.ts`:

- Before creating an Issue at task creation, check repo settings:
  - `create_issue: never` → skip
  - `create_issue: on_gate` → skip unless `approval_required` is true
  - `create_issue: always` → create
- On escalation (`needs-human-help`): always create Issue with full diagnostic context (FR3.8)

### Task 3.3: Auto-merge engine

`agent/src/jobs/auto-merge.ts`:

- Triggered after `[stage:retrospective]` commit lands and PR is opened
- Evaluates: `auto_merge.paths` matches all changed paths (minimatch) AND `auto_merge.min_trust ≤ repo.trust.level` AND PR has green CI AND PR has bot review APPROVED AND no human-CHANGES_REQUESTED comments
- If all pass: `gh api -X PUT /repos/:owner/:repo/pulls/:n/merge` with squash strategy
- Audit log entry `auto_merge_decision` with rule trace
- If any fails: PR sits open per FR3.4 (review-and-await-human)

### Task 3.4: Notification gate

`agent/src/lib/notify.ts`:

- New helper `notify({channel, level, repo, ...})`; consults `settings.dark_factory.notify`
- `escalation` always fires; `watched` fires for tasks where the creator opted in via `notify_on_completion: true` at creation; otherwise silent

### Task 3.5: Per-task overrides

`mcp-server/src/pipeline.ts` `createTask()` accepts optional `dark_factory_overrides`:

```ts
{ human_review?: 'required', with_issue?: boolean, notify_on_completion?: boolean }
```

Stored in `pipeline.tasks.dark_factory_overrides` JSONB; merged with repo settings at supervisor start.

## Phase 4: Observability + UI (1 day)

### Task 4.1: OTEL span schema

`agent/src/lib/otel.ts`:

- New span types: `lore.stage` (one per workflow node, with attributes `stage_name`, `commit_sha`, `iteration`, `outcome`); `lore.lease.*` (acquire/refresh/release/expired); `lore.auto_merge.decision` (with attributes `decision`, `rule`, `trust_level`, `path_match_count`)
- Spans link to commit SHAs; trace IDs propagate from task creation to merge

### Task 4.2: Timeline API

`mcp-server/src/routes.ts`:

- `GET /api/tasks/:uuid/timeline` → reads commits from `git log` on the task's branch, parses trailers, returns ordered phase list with timestamps, SHAs, outcomes
- Resolves `Lore-Task: <uuid>` trailers from PR bodies via reverse lookup

### Task 4.3: Web-ui timeline view

`web-ui/src/app/pipeline/[id]/Timeline.tsx`:

- Vertical timeline of stage commits with node type icons, durations, outcome badges
- Embedded into the existing pipeline detail page; loaded once and refreshed every 10s while task is running

### Task 4.4: Repo dashboard panel

`web-ui/src/app/repos/[owner]/[repo]/page.tsx`:

- New "Dark Factory" panel: settings summary, this-week counts (dark-mode tasks, auto-merged, escalations), trust level, link to settings editor

## Phase 5: ADR + cutover (1.5 days)

### Task 5.1: ADR-016

`adrs/ADR-016-dark-factory-mode.md` (MADR):

- Decision: introduce per-repo dark-factory mode; supersede P7 row "Task tracking — Pipeline tasks via Lore MCP + GH Issues"
- Alternatives rejected: keep Issues mandatory; remove Issues entirely; auto-merge everywhere; multi-provider routing
- Constitution patch noted

### Task 5.2: Constitution patch

`.specify/memory/constitution.md`:

- MINOR version bump (2.0.0 → 2.1.0). The P7 principle ("Architecture Decisions Are Final") is unchanged; only its task-tracking decision row is amended via the procedure the principle itself prescribes.
- Update P7 task-tracking row to "Task tracking — Pipeline tasks via Lore MCP; GH Issues for exception surfaces (opt-out)"
- Sync impact report at top

### Task 5.3: Pilot rollout

- Enable `dark_factory.enabled = true` on three repos representing distinct trust tiers (`docs`, `tests`, `implementation`) — see SC8
- Monitor for 14 days each: handover count, pod-death survival, stale-PR window, escalation rate
- After all three pass SC1–SC7 thresholds: declare GA, default the flag for new onboardings to `true` (existing repos unchanged)

### Task 5.4: Documentation

- Update `CLAUDE.md` architecture section: "Workflow graph", "Branch-as-state", "Dark Factory mode"
- Update `docs/onboarding.md` with the dark-factory opt-in path
- Add a runbook: `runbooks/dark-factory-rollback.md` (how to flip `enabled = false` and reconcile in-flight tasks)

## Out of Scope (deferred to future specs)

- Operation phase (deploy / canary / auto-rollback / auto-incident-remediation)
- Parallel red-team agents (security-review, perf-review, doc-coverage)
- Removal of LoreTask CRD (CRD continues to spawn pods)
- Multi-provider model routing
- Workflow graph visualization beyond the basic timeline view (e.g. Mermaid renders, drag-and-drop editor)

## Quickstart (Verification Scenarios)

See `quickstart.md` for the seven verification scenarios derived from `spec.md`'s acceptance criteria.

## Agent Context

`update-agent-context.sh` is not present in this repo's `.specify/scripts/`. Manual update follow-up (Task 5.4): add to `CLAUDE.md` the new modules — `agent/src/supervisor/`, `agent/src/workflow/`, `shared/src/commit-trailers.ts`, `pipeline.task_leases` table, `dark_factory.*` settings shape.

---

## Implementation Addendum — Divergences from Plan

_Written post-implementation. Records what shipped vs. what was planned, so future agents reading this plan have accurate expectations._

### File structure changes

| Planned path | Actual path | Reason |
|---|---|---|
| `mcp-server/src/settings-authz.ts` | `mcp-server/src/dark-factory-settings.ts` + `mcp-server/src/dark-factory-authz.ts` | Split into schema/defaults vs. ceremony verification for cleaner separation |
| _(not planned)_ | `shared/src/dark-factory-settings.ts` | Canonical `ResolvedDarkFactorySettings` types moved to `@re-cinq/lore-shared` so agent, mcp-server, and pod runner share one source without importing across workspaces |
| `agent/src/workflow/executor.ts` | `agent/src/supervisor/graph-executor.ts` | Co-located in supervisor package; executor is a supervisor concern |
| _(not planned)_ | `agent/src/supervisor/runner-cli.ts` | Cluster pod CLI entry point — distinct from `supervisor/index.ts`. Needed its own module with a documented exit-code contract for `entrypoint.sh` |
| _(not planned)_ | `agent/src/supervisor/claude-code-handler.ts` | Agent-node handler for the cluster path extracted into its own factory so it can be injected and tested independently of the executor |
| _(not planned)_ | `agent/src/supervisor/handlers.ts` | Production handler registry wired in `runner-cli.ts`; separates wiring from executor logic |
| _(not planned)_ | `agent/src/jobs/dark-factory-baseline.ts` | Pre-feature baseline counter snapshot (T011b) for SC1/SC4/SC6 delta measurement; not in original plan scope |

### Architectural divergences

**1. Local runner migration deferred (Phase 2.4 not shipped)**

The plan's Phase 2.4 said "Local runner adopts the graph executor" and that the MVP would have a single codepath across local + GKE. In practice, local-runner.ts still uses the legacy `claude --print` path (T058 is open). The supervisor and graph executor exist and are used by Job pods on GKE, but `mcp-server/src/local-runner.ts` was not migrated. The `FileLeaseBackend` and `DbLeaseBackend` abstraction was built in preparation; the cutover is gated on pilot proving the new path.

**2. Two-gate enablement added**

The plan had a single per-repo `dark_factory.enabled` gate. The shipped design added a second cluster-level gate: `LORE_DARK_FACTORY_CLUSTER_ENABLED=true` on the agent deployment env. Both must be on for impl/general/review tasks to take the cluster supervisor path. The cluster gate prevents the Helm flag from running ahead of a compatible claude-runner image. `CLAUDE.md` documents the `--set-string` flag requirement to avoid YAML bool coercion.

**3. Two-key protected fields expanded**

Plan specified two-key AuthZ for `enabled` and `auto_merge.paths`. Actual `twoKeyFieldsTouched()` in `dark-factory-settings.ts` also gates `auto_merge.require_green_ci` and `auto_merge.require_bot_approval` when either is being **downgraded** to `false`. Downgrade protection was not in the original spec but was added to prevent accidental removal of safety constraints.

**4. Auto-merge outcome set expanded**

Plan described "7 deferral reasons + `merged`" (8 outcomes total). Actual `AutoMergeOutcome` has 9 defer outcomes + `merged` (10 total). Added: `no_changes` (branch has no file diff — skip silently) and `api_failure` (GitHub merge API failed after backoff — PR stays open). These address edge cases discovered during implementation.

**5. Pure + DB-backed function pairs**

Plan had single `shouldCreateIssue()` / `resolveReviewMode()` DB-backed functions. Actual implementation adds pure decision variants — `decideIssueCreate()` / `decideReviewMode()` — that take all inputs as arguments. The DB-backed `shouldCreateIssue()` / `resolveReviewMode()` call through to the pure functions. This split was necessary for unit testing without Postgres (TDD constraint from ADR-018).

**6. Runner-cli exit-code matrix**

The plan mentioned GKE pod execution but did not specify the exit-code contract. `runner-cli.ts` ships a documented 10-state matrix consumed by `entrypoint.sh` and `loretask-watcher`:

| Code | Meaning |
|---|---|
| 0 | completed |
| 2 | not_a_git_workdir |
| 3 | workflow_load_failed |
| 4 | workflow_not_found |
| 5 | lease_held |
| 6 | iteration_max_exceeded |
| 7 | executor_error |
| 8 | executor_pending |
| 9 | env_missing |

Exit 1 is reserved for Node uncaught exceptions. Watchers use the specific code to decide retry vs. `needs-human-help` escalation.

**7. `decideNotify()` API differs from plan**

Plan described `notify({channel, level, repo, ...})` as an imperative call. Actual `notify.ts` exports `decideNotify(level, settings)` as a pure decision function (returns `NotifyDecision`) — consistent with the pure/DB-backed split above. The actual Slack send is performed by callers.

### Deferred items still open

These were in the plan but not yet shipped:

- **T058** — Delete legacy local-runner code paths (blocked on pilot)
- **T059** — Pilot rollout on three trust-tiered repos (live action)
- **T060** — 14-day measured results vs. SC1–SC8 (follows T059)
- **T005** — Run schema migration against dev DB (shared-state action)
- **T024/T029/T035/T038/T043/T046/T053** — Live verification scenarios (all deferred to pilot)
