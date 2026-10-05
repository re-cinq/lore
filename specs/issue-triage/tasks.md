# Tasks: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Spec    | [spec.md](./spec.md)                   |
| Plan    | [plan.md](./plan.md)                   |
| Created | 2026-09-28                             |

This checklist delivers the Issue Triage Assembly Line to automate bug reproduction, diagnosis, and verification.

## Story map

| Story | Spec scenario                                    | Priority |
| ----- | ------------------------------------------------ | -------- |
| US1   | Automated Bug Reproduction in Sandbox            | P1       |
| US2   | Root Cause Diagnosis and Spec Verification       | P1       |
| US3   | Obsolete Issue Detection and Automatic Closing   | P2       |
| US4   | Large Issue Detection and Decomposition          | P2       |
| US5   | Human-Gated Handoff to Implementation            | P1       |

**MVP**: completing Setup + Foundational phases + US1 delivers a working reproduction sandbox.

## Phase 1: Setup

- [ ] T001 Add `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` stub holding only its terminal `done` exit node — no agent node yet, because an agent definition without a recipe in `libs/shared/src/agent-defaults/` causes `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` to fail on the "give every agent definition a non-empty prompt" assertion; the triage nodes arrive in T008–T013; add `"issue-triage"` to the pinned pipeline list in `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`. — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts the stub loads without error and `"issue-triage"` appears in the declared-lines list

## Phase 2: Foundational *(blocks all stories)*

- [ ] T002 [P] Add agent recipe files `libs/shared/src/agent-defaults/triage-reproduce.md`, `libs/shared/src/agent-defaults/triage-diagnose.md`, and `libs/shared/src/agent-defaults/triage-verify.md` — each with frontmatter (`model`, `timeout_minutes`) and a body stating what the agent writes and which `LORE_NODE_RESULT` value it emits for each custom outcome (FR12). — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` "give every agent definition a non-empty prompt" assertion passes once the YAML agent nodes are wired in T008–T010

- [ ] T003 [P] Add `"issue-triage"` to `TaskTypeSchema` in `libs/shared/src/domain/models/pipeline-task.ts`; add an `"issue-triage"` tier entry to `TRUST_LEVELS` in `libs/shared/src/domain/pipeline-task-trust.ts` (tier: `implementation`) (FR13). — test: `libs/shared/src/domain/pipeline-tasks.trust.test.ts` asserts `issue-triage` is permitted at the correct trust tier

- [ ] T004 [P] Implement the `triage_label` service station in `apps/stations/src/work/triage-label/` (one `index.ts` + `manifest.ts` following the `@re-cinq/floor-station` pattern) to apply the `triage:*` label matching the node outcome via `project.issues.addLabel`; register it in `apps/stations/src/index.ts` (FR14). — test: `apps/stations/src/work/triage-label/triage-label.test.ts` asserts each outcome maps to the correct label and the label is applied

- [ ] T005 [P] Implement the `close_issue` service station in `apps/stations/src/work/close-issue/` (one `index.ts` + `manifest.ts`) to post a verdict comment then call `project.issues.close`; register it in `apps/stations/src/index.ts` (FR15). — test: `apps/stations/src/work/close-issue/close-issue.test.ts` asserts the station posts the verdict comment before closing the issue

- [ ] T006 Extend the `github.issues.labeled` handler in `apps/stations/src/events/repo-handlers.ts`: (a) when the label is `lore:triage` or `triage: needs-triage`, call `floor.lines.start('issue-triage', {repo, issue_url, issue_number})` via `libs/shared/src/outbound/floor/floor-client.ts`; (b) before the `alreadyWorkingOnIssue` guard, when the label is `lore:implementation` on an issue whose `issue-triage` run is parked at `human-gate`, call `reportToVisit` via `libs/shared/src/outbound/floor/floor-report.ts` to advance the parked visit and dispatch the implementation task (FR7, FR16). (depends on T003) — test: `apps/stations/src/events/repo-handlers.test.ts` asserts `lore:triage` starts an issue-triage floor run; asserts `lore:implementation` on a parked triage run resumes before `alreadyWorkingOnIssue` fires

- [ ] T007 Add a `cron.issue_triage.tick` cron emitter in `libs/shared/src/work/scheduler/cron-emitters.ts`; implement the `issue-triage-tick` sweep in `apps/stations/src/work/issue-triage-tick/` (`manifest.ts` + `run.ts`) that on each tick queries the oldest `triage: needs-triage`-labelled issues up to a per-repo concurrency cap (oldest `created_at` first, no shared context) and calls `floor.lines.start` for each, following the pattern of `apps/stations/src/work/loop-tick/` (FR9). (depends on T003, T006) — test: `apps/stations/src/work/issue-triage-tick/issue-triage-tick.test.ts` asserts the sweep starts a floor run per qualifying issue, oldest first, respecting the concurrency cap

## Phase 3: User Story 1 — Automated Bug Reproduction in Sandbox (P1, MVP)

**Independent test**: Triggering the triage line on an issue with a valid reproduction repository results in the bot successfully running the reproduction and applying the `triage: reproduced` label.

- [ ] T008 [US1] Define the `reproduce` agent node in `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with agent definition `triage-reproduce`, `timeout_minutes: 15`, and custom outcomes `[unable-to-reproduce, needs-reproduction, skipped]` declared in the `stations` block; wire all outgoing edges to `triage-label` (which transitions to `diagnose` on success or to `done` on all other outcomes) including the failure edge with `iteration_max: 3`. (depends on T001, T002, T003, T004, T006) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts the YAML loads without schema errors and `reproduce` declares the expected custom outcomes

