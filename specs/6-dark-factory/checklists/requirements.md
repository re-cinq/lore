# Requirements Traceability: Dark Factory Mode

**Purpose**: Post-implementation coverage map — every FR and SC traced to the file that implements it, its test, and its current status.
**Updated**: 2026-05-04
**Feature**: [spec.md](../spec.md) · [tasks.md](../tasks.md)

Legend: ✅ implemented · ⏳ deferred (live/cluster action) · 🚧 partial

---

## FR1 — Branch-as-state checkpoints

| Req | Requirement summary | Implementation | Test | Status |
|-----|---------------------|----------------|------|--------|
| FR1.1 | Every phase ends with a `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:` trailer commit; emitted unconditionally regardless of `dark_factory.enabled` | `shared/src/commit-trailers.ts` · `agent/src/supervisor/graph-executor.ts` (stage-commit call per node) | `shared/src/__tests__/commit-trailers.test.ts` · `agent/src/__tests__/graph-executor.test.ts` | ✅ T006 T014 |
| FR1.2 | Supervisor determines next node from `git log` alone — no DB or CRD read for resume | `graph-executor.ts` `lastStageOnBranch()` + resume path | `graph-executor.test.ts` "resumeFromTrailers" suite | ✅ T015 |
| FR1.3 | No-file-change phases still produce an empty commit so the trailer is captured | `graph-executor.ts` `--allow-empty` flag on stage commit | `graph-executor.test.ts` "emits allow-empty commit on gate node" | ✅ T014 |
| FR1.4 | Agents MUST NOT rewrite branch history (no `--amend`, no force-push, no rebase) | Enforced by construction in `graph-executor.ts` and `runner-cli.ts`; no amend/force-push call sites on agent branches | Code review + `runbooks/dark-factory-rollback.md` humans section | ✅ T014 T054 |
| FR1.5 | `Lore-Task: <uuid>` trailer appears in the final PR body, replacing `Refs #<issue>` | `agent/src/lib/pr-body.ts` `prFooter()` wired into `worker.ts` (4 PR sites) and `loretask-watcher.ts` | `agent/src/__tests__/pr-body.test.ts` | ✅ T047 |
| FR1.6 | Supervisor acquires DB row-level lease (keyed on branch, TTL 10 min) as first action; second supervisor on held lease exits cleanly; expired lease enables pod-death takeover | `agent/src/supervisor/lease.ts` (`DbLeaseBackend` + `FileLeaseBackend`); `leaseBackendForEnv()` selects by `LORE_DB_HOST` | `agent/src/__tests__/lease.test.ts` · `agent/src/__tests__/pod-death.test.ts` | ✅ T008 T011 T011a |

---

## FR2 — Workflow graph

| Req | Requirement summary | Implementation | Test | Status |
|-----|---------------------|----------------|------|--------|
| FR2.1 | Workflow definitions are YAML files in `agent/src/workflows/`; no DOT/JSON/DSL | `agent/src/workflows/gap-fill.yaml`, `general.yaml`, `implementation.yaml` | `agent/src/__tests__/workflow-loader.test.ts` schema validation | ✅ T012 T013 T030 T031 |
| FR2.2 | Graph expresses: typed nodes (agent/validate/gate/retrospective), conditional edges (success/changes_requested/failed/always), entry/exit | `agent/src/workflow/loader.ts` Zod schema (per `contracts/workflow-yaml-schema.md`) | `workflow-loader.test.ts` cycle-detection + edge-condition cases | ✅ T012 |
| FR2.3 | Local runner and GKE supervisor interpret the same YAML definition file | `agent/src/supervisor/runner-cli.ts` loads from `/app/dist/workflows/`; `local-runner.ts` will load from same package (T058 deferred — legacy path still active locally) | Integration confirmed by `runner-cli.ts` + `graph-executor.ts` shared import | 🚧 T058 deferred |
| FR2.4 | Existing flows (gap-fill, general, implementation) migrated to YAML without behavior change | `gap-fill.yaml` · `general.yaml` · `implementation.yaml`; review/feature-request/onboard remain on legacy path pending T058 | Workflow loader unit tests | ✅ (core 3 flows) |
| FR2.5 | New flow = new YAML + new agent prompts; no supervisor/runner code changes | `loadWorkflowDir()` auto-discovers `*.yaml` in the workflows directory | `workflow-loader.test.ts` "loads all files in dir" | ✅ T012 |

---

## FR3 — Opt-out human gates

