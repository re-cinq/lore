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

- [ ] T001 Add `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` stub with declared nodes and edges but no `prompt_ref` values yet; add `"issue-triage"` to the pinned bundled-lines list in `libs/assembly-lines/src/loader.test.ts`. — test: `libs/assembly-lines/src/loader.test.ts` asserts the stub loads without error and appears in the bundled list

## Phase 2: Foundational *(blocks all stories)*

- [ ] T002 Extend `libs/assembly-lines/src/assembly-line-schema.ts` (`NodeSchema`) with an optional `outcomes: string[]` field; extend `EdgeCondition` routing in `libs/assembly-lines/src/transition.ts` (`selectEdge`) and `libs/assembly-lines/src/node-outcome.ts` (`stationNodeOutcome`, `parseNodeResult`) to accept declared custom outcome strings as valid `EdgeConditionValue` targets (FR11). — test: `libs/assembly-lines/src/loader.test.ts` asserts a node declaring `outcomes: [unable-to-reproduce]` validates and an undeclared outcome is rejected; `libs/assembly-lines/src/node-result-schema.test.ts` asserts parse round-trip for each triage custom outcome

- [ ] T003 Add agent recipe files `libs/shared/src/agent-defaults/triage-reproduce.md`, `libs/shared/src/agent-defaults/triage-diagnose.md`, and `libs/shared/src/agent-defaults/triage-verify.md` — each with frontmatter (`model`, `timeout_minutes`) and a body stating what the agent writes and which `LORE_NODE_RESULT` value it emits for each custom outcome (FR12). (depends on T002) — test: `libs/assembly-lines/src/prompt-refs.test.ts` asserts all three recipe files exist and that each triage node's `prompt_ref` resolves

- [ ] T004 Add `"issue-triage"` to `TaskTypeSchema` in `libs/shared/src/domain/pipeline-task-core.ts`; add an `"issue-triage"` tier entry to `TRUST_LEVELS` in `libs/shared/src/domain/pipeline-task-trust.ts`; map `"issue-triage"` to the line name in `assemblyLineFor` in `apps/floor/src/work/task/dispatch-agent-cr.ts` (FR13). — test: `libs/shared/src/domain/pipeline-tasks.trust.test.ts` asserts `issue-triage` is permitted at the correct trust tier; `libs/assembly-lines/src/loader.test.ts` bundled-lines assertion (T001) confirms the mapping resolves

- [ ] T005 Add `triage_label` node type to `NodeType` and `PRODUCIBLE_OUTCOMES` in `libs/assembly-lines/src/assembly-line-schema.ts`; implement the `triage_label` service station in `apps/stations/src/work/triage-label/` to apply the `triage:*` label matching the node outcome via `project.issues.addLabel` (FR14). (depends on T002) — test: `apps/stations/src/work/triage-label/triage-label.test.ts` asserts each outcome maps to the correct label and the label is applied

- [ ] T006 Add `close_issue` node type to `NodeType` and `PRODUCIBLE_OUTCOMES` in `libs/assembly-lines/src/assembly-line-schema.ts`; implement the `close_issue` service station in `apps/stations/src/work/close-issue/` to post a verdict comment and call `project.issues.close` (FR15). (depends on T002) — test: `apps/stations/src/work/close-issue/close-issue.test.ts` asserts the station posts the verdict comment before closing the issue

- [ ] T007 Add `issue_label` to `HUMAN_STATION_TYPES` in `libs/assembly-lines/src/human-station.ts` and register a manifest in `apps/stations/`; replace the single-label guard in `apps/floor/src/events/handlers/github.ts` with a label → task-type map in `libs/shared/src/domain/task-types/dispatch-labels.ts` so `lore:triage` and `triage: needs-triage` create an `issue-triage` task; add the human-gate resume logic in `issuesLabeled` so a `lore:implementation` label on an issue parked at `human-gate` calls `reportToParkedNode` via `RUN_RESUME_EVENT` before `alreadyWorkingOnIssue` runs (FR16). (depends on T002, T004) — test: `apps/floor/src/events/handlers/github.test.ts` asserts `lore:implementation` on a parked triage run resumes before `alreadyWorkingOnIssue` fires; and `libs/shared/src/domain/task-types/dispatch-labels.test.ts` asserts `lore:triage` → `issue-triage` and `triage: needs-triage` → `issue-triage`