## Phase 4: User Story 2 — Root Cause Diagnosis and Spec Verification (P1)

**Independent test**: A reproduced issue is diagnosed by the bot, which traces the failure to a specific code path and checks it against specs, resulting in a `triage: diagnosed` label.

- [ ] T009 [US2] Define the `diagnose` agent node in `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with agent definition `triage-diagnose` and `timeout_minutes: 10`; wire its success edge to `triage-label` then `verify`, and its failure edge (with `iteration_max: 3`) to `triage-label` then `done`. (depends on T002, T008) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts all `diagnose` edges are covered

- [ ] T010 [US2] Define the `verify` agent node in `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with agent definition `triage-verify`, `timeout_minutes: 10`, and custom outcomes `[obsolete, large-issue, not-actionable]` declared in the `stations` block; wire edges to `human-gate` (success), `close-obsolete` (obsolete), `decompose` (large-issue), and `triage-label → done` (not-actionable, failed). (depends on T002, T009) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts all `verify` custom outcomes have a matching outgoing edge

## Phase 5: User Story 5 — Human-Gated Handoff to Implementation (P1)

**Independent test**: A diagnosed issue stops processing and waits for a human to apply the `lore:implementation` label.

- [ ] T011 [US5] Add the `human-gate` node of `kind: human` to `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with `route: '{args.issue_url}'` declared in the `stations` block; wire its success edge to `done`. (depends on T006, T010) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts `human-gate` is `kind: human` and its success edge leads to the exit node

## Phase 6: User Story 3 & 4 — Obsolete Issues and Decomposition (P2)

**Independent test**: Issues are either closed automatically if obsolete, or split if too large.

- [ ] T012 [US3] Add the `close-obsolete` node using the `close-issue` service station to `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with an `always` edge to `done`. (depends on T005, T010, T011) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts `close-obsolete` uses the `close-issue` station and its only outgoing edge is `always`

- [ ] T013 [US4] Add the `decompose` agent node to `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` using the `feature-decompose` agent definition with an `always` edge to `done`; the recipe's output contract (child issue creation) is reused without changes. (depends on T002, T010, T012) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts `decompose` has an `always` edge and all edges of the complete graph are covered

## Phase 7: Polish

- [ ] T014 Update `specs/github-issue-dispatch/spec.md` to promote `lore:triage` and `triage: needs-triage` from a planned note to real dispatch-table entries in the 'What Changes' section, naming `apps/stations/src/events/repo-handlers.ts` as the implementation site. (depends on T006) — test: verified by the handler test added in T006 (`repo-handlers.test.ts` asserts `lore:triage` → issue-triage floor run)
