# Tasks: Dark Factory Mode

| Field    | Value             |
|----------|-------------------|
| Feature  | Dark Factory Mode |
| Branch   | 6-dark-factory    |
| Created  | 2026-04-28        |
| Plan     | [plan.md](./plan.md) |
| Spec     | [spec.md](./spec.md) |

## User story → priority map

Derived from `spec.md`'s seven acceptance scenarios. Priorities reflect delivery order (foundation → MVP → refinements → UI), not relative business value.

| ID  | Story (Spec scenario)                                    | Priority |
|-----|----------------------------------------------------------|----------|
| US1 | Routine doc PR auto-merges (Scenario 1)                  | P1 (MVP) |
| US2 | Implementation task survives pod death (Scenario 2)      | P1       |
| US3 | Code change still requires human review (Scenario 3)     | P2       |
| US4 | Approval gate produces an Issue (Scenario 4)             | P2       |
| US5 | Escalation produces an Issue with full context (Scenario 5) | P2    |
| US6 | Repo opts out of dark mode (Scenario 6)                  | P1       |
| US7 | PR-to-task cross-reference (Scenario 7)                  | P3       |

**MVP scope:** Phase 1 + Phase 2 + US1 (auto-merge end-to-end on a single repo opted in via the two-key ceremony) + US6 (opt-out repos unchanged) + US2 (pod-death survival). Everything after that is incremental.

---

## Phase 1: Setup

- [X] T001 Create migration script `scripts/infra/setup-dark-factory-schema.sh` (skeleton, idempotent runner with `[lore]` prefixed output, exit codes 0/1)
- [X] T002 [P] Add `minimatch` dependency to `agent/package.json` and `mcp-server/package.json`; run `npm install` in each
- [X] T003 [P] Add scaffolding directory `agent/src/workflows/` with a `README.md` describing YAML location convention

## Phase 2: Foundational (blocking prerequisites)

These MUST complete before any user-story phase. They establish branch-as-state, the lease, and the trailer module — every later phase depends on them.

- [X] T004 Implement schema migration in `scripts/infra/setup-dark-factory-schema.sh`: create `pipeline.task_leases` table, create `pipeline.dark_factory_baseline` table (columns: `id UUID PK`, `repo TEXT`, `captured_at TIMESTAMPTZ`, `window_start TIMESTAMPTZ`, `window_end TIMESTAMPTZ`, `counters JSONB`), create `pipeline.audit_log` table (the existing `memory.audit_log` is memory-scoped and lacks task/repo fields), add `dark_factory_overrides` JSONB column to `pipeline.tasks`. All idempotent (`IF NOT EXISTS`)
- [ ] T005 Run the migration against the dev DB and verify with `\d pipeline.task_leases` and `\d pipeline.tasks` (deferred — shared-state action; run when ready)
- [X] T006 [P] Implement `shared/src/commit-trailers.ts` exporting `formatTrailers()`, `parseTrailers()`, `lastStageOnBranch()`. Unit tests in `shared/src/__tests__/commit-trailers.test.ts` covering: round-trip, multi-line bodies, no-trailer commits, malformed trailers
- [X] T007 [P] Re-export `commit-trailers` module from `@re-cinq/lore-shared` package index (`shared/src/index.ts`)
- [X] T008 Implement `agent/src/supervisor/lease.ts` with `acquireLease()`, `refreshLease()`, `releaseLease()` functions using `INSERT … ON CONFLICT … WHERE expires_at < now()` semantics. Unit tests in `agent/src/__tests__/lease.test.ts` covering: acquire-from-empty, takeover-after-expiry, refresh-only-by-holder, release-only-by-holder, race between two acquirers
- [X] T009 [P] Implement `agent/src/jobs/lease-reaper.ts` — 60s tick deleting rows where `expires_at < now() - interval '5 min'`; emits `lease_expired` audit_log entries; OTEL span `lore.lease.expired` (scheduler registration deferred to T060 alongside other dark-factory cron wiring)
- [X] T010 Wire OTEL spans `lore.lease.acquire`, `lore.lease.refresh`, `lore.lease.release` into `lease.ts`; verify trace propagation with the existing OTEL collector (`@opentelemetry/api` added to agent; spans noop without a tracer provider, full propagation requires agent-side OTEL setup — tracked separately)
- [X] T011 Implement `agent/src/supervisor/index.ts` skeleton: `runSupervisor({taskId, branchName, workflowName, gitDir})` that acquires lease → loads workflow YAML → calls graph executor stub (returns immediately) → releases lease in `finally`. Handles "lease already held" by exiting cleanly
- [X] T011a [P] Lease backend abstraction with DB + file backends (`DbLeaseBackend`, `FileLeaseBackend` in `agent/src/supervisor/lease.ts`); supervisor selects backend via `leaseBackendForEnv()` (DB when `LORE_DB_HOST` set, file under `~/.lore/leases/` otherwise). **Local-runner.ts surgery deferred to a follow-up task once the graph executor exists (T014)** — the backend abstraction is the foundation; the actual local-runner cutover lands as a new task in Phase 3
- [X] T011b Capture pre-feature baseline counters for SC1/SC4/SC6 measurement: scan `pipeline.tasks`, `audit_log`, and GitHub PR metadata for the last 30 days; compute per-repo counters (Job pods per implementation task, GitHub Issues created by Lore per week, share of bot PRs merged with no human review, median time-to-merge for bot PRs). Persist to the new `pipeline.dark_factory_baseline` table (one row per repo, one snapshot per capture). T060 compares post-pilot 30-day window against this snapshot to compute deltas