## Phase 3: User Story 1 — Automated Bug Reproduction in Sandbox (P1, MVP)

**Independent test**: Triggering the triage line on an issue with a valid reproduction repository results in the bot successfully running the reproduction and applying the `triage: reproduced` label.

- [ ] T008 [US1] Define the `reproduce` agent node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with `prompt_ref: triage-reproduce`, `timeout_minutes: 15`, and `outcomes: [unable-to-reproduce, needs-reproduction, skipped]`; wire all outgoing edges including failure. (depends on T001, T002, T003, T004, T005) — test: `libs/assembly-lines/src/loader.test.ts` asserts the YAML loads without schema errors and `reproduce` declares the expected custom outcomes

## Phase 4: User Story 2 — Root Cause Diagnosis and Spec Verification (P1)

**Independent test**: A reproduced issue is diagnosed by the bot, which traces the failure to a specific code path and checks it against specs, resulting in a `triage: diagnosed` label.

- [ ] T009 [US2] Define the `diagnose` agent node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with `prompt_ref: triage-diagnose` and `timeout_minutes: 10`; wire its success and failure edges. (depends on T003, T008) — test: `libs/assembly-lines/src/loader.test.ts` asserts all `diagnose` edges are covered

- [ ] T010 [US2] Define the `verify` agent node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with `prompt_ref: triage-verify`, `timeout_minutes: 10`, and `outcomes: [obsolete, large-issue, not-actionable]`; wire edges to `human-gate`, `close-obsolete`, `decompose`, and `done`. (depends on T003, T009) — test: `libs/assembly-lines/src/loader.test.ts` asserts all `verify` custom outcomes have a matching outgoing edge

## Phase 5: User Story 5 — Human-Gated Handoff to Implementation (P1)

**Independent test**: A diagnosed issue stops processing and waits for a human to apply the `lore:implementation` label.

- [ ] T011 [US5] Add the `human-gate` node of type `issue_label` to `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with `route: {args.issue_url}` and wire its success edge to `done`. (depends on T007, T010) — test: `libs/assembly-lines/src/loader.test.ts` asserts `human-gate` node type is `issue_label` and its success edge leads to `done`

## Phase 6: User Story 3 & 4 — Obsolete Issues and Decomposition (P2)

**Independent test**: Issues are either closed automatically if obsolete, or split if too large.

- [ ] T012 [US3] Add the `close-obsolete` node of type `close_issue` to `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with an `always` edge to `done`. (depends on T006, T010) — test: `libs/assembly-lines/src/loader.test.ts` asserts `close-obsolete` uses `close_issue` type and its only outgoing edge is `always`

- [ ] T013 [US4] Add the `decompose` agent node to `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with an `always` edge to `done`; reuse the `feature-decompose` output contract in the agent's prompt. (depends on T003, T008) — test: `libs/assembly-lines/src/loader.test.ts` asserts `decompose` has an `always` edge and all edges are covered

## Phase 7: Polish

- [ ] T014 Update `specs/github-issue-dispatch/spec.md` to promote `lore:triage` and `triage: needs-triage` from a planned note to real dispatch-table entries in the 'What Changes' section, naming `apps/floor/src/events/handlers/github.ts` and `libs/shared/src/domain/task-types/dispatch-labels.ts` as the implementation sites. (depends on T007) — test: verified by the dispatch-labels test added in T007 (`dispatch-labels.test.ts` asserts `lore:triage` → `issue-triage`)
