# Feature Specification: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line  |
| ------- | --------------------------- |
| Branch  | feat/issue-triage           |
| Status  | Draft                       |
| Created | 2026-09-28                  |
| Owner   | Lore Platform Team          |

Issue triage assembly line automates bug reproduction, diagnosis, and verification against specs before handing off to the implementation loop.

## Problem Statement

Currently, the `implementation-loop` starts from an issue (via the `priority labels`) and jumps straight to writing a fix. By introducing an `issue-triage` line driven by labels, we can automatically clone reproduction repositories, trace root causes, and verify against documentation *before* committing to an implementation task, saving human triage effort and avoiding blocked tasks.

## User Scenarios

### User Story 1 - Automated Bug Reproduction in Sandbox (Priority: P1)

The triagebot should spin up a sandbox and verify the reproduction repository almost instantly after an issue is opened.

**Why this priority**: Empirically confirming that the bug exists is the first step in triage.

**Independent Test**: An issue is labelled `triage: needs-triage` and the system spins up a sandbox, runs reproduction steps, and assigns `triage: reproduced` or `triage: unable-to-reproduce`.

**Acceptance Scenarios**:

1. **Given** an open issue with a reproduction repository, **When** the triage pipeline runs, **Then** it clones the repository in a dedicated pod and attempts to reproduce the issue.

### User Story 2 - Root Cause Diagnosis and Spec Verification (Priority: P1)

Once reproduced, the system analyses the codebase to trace the root cause and cross-references against specs to determine if it is a genuine bug.

**Why this priority**: Identifies why the bug occurs and validates it against design intent.

**Independent Test**: A reproduced issue triggers diagnosis and verification, producing a root cause analysis comment.

**Acceptance Scenarios**:

1. **Given** a reproduced issue, **When** the pipeline proceeds, **Then** it uses instrumentation to trace the root cause and compares findings with specs and docs.

### User Story 3 - Obsolete Issue Detection and Automatic Closing (Priority: P2)

The assembly line must detect already implemented issues or obsolete problems, because the project direction changes and closes the issues.

**Why this priority**: Cleans up the backlog automatically.

**Independent Test**: A stale or already-implemented issue is processed and closed.

**Acceptance Scenarios**:

1. **Given** an obsolete issue, **When** processed by the triage line, **Then** it is automatically closed.

### User Story 4 - Large Issue Detection and Decomposition (Priority: P2)

The assembly line must detect large issues and, when possible, split them so the resulting PRs are smaller.

**Why this priority**: Improves implementation efficiency by keeping tasks scoped.

**Independent Test**: A large issue is split into smaller issues via the decompose node.

**Acceptance Scenarios**:

1. **Given** a large, complex issue, **When** the pipeline processes it, **Then** it is split into smaller sub-issues.

### User Story 5 - Human-Gated Handoff to Implementation (Priority: P1)

Once the bot successfully diagnoses the issue, human maintainers must review and manually approve the transition rather than the bot automatically applying the `lore:implementation` label.

**Why this priority**: Prevents runaway task generation and allows the team to manage task priorities.

**Independent Test**: A diagnosed issue halts the pipeline and awaits a human label change to proceed to implementation.

**Acceptance Scenarios**:

1. **Given** a successfully diagnosed issue, **When** the pipeline completes, **Then** it does not automatically start the implementation loop but waits for human approval.

## Requirements

### Functional Requirements

- **FR1 — Assembly Line Definition and Station Graph**: A new `issue-triage` assembly line definition orchestrates the reproduce, diagnose, verify, decompose, and close-obsolete nodes in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`.
- **FR2 — Reproduction Sandboxing in Dedicated Agent Pods**: The `reproduce` node executes in a Dedicated Agent Pod to ensure strict sandboxing of untrusted code.
- **FR3 — Root Cause Diagnosis and Instrumentation**: The `diagnose` node analyses the codebase using instrumentation to trace the root cause of the reproduced failure.
- **FR4 — Spec and Documentation Verification**: The `verify` node cross-references the diagnosed behaviour against existing specs and documentation.
- **FR5 — Obsolete and Already-Implemented Issue Detection**: A `close-obsolete` node automatically closes issues detected as obsolete or already implemented.
- **FR6 — Large Issue Decomposition**: A `decompose` node automatically splits large, complex issues into smaller tasks.
- **FR7 — GitHub Label Taxonomy and Event-Driven State Machine**: The state machine is driven by `triage:*` labels mapped via the webhook event handler in `apps/floor/src/events/handlers/github.ts`.
- **FR8 — Human-Gated Handoff to Implementation Loop**: Transition to the `implementation-loop` requires human maintainers to manually apply the `lore:implementation` label.
- **FR9 — Batch Processing and Backlog Ordering**: The assembly line processes issues in batches, prioritizing older issues first via a scheduled batch task.
- **FR10 — Telemetry and Monitoring Events**: The assembly line emits monitoring events to `pipeline.events` to support triage automation metrics.

## Success Criteria

- **SC-001**: Triage automation rate reaches 80% (Percentage of issues that reach a confirmed root cause or are closed as intended behavior without human intervention).
- **SC-002**: Time to working reproduction is < 5 minutes.
- **SC-003**: Actionable rate increases (1 − `not actionable` / all issues).
- **SC-004**: Missing-repro rate decreases (`needs reproduction` / triaged).
- **SC-005**: Skip rate decreases (`skipped` / triaged).
- **SC-006**: Reproduction rate increases (Agent's ability to confirm bugs).
- **SC-007**: Failure rate decreases (`failed` / runs).
- **SC-008**: Re-triage cycles per issue decreases (Count of loops back to `needs triage`).
- **SC-009**: Time to first triage verdict decreases.
- **SC-010**: Backlog trend decreases (Open issues over time, and median issue age).
- **SC-011**: LLM tokens/cost per issue decreases.
- **SC-012**: Docs/tests added from bot failures increases.
- **SC-013**: Reporter response latency decreases.
- **SC-014**: Bot PR merge rate increases.

**Dropped from the plan's KPIs**:
- Human rework per bot PR — This is a KPI for the implementation/fix stage, which is out of scope for the triage line.

## Assumptions

- No specific assumptions required outside of the constraints and answers provided in the plan.

## Open Questions

- **Should the triage line automatically decompose large issues into smaller tasks?** — Choices: Yes, No. (The plan answered "Split automatically" for one question, but left `q-review-c5` open).