## Phase 3: User Story 1 — Routine doc PR auto-merges (P1, MVP)

**Independent test:** Quickstart Scenario A. A `gap-fill` task on a dark-mode-enabled repo produces a merged PR within 24h with no GitHub Issue and the full stage commit chain on the branch.

- [X] T012 [P] [US1] Implement workflow YAML loader in `agent/src/workflow/loader.ts` with Zod schema per `contracts/workflow-yaml-schema.md`; load from `agent/src/workflows/*.yaml` at supervisor startup; cycle detection without `iteration_max` rejects the graph
- [X] T013 [P] [US1] Author `agent/src/workflows/gap-fill.yaml` matching the linear flow: draft → validate → push → retrospective → done
- [X] T014 [US1] Implement graph executor in `agent/src/supervisor/graph-executor.ts`: walks from `entry`, dispatches each node by type (agent/validate/gate/retrospective), commits a stage commit at end of each node with `formatTrailers()`, refreshes lease before each node
- [X] T015 [US1] Implement resume logic in `graph-executor.ts`: at start, call `lastStageOnBranch(branchName)` and skip nodes already passed (the resume path is shared with US2)
- [X] T016 [P] [US1] Add Zod schema for `dark_factory.*` settings in `mcp-server/src/dark-factory-settings.ts` per `data-model.md`; export `parseDarkFactorySettings()`, `resolveSettings()`, `twoKeyFieldsTouched()`, `trustMeets()`
- [X] T017 [US1] Implement two-key AuthZ in `mcp-server/src/dark-factory-authz.ts`: `verifyApproval()` checks `X-Lore-Approval-PR` is open + labeled `dark-factory-approval` + label applied by a CODEOWNERS member of the affected repo's `CLAUDE.md`. Wired into the PUT route's privileged-field path (FR3.9)
- [X] T018 [US1] Routes `GET /api/repos/:owner/:repo/settings/dark-factory` and `PUT /api/repos/:owner/:repo/settings/dark-factory` in `mcp-server/src/routes.ts` per `contracts/dark-factory-settings.md`. Admin scope on the URL prefix; two-key on privileged fields; transactional update + audit entry
- [X] T019 [US1] Modified `agent/src/worker.ts` to consult `agent/src/lib/dark-factory.ts` `shouldCreateIssue()` before creating a GitHub Issue. Skips per `create_issue: never` / `create_issue: on_gate` (when no approval gate). Approval-required tasks always get an Issue (Issue is the gate surface). Per-task `with_issue: true` overrides force creation
- [X] T020 [P] [US1] Path-allowlist matcher in `agent/src/lib/path-match.ts` using `minimatch` (dot:true). `allPathsMatch()` returns true only when every changed path matches at least one glob; `matchingPatterns()` lists which patterns matched a path (for audit trace)
- [X] T021 [US1] Auto-merge engine in `agent/src/jobs/auto-merge.ts`: pure `evaluateAutoMerge()` decision function plus `evaluateAndMerge()` end-to-end job that calls `octokit.rest.pulls.merge()` with squash strategy, exponential backoff per research R3 (1s/4s/16s), writes `auto_merge_decision` audit entry, degrades to `deferred:api_failure` on final failure (PR stays open). Outcome enum covers all 7 deferral reasons + `merged`
- [X] T022 [P] [US1] Notification gate in `agent/src/lib/notify.ts` `decideNotify(level, settings)`: `escalation` always fires, `watched` fires only when configured, `pr_open` requires `all` channel (dark mode silences per-PR Slack noise)
- [X] T023 [US1] OTEL span `lore.auto_merge.decision` wraps `evaluateAndMerge()` with `pr_number`, `task_id`, `repo`, `decision`, `path_match_count`, `trust_level`, `ci_status`, `bot_review_state` attributes
- [ ] T024 [US1] End-to-end smoke: enable dark mode on `re-cinq/test-darkmode` via the two-key ceremony, trigger `gap-fill`, verify quickstart Scenario A passes (PR merged, no Issue, all stages present, audit entry written) — **deferred** (shared-state action; runs after deploy)

