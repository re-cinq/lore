# Tasks: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line |
| ------- | -------------------------- |
| Spec    | [spec.md](./spec.md)       |
| Plan    | [plan.md](./plan.md)       |
| Created | 2026-09-28                 |

Implementing the Issue Triage Assembly Line.

## Story map

| Story | Spec scenario                                      | Priority |
| ----- | -------------------------------------------------- | -------- |
| US1   | Automated Bug Reproduction in Sandbox              | P1       |
| US2   | Root Cause Diagnosis and Spec Verification         | P1       |
| US3   | Obsolete Issue Detection and Automatic Closing     | P2       |
| US4   | Large Issue Detection and Decomposition            | P2       |
| US5   | Human-Gated Handoff to Implementation              | P1       |

**MVP**: completing Setup + Foundational + the US1 phase delivers a working automated bug reproduction.

## Phase 1: Setup

- [ ] T001 Define `issue-triage` label taxonomy mapping in `apps/floor/src/events/handlers/github.ts`

## Phase 2: Foundational *(blocks all stories)*

- [ ] T002 [P] Create `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` skeleton
- [ ] T003 Implement batch processing logic for triage issues (depends on T002)

## Phase 3: User Story 1 — Automated Bug Reproduction in Sandbox (P1, MVP)

**Independent test**: Issue labelled `triage: needs-triage` spins up sandbox and transitions to `reproduced`.

- [ ] T004 [P] [US1] Implement `reproduce` node definition in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with Dedicated Agent Pod

## Phase 4: User Story 2 — Root Cause Diagnosis and Spec Verification (P1)

**Independent test**: Reproduced issue triggers diagnosis and outputs analysis.

- [ ] T005 [P] [US2] Implement `diagnose` node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`
- [ ] T006 [US2] Implement `verify` node in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` (depends on T005)

## Phase 5: User Story 5 — Human-Gated Handoff to Implementation (P1)

**Independent test**: Diagnosed issue awaits human approval.

- [ ] T007 [P] [US5] Implement human-gating logic at the end of `issue-triage.yaml`

## Phase 6: User Story 3 & 4 (P2)

**Independent test**: Obsolete issues closed; large issues split.

- [ ] T008 [P] [US3] Implement `close-obsolete` node
- [ ] T009 [P] [US4] Implement `decompose` node

## Phase 7: Polish

- [ ] T010 Add telemetry events for triage metrics
