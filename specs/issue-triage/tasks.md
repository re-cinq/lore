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

**MVP**: completing Setup + Foundational + the US1 phase delivers a working reproduction sandbox.

## Phase 1: Setup

- [ ] T001 Add `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` stub with empty nodes and edges.

## Phase 2: Foundational *(blocks all stories)*

- [ ] T002 Update webhook label mapping in `apps/floor/src/events/handlers/github.ts` to route `lore:triage` and `triage: needs-triage` to the `issue-triage` task type.

## Phase 3: User Story 1 — Automated Bug Reproduction in Sandbox (P1, MVP)

**Independent test**: Triggering the triage line on an issue with a valid reproduction repository results in the bot successfully running the reproduction and applying the `triage: reproduced` label.

- [ ] T003 [US1] Define the `reproduce` node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` configured for a Dedicated Agent Pod sandbox.

## Phase 4: User Story 2 — Root Cause Diagnosis and Spec Verification (P1)

**Independent test**: A reproduced issue is diagnosed by the bot, which traces the failure to a specific code path and checks it against specs, resulting in a `triage: diagnosed` label.

- [ ] T004 [US2] Implement the `diagnose` node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` to instrument the code.
- [ ] T005 [US2] Implement the `verify` node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` to cross-reference specs. (depends on T004)

## Phase 5: User Story 5 — Human-Gated Handoff to Implementation (P1)

**Independent test**: A diagnosed issue stops processing and waits for a human to apply the `lore:implementation` label.

- [ ] T006 [US5] Add the `human-gate` node to `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` to halt execution until manual approval.
- [ ] T007 [US5] Make `lore:implementation` on an issue whose triage line is parked at `human-gate` report success to that node and end the triage task before `alreadyWorkingOnIssue` runs, in `apps/floor/src/events/handlers/github.ts`, so the handoff dispatches instead of answering "Already being worked on". (depends on T006)

## Phase 6: User Story 3 & 4 — Obsolete Issues and Decomposition (P2)

**Independent test**: Issues are either closed automatically if obsolete, or split if too large.

- [ ] T008 [P] [US3] Add the `close-obsolete` service station logic in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`.
- [ ] T009 [P] [US4] Add the `decompose` agent station logic in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`.

## Phase 7: Polish

- [ ] T010 Update `README.md` to document the new `triage:*` label taxonomy and issue triage flow.