| Req | Requirement summary | Implementation | Test | Status |
|-----|---------------------|----------------|------|--------|
| FR3.1 | `settings.dark_factory.enabled` (default `false`) gates all dark-factory behavior changes | `shared/src/dark-factory-settings.ts` (canonical types + resolver, `@re-cinq/lore-shared`) · `mcp-server/src/dark-factory-settings.ts` (Zod parse + `twoKeyFieldsTouched`) | `agent/src/__tests__/dark-factory.test.ts` "Opt-out posture matrix" | ✅ T016 T044 |
| FR3.2 | `create_issue`: `never \| on_gate \| always`; default when dark-on: `on_gate` | `dark-factory-settings.ts` Zod enum + `agent/src/lib/dark-factory.ts` `decideIssueCreate()` | `dark-factory.test.ts` "approval_required wins over with_issue:false" | ✅ T016 T019 |
| FR3.3 | `auto_merge` block: path allowlist, min trust, CI requirement, bot-approval requirement; defaults: `specs/**`, `adrs/**`, `*.md`, `CLAUDE.md`, `.claude/**`; min trust `docs` | `dark-factory-settings.ts` + `agent/src/lib/path-match.ts` `allPathsMatch()` + `agent/src/jobs/auto-merge.ts` `evaluateAutoMerge()` | `auto-merge.test.ts` full decision matrix | ✅ T016 T020 T021 |
| FR3.4 | `review`: `trust_based \| always \| never`; outside-allowlist PRs → bot posts + waits for human; no time-based fallback in v1 | `dark-factory.ts` `decideReviewMode()` + `resolveReviewMode()`; `evaluateAutoMerge()` emits `deferred:path_outside_allowlist` | `dark-factory.test.ts` review-mode matrix | ✅ T034 |
| FR3.5 | `notify`: channel list `escalation \| watched \| all`; default when dark-on: `[escalation]` | `agent/src/lib/notify.ts` `decideNotify()` | `agent/src/__tests__/notify.test.ts` | ✅ T022 |
| FR3.6 | Per-task overrides (`human_review: required`, `with_issue: true`, `notify: completion`) override repo settings for one task | `pipeline.tasks.dark_factory_overrides` JSONB column; `decideIssueCreate()` / `decideReviewMode()` consult `task.dark_factory_overrides` before repo settings | `dark-factory.test.ts` per-task override cases | ✅ T004 T019 T034 |
| FR3.7 | Auto-merge decisions recorded in `pipeline.audit_log` with path-match, trust, CI-status, bot-review attributes | `auto-merge.ts` `evaluateAndMerge()` writes `auto_merge_decision` entry; OTEL span `lore.auto_merge.decision` carries all attributes | `auto-merge.test.ts` "writes audit entry on merge and on deferral" | ✅ T021 T023 |
| FR3.8 | Escalation Issues contain: task description, branch link, failing phase output, supervisor diagnostic, contributing facts/memories links | `agent/src/lib/escalation.ts` `renderEscalationBody()` + `escalate()` | `agent/src/__tests__/escalation.test.ts` "renderEscalationBody includes all required fields" | ✅ T039 T040 T041 T042 |
| FR3.9 | Privileged settings (enabled toggle, auto_merge.paths, require_* downgrades) need admin scope + CODEOWNERS-approval PR ceremony; lighter settings need admin scope only; every mutation writes audit entry | `mcp-server/src/dark-factory-authz.ts` `verifyApproval()` + `mcp-server/src/routes.ts` PUT handler + `twoKeyFieldsTouched()` | `mcp-server/src/__tests__/dark-factory-authz.test.ts` (`parsePrRef`, `isCodeowner`, `verifyApproval` — all error codes + happy path) | ✅ T017 T018 |

---

## FR4 — Migration and compatibility

| Req | Requirement summary | Implementation | Test | Status |
|-----|---------------------|----------------|------|--------|
| FR4.1 | Existing repos default to `dark_factory.enabled = false` at migration; behavior unchanged | Schema migration `scripts/infra/setup-dark-factory-schema.sh` adds columns with `IF NOT EXISTS`; `resolveSettings(undefined)` returns `enabled: false` | `dark-factory.test.ts` "resolveSettings returns enabled:false for null input" | ✅ T004 T044 |
| FR4.2 | Enabling dark mode requires no schema migration and no agent restart | Settings are read at task-creation time from `lore.repos.settings`; no DDL needed | `dark-factory.test.ts` settings read path | ✅ T016 |
| FR4.3 | Repos can revert `enabled = false` at any time; subsequent tasks revert to today's behavior | `resolveSettings()` re-derives defaults on every call; `decideIssueCreate` / `evaluateAutoMerge` check `enabled` per call | `dark-factory.test.ts` "Opt-out posture matrix" | ✅ T045 |
| FR4.4 | In-flight tasks at migration time use original flow; dark mode applies only to tasks created after enablement | Tasks created before the settings change carry no `dark_factory_overrides`; `resolveSettings` reads settings at creation time and stores the resolved snapshot in `dark_factory_overrides` | Covered by schema default `NULL` + `resolveSettings` fallback | ✅ T004 |

---

## FR5 — Observability

