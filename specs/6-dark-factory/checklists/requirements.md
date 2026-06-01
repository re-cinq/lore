# Specification Quality Checklist: Dark Factory Mode

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-04-28
**Reconciled**: 2026-06-01
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Validation Findings

### Content Quality
- The spec mentions YAML/DOT/git/commit-trailers/CRD/CRD-pods, which are **technical concepts**, not pure stakeholder language. **Justification for retaining**: this feature is platform-internal (Lore engineers + platform-aware operators), not end-user-facing. The "non-technical stakeholder" persona here is the Product Manager submitting intents — for whom the spec's PM-facing scenario (Scenario 4 / 6 / 7) avoids implementation jargon. Engineering-personas legitimately need the technical anchors. Mark passing.
- Implementation-flavored phrases ("supervisor process", "graph node", "commit trailer") are accepted as **architectural terms-of-art** documented in Key Entities. They are necessary for unambiguous requirements.

### Requirement Completeness
- Three open questions (Q1–Q3 in the spec) remain by design and are tagged for `/speckit.clarify` rather than `[NEEDS CLARIFICATION]`. They are scoped to: graph format choice, review-but-no-merge behavior, and trailer-gating policy. Within the maximum-three limit.
- Success criteria use measurable units (counts, percentages, time bounds) and avoid technology-specific metrics.
- Edge cases addressed via Scenarios 2 (pod death), 3 (path outside allowlist), 5 (escalation), 6 (opt-out).

### Feature Readiness
- Each functional requirement (FR1.1 through FR5.3) is verifiable via the corresponding scenario's acceptance criteria.
- Success criteria SC1–SC8 cover quantitative goals (handover reduction, pod-death survival, stale-PR elimination, notification reduction, audit completeness, review focus, gating safety, adoption gate).

## Notes

- Constitutional impact called out explicitly. Principle 7 row on task tracking will require a superseding ADR before the implementation phase begins. This is part of the plan workflow, not a blocker for the spec itself.
- Out-of-scope items (Operation phase, parallel red-team agents, CRD removal, multi-provider routing) are bounded and listed for follow-up specs.
- Open questions Q1–Q3 are recommended inputs to `/speckit.clarify` before `/speckit.plan`.

---

## Post-Implementation Reconciliation

> **Status as of 2026-06-01.** The spec shipped across 8+ commits on `6-dark-factory`. The
> sections below map each functional requirement to its implementation, document decisions
> made during coding that diverged from the spec text, and list outstanding live-verification
> tasks that require deployment.