## Phase 4: User Story 2 — Pod-death survivability (P1)

**Independent test:** Quickstart Scenario B. Killing a supervisor pod mid-flow leads to a replacement that resumes from `git log` and completes without re-executing committed phases.

- [ ] T025 [US2] Add lease TTL refresh hook before each node in `graph-executor.ts` (extends T014); ensures the 10-minute TTL is renewed on each phase
- [ ] T026 [US2] Implement supervisor restart guard in `agent/src/supervisor/index.ts`: when lease is held by another holder, exit code 0; when lease is expired and re-acquired, log takeover with previous holder name
- [ ] T027 [US2] Add audit_log emission for takeover events: `lease_expired` with `previous_holder` field (extends T009)
- [ ] T028 [US2] Implement chaos test in `agent/src/__tests__/pod-death.test.ts` (or scripted under `scripts/chaos/`): start a supervisor, after the second stage commit kill the process, start a fresh supervisor, assert: same branch, no duplicate stage commits, lease taken over, full chain to retrospective
- [ ] T029 [US2] Verify quickstart Scenario B passes against the dev cluster (or local equivalent): kill pod, wait for lease expiry, observe replacement, inspect `git log` and audit_log

## Phase 5: User Story 3 — Code change still requires human review (P2)

**Independent test:** Quickstart Scenario C. A `general` task editing `agent/src/*` produces a PR that does NOT auto-merge and shows a clear deferral reason in the audit log.

- [ ] T030 [P] [US3] Author `agent/src/workflows/general.yaml` per the implementation flow described in `contracts/workflow-yaml-schema.md` (linear: implement → validate → push → review → retrospective); register in loader
- [ ] T031 [P] [US3] Author `agent/src/workflows/implementation.yaml` with the loop: implement → validate → push → review → (changes_requested with iteration_max=2: address → validate → ...) → retrospective
- [ ] T032 [US3] Extend `auto-merge.ts` (T021) deferral logic: emit `outcome: "deferred:path_outside_allowlist"` when `allPathsMatch` returns false; PR is left open
- [ ] T033 [US3] Implement `review` workflow node behavior in `graph-executor.ts`: when `dark_factory.review = trust_based` and path is outside allowlist, post bot review comments + verdict and STOP (FR3.4); does not trigger auto-merge engine
- [ ] T034 [US3] Modify `mcp-server/src/pipeline.ts` to compute and persist the effective `review` mode per task (merging repo settings + per-task overrides) so the supervisor reads a single resolved value
- [ ] T035 [US3] Verify quickstart Scenario C passes: create general task, observe PR not auto-merged, audit log shows `deferred:path_outside_allowlist`

## Phase 6: User Story 4 — Approval gate produces an Issue (P2)

**Independent test:** Quickstart Scenario D. A task with `approval_required: true` creates an Issue, blocks until labeled, then proceeds.

- [ ] T036 [US4] In `mcp-server/src/pipeline.ts` `createTask()` (extends T019): when `approval_required: true`, force Issue creation regardless of `create_issue: never` setting (per data-model.md: per-task overrides cannot weaken approval gates)
- [ ] T037 [US4] Verify the existing `agent/src/jobs/approval-check.ts` polls the Issue label and triggers supervisor start unchanged under dark mode
- [ ] T038 [US4] Verify quickstart Scenario D passes: approval-required task creates Issue, no commits until label, post-label workflow proceeds

## Phase 7: User Story 5 — Escalation produces an Issue with full context (P2)

**Independent test:** Quickstart Scenario E. A task that fails validation twice creates an Issue with branch link, validation output, contributing facts/memories, and fires a Slack escalation.