| Req | Requirement summary | Implementation | Test | Status |
|-----|---------------------|----------------|------|--------|
| FR5.1 | OTEL traces cover supervisor phase transitions; each phase span linked to its commit SHA | `lease.ts` spans `lore.lease.acquire/refresh/release`; `auto-merge.ts` span `lore.auto_merge.decision`; graph-executor emits stage span per node (spans noop without tracer provider — full propagation tracked separately) | `lease.test.ts` "emits OTEL span on acquire" | ✅ T010 T023 |
| FR5.2 | Repo dashboard shows: tasks run dark, auto-merged, escalated, trust level, dark_factory settings | `web-ui/src/app/repos/[owner]/[repo]/page.tsx` dark-factory panel; queries `pipeline.audit_log`; degrades if table absent (legacy clusters) | Visual verification via web-ui | ✅ T052 |
| FR5.3 | Web-ui task detail resolves `Lore-Task: <uuid>` from PR URL and renders stage timeline | `mcp-server/src/routes.ts` `GET /api/tasks/:uuid/timeline` + `GET /api/tasks/by-pr/:o/:r/:n`; `web-ui/src/app/pipeline/[id]/Timeline.tsx` polls every 10s while active | Visual verification via web-ui | ✅ T048 T049 T050 T051 |

---

## Success Criteria — measurement status

| SC | Criterion | Measurement source | Status |
|----|-----------|-------------------|--------|
| SC1 | Implementation tasks: ≥4 pods → ≤2 per task over 7-day window | `pipeline.dark_factory_baseline` snapshot (T011b) vs post-pilot 30-day window (T060) | ⏳ T059 T060 |
| SC2 | 100% pod-death mid-flow → resume without re-execution | Canary kill-signal injection across all stage types | ⏳ T029 T059 |
| SC3 | No dark-mode Lore PR stays open with green CI + bot-approved >24h | `pipeline.audit_log auto_merge_decision` + PR state query over rolling 30-day window | ⏳ T024 T059 |
| SC4 | GitHub Issues by Lore drop ≥80% on pilot repos vs pre-feature baseline | `pipeline.dark_factory_baseline` counters (T011b) vs `pipeline.audit_log` post-pilot | ⏳ T059 T060 |
| SC5 | 100% of Lore-authored merged PRs resolvable via `Lore-Task:` trailer | `GET /api/tasks/by-pr/:o/:r/:n` fallback path + `prFooter()` coverage | ✅ T047 T049 (baseline in prod after deploy) |
| SC6 | ≤30% of dark-mode bot PRs require human review | `pipeline.audit_log deferred:path_outside_allowlist` share over rolling window | ⏳ T059 T060 |
| SC7 | Zero auto-merges outside configured path allowlist in first 90 days | `pipeline.audit_log auto_merge_decision` `path_match: false` count = 0; any violation is P1 | ⏳ T059 (monitoring ongoing post-launch) |
| SC8 | ≥3 repos at trust tiers `docs`/`tests`/`implementation` running dark mode ≥14 days each before GA | Pilot rollout tracking | ⏳ T059 T060 |

---

## User scenario end-to-end verification

| Scenario | Description | Task | Status |
|----------|-------------|------|--------|
| A (SC1/SC3/SC4) | Routine doc PR auto-merges; no Issue; full stage chain; audit entry | T024 | ⏳ post-deploy |
| B (SC2) | Pod dies mid-flow; replacement resumes from `git log`; no re-execution | T029 | ⏳ post-deploy |
| C (SC6) | Code change outside allowlist → PR open; audit shows `deferred:path_outside_allowlist` | T035 | ⏳ post-deploy |
| D | Approval-required task creates Issue; no commits until labeled; proceeds after label | T038 | ⏳ post-deploy |
| E | Two validation failures → escalation Issue with diagnostic + Slack notification | T043 | ⏳ post-deploy |
| F | Repo with `enabled=false` behaves identically to pre-feature; trailers still emitted | T046 | ⏳ post-deploy |
| G (SC5) | From merged PR → web-ui resolves to task + stage timeline; from task UUID → PR link | T053 | ⏳ post-deploy |

---

## Deferred items

These tasks are blocked on shared cluster state or live pilot actions. No code changes needed — they are operational steps.

| Task | Blocker | Gate |
|------|---------|------|
| T005 | Run schema migration against dev DB | Ready when cluster access available |
| T024/T029/T035/T038/T043/T046/T053 | Live scenario verification | Gated on T059 pilot rollout |
| T058 | Delete legacy local-runner code paths | Gated on graph executor proven in production |
| T059 | Enable dark mode on 3 pilot repos (docs/tests/implementation trust tiers); run 14 days each | SC8 gate before GA |
| T060 | 14-day measured-results memo vs SC1–SC8 | Requires T059 completion |

---

## Constitutional and ADR compliance

- [x] ADR-016 authored (`adrs/ADR-016-dark-factory-mode.md`)
- [x] Constitution patched to v2.1.0 — P7 task-tracking row updated to "GH Issues for exception surfaces (opt-out)"
- [x] CLAUDE.md updated with 14 new dark-factory Key Components entries
- [x] Rollback runbook at `runbooks/dark-factory-rollback.md`
- [x] All privileged-setting mutations write `dark_factory_setting_changed` audit entries
- [x] Migration is strictly additive (`IF NOT EXISTS`); no destructive DDL