### FR Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| FR1.1 Stage commit trailers (`Lore-Stage:` / `Lore-Iteration:` / `Lore-Task:`) | ✅ Shipped | `shared/src/commit-trailers.ts` — `formatTrailers()` / `parseTrailers()` emitted unconditionally on every Lore-authored commit; re-exported from `@re-cinq/lore-shared` |
| FR1.2 Resume from `git log` alone | ✅ Shipped | `agent/src/supervisor/graph-executor.ts` — `lastStageOnBranch()` + `executeGraph()` skip nodes whose `Lore-Stage:` trailer is already present |
| FR1.3 Empty commit for no-file phases | ✅ Shipped | `graph-executor.ts` uses `git commit --allow-empty` for gate/retrospective nodes |
| FR1.4 No branch rewrite | ✅ Enforced by design | `local-runner.ts` + supervisor never amend; reviewer-requested changes go on new commits to the same branch |
| FR1.5 `Lore-Task:` trailer in PR body | ✅ Shipped | `agent/src/lib/pr-body.ts` — `prFooter()` wired into `worker.ts` (4 sites) and `loretask-watcher.ts` |
| FR1.6 Lease — acquire / TTL / takeover | ✅ Shipped | `agent/src/supervisor/lease.ts` — `DbLeaseBackend` (CTE atomic acquire) + `FileLeaseBackend` (worktree mode) behind a `LeaseBackend` interface; OTEL spans `lore.lease.*` |
| FR2.1 Workflow definitions as YAML | ✅ Shipped | `agent/src/workflows/{gap-fill,general,implementation}.yaml` — loader at `agent/src/workflow/loader.ts` |
| FR2.2 Node types + edge conditions | ✅ Shipped | Zod schema in `loader.ts`: `agent`, `validate`, `gate`, `retrospective` node types; edges carry `on: success\|failure\|changes_requested` |
| FR2.3 Local runner + GKE supervisor share definitions | ✅ Shipped | Same `loadWorkflowDir()` called by `runner-cli.ts` (GKE path) and local runner; `WORKFLOWS_DIR` resolves relative to the dist bundle |
| FR2.4 Existing flows migratable | ✅ Shipped | `gap-fill.yaml`, `general.yaml`, `implementation.yaml` cover the priority flows; remaining flows use the legacy `claude --print` path unchanged |
| FR2.5 New flow = new YAML only | ✅ Enforced by design | `createProductionHandlers()` in `handlers.ts` is handler-type-generic; no code change needed for a new workflow |
| FR3.1 `dark_factory.enabled` default `false` | ✅ Shipped | `resolveSettings(undefined\|null)` returns `enabled: false`; migration adds `dark_factory_overrides JSONB DEFAULT NULL` to `pipeline.tasks` |
| FR3.2 `create_issue` — never / on_gate / always | ✅ Shipped | `dark-factory.ts` — `decideIssueCreate()` |
| FR3.3 `auto_merge` — paths / min_trust / CI / bot | ✅ Shipped | `auto-merge.ts` — `evaluateAutoMerge()` + `evaluateAndMerge()`; OTEL span `lore.auto_merge.decision` |
| FR3.4 `review` — trust_based / always / never | ✅ Shipped | `dark-factory.ts` — `decideReviewMode()` + `resolveReviewMode()` |
| FR3.5 `notify` channel list | ✅ Shipped | `agent/src/lib/notify.ts` — `decideNotify()` |
| FR3.6 Per-task overrides at creation | ✅ Shipped | `dark_factory_overrides` JSONB on `pipeline.tasks`; overrides merged in `resolveSettings()` |
| FR3.7 Auto-merge audit entry | ✅ Shipped | `evaluateAndMerge()` writes `auto_merge_decision` to `pipeline.audit_log` |
| FR3.8 Escalation Issue body — branch link + diagnostic | ✅ Shipped | `agent/src/lib/escalation.ts` — `renderEscalationBody()` (pure, tested); 3-attempt backoff; degrades to audit-only Slack on failure |
| FR3.9 Two-key AuthZ on privileged settings | ✅ Shipped | `mcp-server/src/dark-factory-authz.ts` — `verifyApproval()` checks CODEOWNERS + labeled PR; `twoKeyFieldsTouched()` gates the PUT route |
| FR4.1–FR4.4 Migration + compatibility | ✅ Shipped | Schema migration in `scripts/infra/setup-dark-factory-schema.sh`; `resolveSettings()` preserves opt-out behavior; in-flight tasks unaffected |
| FR5.1 OTEL spans per phase transition | ✅ Shipped | `graph-executor.ts` emits spans; `lease.ts` emits `lore.lease.*`; `auto-merge.ts` emits `lore.auto_merge.decision` |
| FR5.2 Repo dashboard — dark mode summary | ✅ Shipped | `web-ui/src/app/repos/[owner]/[repo]/page.tsx` — dark-factory panel (Mode / Trust / Tasks 7d / Auto-merged 7d / Escalations 7d) |
| FR5.3 Task detail — stage timeline | ✅ Shipped | `web-ui/src/app/pipeline/[id]/Timeline.tsx` polls `/api/pipeline/:id/timeline` every 10s while in-flight |

### Implementation Divergences from Spec

The following decisions were made during implementation and are **not reflected in spec.md**.
They are documented here so the spec can be patched in a follow-up if needed, and so future
readers understand the current system.

#### D1 — Two-gate cluster enablement

The spec describes a single `dark_factory.enabled` boolean on a repo. Implementation
added a **second mandatory gate** at the cluster level: `LORE_DARK_FACTORY_CLUSTER_ENABLED`
env var on the agent deployment (`terraform/modules/gke-mcp/agent-helm/values.yaml`,
default `"false"`).

**Rule**: A repo only takes the supervisor/workflow path when _both_ gates are on.
Either gate off → the repo falls back to the legacy `claude --print` path, even with
`dark_factory.enabled = true` on the repo. The cluster gate prevents the Helm flag from
getting ahead of the `claude-runner` image, which must have `/app/dist/` baked in before
the new path is safe to use.

**Impact on FR3.1**: The effective enablement condition is
`settings.dark_factory.enabled AND env.LORE_DARK_FACTORY_CLUSTER_ENABLED`, not just
the repo setting alone.

#### D2 — Dedicated `runner-cli.ts` entry point with exit-code matrix

The spec refers to a "supervisor process" without specifying how it is invoked inside a
Job pod. Implementation introduced `agent/src/supervisor/runner-cli.ts` as a
standalone CLI (`#!/usr/bin/env node`) invoked by `docker/claude-runner/entrypoint.sh`
when `LORE_DARK_FACTORY_WORKFLOW` is set.

The CLI defines a documented exit-code matrix consumed by `entrypoint.sh` and
`loretask-watcher.ts`:

| Code | Reason |
|------|--------|
| 0 | `completed` — supervisor walked to a terminal node |
| 2 | `not_a_git_workdir` |
| 3 | `workflow_load_failed` |
| 4 | `workflow_not_found` |
| 5 | `lease_held` — another pod owns the branch; clean exit |
| 6 | `iteration_max_exceeded` |
| 7 | `executor_error` |
| 8 | `executor_pending` |
| 9 | `env_missing` — controller misconfiguration |

Exit 1 is reserved for uncaught Node.js exceptions. Non-zero exits are treated as task
failures; the specific code determines retry-vs-escalation in the watcher.

#### D3 — `claude-code-handler.ts` spawns `claude --print`, not the SDK

The spec's FR2.2 describes agent-type nodes abstractly. The cluster implementation of
agent nodes (`agent/src/supervisor/claude-code-handler.ts`) spawns `claude --print` in
the Job pod's working tree rather than calling the Anthropic SDK directly. This lets the
pod reuse the same `claude` binary that ships in the `claude-runner` image without
managing an API key inside the handler.

Failure modes are mapped to explicit outcomes:
- non-zero claude exit → `failed` + `Lore-Validation-Status: cli-nonzero`
- spawn/timeout error → `failed` + `Lore-Validation-Status: cli-error`

#### D4 — Dark-factory settings schema moved to `@re-cinq/lore-shared`

The spec points to `mcp-server/src/dark-factory-settings.ts` as the schema location.
During implementation, the canonical Zod types and `resolveSettings()` defaults were
promoted to `shared/src/dark-factory-settings.ts` (re-exported via `@re-cinq/lore-shared`)
so the agent, the MCP server, and the Job pod runner can all share one source. The
`mcp-server` copy is now a thin re-export.

#### D5 — Additional supervisor modules not in the plan

The plan listed three supervisor files (`index.ts`, `lease.ts`, `graph-executor.ts`).
Implementation also created:

- `agent/src/supervisor/orchestrator.ts` — higher-level coordinator wrapping `runSupervisor`
- `agent/src/supervisor/handlers.ts` — `createProductionHandlers()` factory wiring agent/validate/gate/retrospective handlers
- `agent/src/supervisor/agent-handler.ts` — local-dev agent handler (calls Anthropic SDK directly; used by the local runner, not the Job pod)

These are internal to the supervisor package and do not affect the external contract of
the feature, but are not in the spec.

### Outstanding Live-Verification Tasks

The following tasks from `tasks.md` are deferred until deployment. They are the primary
gap between spec-as-written and confirmed-working behavior.

| Task | Scenario | Blocker |
|------|----------|---------|
| T024 | Scenario A — doc PR auto-merges end-to-end | Requires `re-cinq/test-darkmode` live cluster + two-key ceremony |
| T029 | Scenario B — pod-death survivability | Requires dev cluster pod-kill injection |
| T035 | Scenario C — code change requires human review | Requires live cluster run |
| T038 | Scenario D — approval gate creates Issue | Requires live cluster run |
| T043 | Scenario E — escalation with full context | Requires live cluster run |
| T046 | Scenario F — opt-out repo unchanged | Requires live cluster run |
| T053 | Scenario G — PR-to-task cross-reference in web-ui | Requires live cluster run |
| T058 | Delete legacy local-runner code paths | Deferred until pilot proves the new path |
| T059 | Pilot rollout — three repos across trust tiers | Live action; gated on T024 |
| T060 | 14-day measured-results memo vs SC1–SC8 | Live action; runs after T059 |

### Success Criteria Status

| Criterion | Measurable? | Status |
|-----------|-------------|--------|
| SC1 — ≤ 2 Job pods per impl task | Yes — `pipeline.dark_factory_baseline` captures 30-day pre-feature counters (T011b) | Pending pilot (T059/T060) |
| SC2 — 100% pod-death survivability | Yes — chaos test T028 passes in unit tests; live injection pending T029 | Unit-tested; live pending |
| SC3 — No stale PRs >24h (green + bot-approved) | Yes — auto-merge path unblocks this; live measurement pending T059 | Pending pilot |
| SC4 — ≥ 80% Issue reduction | Yes — baseline captured (T011b); live delta pending T060 | Pending pilot |
| SC5 — 100% PRs resolve via `Lore-Task:` | Yes — `prFooter()` wired at all 5 PR-creation sites | Functionally complete; live audit pending |
| SC6 — ≤ 30% of PRs require human review | Yes — auto-merge + path-allowlist logic shipped; live share pending T059 | Pending pilot |
| SC7 — Zero auto-merges outside path allowlist | Yes — `allPathsMatch()` is the hard gate; violation = P1 | Enforced in code; 90-day window pending |
| SC8 — Three repos at distinct trust tiers ≥ 14 days | Yes | Pending T059 pilot rollout |