- [ ] T039 [P] [US5] Implement `agent/src/lib/escalation.ts`: `escalate({taskId, branchName, reason, diagnostic, contributingRefs})` creates a GitHub Issue with structured body (task description, branch URL, failing-phase output, diagnostic, links to facts/memories), writes `escalation_issued` audit entry, calls `notify({channel: 'escalation', ...})`
- [ ] T040 [US5] Wire `escalation.ts` into `graph-executor.ts` validate-failure path: when iteration limit on validate edge is reached, mark task `needs-human-help` and call `escalate()`
- [ ] T041 [US5] Implement Issue-creation retry/degrade per research.md R3: retry 3x with backoff; on final failure, write audit entry with `outcome: audit_only` and inline full context into the Slack message
- [ ] T042 [US5] Verify the escalation Issue includes a clickable link to `git log <branch>` for the partial work
- [ ] T043 [US5] Verify quickstart Scenario E passes: force a syntax-error implementation, observe two iterations, observe Issue with diagnostic + Slack escalation

## Phase 8: User Story 6 — Repo opts out of dark mode (P1)

**Independent test:** Quickstart Scenario F. A repo with `dark_factory.enabled = false` behaves identically to pre-feature; trailers ARE still emitted (Q5 clarification).

- [ ] T044 [P] [US6] Verify default at migration time: all existing rows in `lore.repos` have no `dark_factory.enabled` set; `parseDarkFactorySettings()` (T016) defaults to `enabled: false`
- [ ] T045 [US6] Audit every code path touched in Phases 3–7 to ensure all behavior changes are gated on `enabled === true`; trailers (T006/T014) are NOT gated and emit unconditionally
- [ ] T046 [US6] Verify quickstart Scenario F passes on a non-pilot repo: trigger any task type, observe today's behavior (Issue per task, no auto-merge), confirm trailers present in `git log`

## Phase 9: User Story 7 — PR-to-task cross-reference (P3)

**Independent test:** Quickstart Scenario G. From a merged PR URL or a task UUID, the web-ui resolves to the other side and renders the stage timeline.

- [ ] T047 [P] [US7] Modify PR-creation paths in `mcp-server/src/pipeline.ts` and `agent/src/jobs/loretask-watcher.ts` to append `Lore-Task: <uuid>` to PR body; for dark-mode tasks, replace the `Refs #<issue>` line; for opt-out repos, keep `Refs #` and add `Lore-Task:` alongside
- [ ] T048 [P] [US7] Implement `GET /api/tasks/:uuid/timeline` in `mcp-server/src/routes.ts` per `contracts/timeline-api.md`: walks `git log` on the task's branch, parses trailers, returns ordered phase list with timestamps, SHAs, durations, outcomes
- [ ] T049 [P] [US7] Implement `GET /api/tasks/by-pr/:owner/:repo/:pr_number` reverse resolver in `routes.ts`: looks for `Lore-Task: <uuid>` in PR body, falls back to final commit's trailer
- [ ] T050 [US7] Implement `web-ui/src/app/pipeline/[id]/Timeline.tsx`: vertical timeline using existing TailwindUI/shadcn primitives; node type icons, durations, outcome badges, SHA links to GitHub
- [ ] T051 [US7] Wire Timeline.tsx into the existing pipeline detail page; auto-refresh every 10s while task in-flight, stop polling once `current_stage = retrospective` and `lease.held = false`
- [ ] T052 [US7] Implement repo dashboard "Dark Factory" panel in `web-ui/src/app/repos/[owner]/[repo]/page.tsx`: settings summary, this-week counts (dark tasks, auto-merged, escalations), trust level, link to settings editor
- [ ] T053 [US7] Verify quickstart Scenario G passes: open merged PR in web-ui, timeline renders; navigate by task UUID, opens same view

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T054 Author ADR `adrs/ADR-016-dark-factory-mode.md` (MADR format): decision, alternatives rejected (keep Issues mandatory; remove Issues entirely; auto-merge everywhere; multi-provider routing), consequences; supersedes the P7 row "Task tracking — Pipeline tasks via Lore MCP + GH Issues"
- [ ] T055 Patch `.specify/memory/constitution.md`: bump to v2.1.0 (MINOR — P7 principle unchanged, only its task-tracking decision row is amended); update the task-tracking row to "Task tracking — Pipeline tasks via Lore MCP; GH Issues for exception surfaces (opt-out)"; add Sync Impact Report header documenting the row-level change
- [ ] T056 [P] Update `CLAUDE.md` architecture section: new modules (`agent/src/supervisor/`, `agent/src/workflow/`, `shared/src/commit-trailers.ts`), `pipeline.task_leases` table, `dark_factory.*` settings shape
- [ ] T057 [P] Author `runbooks/dark-factory-rollback.md`: how to flip `enabled = false` on a repo, how to reconcile in-flight tasks (drain leases, allow current PRs to merge or close, audit trail review)
- [ ] T058 [P] Delete legacy local-runner code paths superseded by T011a: remove the in-process Claude Code spawn helper, the per-runner state machine, and any duplicate trailer-emission code. After this task, `mcp-server/src/local-runner.ts` is strictly a wrapper around the supervisor + graph executor with no behavior of its own
- [ ] T059 Pilot rollout: enable `dark_factory.enabled = true` on three repos at trust tiers `docs`, `tests`, `implementation`; track for 14 days each
- [ ] T060 After 14-day pilot: produce a measured-results memo against SC1–SC8. For SC1, SC4, SC6: compare the 30-day post-pilot per-repo counters against the baseline captured in T011b's `pipeline.dark_factory_baseline` table; report deltas. For SC2 (pod-death survival), SC3 (stale-PR window), SC5 (PR-to-task resolvability), SC7 (gating-violation count), SC8 (3 trust tiers / 14 days): source from audit_log + git history. Declare GA only if all thresholds pass

---

## Dependencies

```
Phase 1 (Setup)
   ↓
Phase 2 (Foundational) ── [BLOCKS ALL USER STORIES]
   ↓
Phase 3 (US1 — auto-merge MVP) ──┐
Phase 4 (US2 — pod death) ───────┤  Can begin in parallel after Phase 2
                                  ┘
Phase 5 (US3 — code review) — depends on Phase 3 (workflow YAML loader, review node)
Phase 6 (US4 — approval gate) — depends on Phase 3 (Issue creation gate)
Phase 7 (US5 — escalation) — depends on Phase 4 (graph executor failure paths)
Phase 8 (US6 — opt-out)    — runs across Phases 3–7 (audit + verification)
Phase 9 (US7 — UI cross-ref) — depends on Phase 3 (PR body trailer)

Phase 10 (Polish) — runs after all P1+P2 stories pass; ADR/constitution/pilot last
```

## Parallel execution opportunities

Tasks marked **[P]** are parallelizable within their phase. Notable opportunities:

- Phase 2: T006 (commit-trailers), T007 (re-export), T009 (lease-reaper) can run alongside T008 (lease module)
- Phase 3 (US1): T012 (loader), T013 (gap-fill YAML), T016 (settings schema), T020 (path matcher), T022 (notify gate) can all run alongside the sequential T014→T015→T021 line
- Phase 4 (US2): T028 (chaos test) can be authored in parallel with T025–T027
- Phase 5 (US3): T030 + T031 (workflow YAMLs) parallel
- Phase 7 (US5): T039 (escalation lib) parallel with workflow wiring
- Phase 9 (US7): T047, T048, T049 parallel; T050–T052 sequential due to web-ui shared layout
- Phase 10: T056, T057, T058 parallel after T054/T055 land

## Implementation strategy

**Increment 1 (MVP — ≈ 4 working days):** Phase 1 + Phase 2 + Phase 3 (US1) + Phase 4 (US2) + Phase 8 (US6).
- After Increment 1: a doc PR can auto-merge end-to-end on one pilot repo; pod death is survivable; non-pilot repos are unchanged.

**Increment 2 (≈ 2 working days):** Phase 5 (US3) + Phase 6 (US4) + Phase 7 (US5).
- After Increment 2: code review behavior preserved, approval gates preserved, escalations have full context.

**Increment 3 (≈ 1.5 working days):** Phase 9 (US7) + Phase 10 polish.
- After Increment 3: web-ui tells the full story, ADR is in, pilot rollout begins.

**14-day soak (no code, just measurement):** Phase 10 T059–T060.

## Format validation

All 62 tasks follow the required checklist format:
- [x] Checkbox `- [ ]` prefix
- [x] Sequential ID `T001`–`T060`
- [x] `[P]` marker only on parallelizable tasks
- [x] `[US1]`–`[US7]` story labels only on user-story phases (3–9), absent on Phases 1, 2, 10
- [x] File path or concrete artifact named in every task
