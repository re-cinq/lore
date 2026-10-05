| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Branch  | issue-triage                           |
| Status  | Draft                                  |
| Created | 2026-09-28                             |
| Owner   | Lore Platform Team                     |

The Issue Triage feature introduces a new assembly line to automatically reproduce bug reports in sandboxed pods, diagnose root causes, verify against specifications, and close obsolete issues before handing off valid bugs to human maintainers for implementation approval.

## Problem Statement

Developers create GitHub Issues as part of their natural workflow, but triaging them is a manual, time-consuming process. Maintainers must manually verify reproductions, check if the issue is already implemented, and trace root causes before an issue is ready for implementation. By introducing an `issue-triage` assembly line driven by labels, we can automatically clone reproduction repositories, trace root causes, and verify against documentation before committing to an implementation task, saving human triage effort and avoiding blocked tasks.

## User Scenarios

### User Story 1 - Automated Bug Reproduction in Sandbox (Priority: P1)

A user submits a bug report with a reproduction repository. The triage line automatically provisions an isolated sandbox, clones the repository, and confirms the bug exists.

**Why this priority**: Confirmed reproduction is the foundation of triaging any bug report and requires strict sandboxing (MVP).

**Independent Test**: Triggering the triage line on an issue with a valid reproduction repository results in the bot successfully running the reproduction and applying the `triage: reproduced` label.

**Acceptance Scenarios**:

1. **Given** a new issue labeled `triage: needs-triage` with a reproduction repository, **When** the triage line runs, **Then** it executes the reproduction in a Dedicated Agent Pod and transitions the issue to `triage: reproduced`.

### User Story 2 - Root Cause Diagnosis and Spec Verification (Priority: P1)

Once reproduced, the triage line diagnoses the root cause and cross-references it with existing documentation and specifications to determine if it's a genuine bug.

**Why this priority**: Prevents working on intended behavior and speeds up the fix by pinpointing the root cause.

**Independent Test**: A reproduced issue is diagnosed by the bot, which traces the failure to a specific code path and checks it against specs, resulting in a `triage: diagnosed` label.

**Acceptance Scenarios**:

1. **Given** an issue labeled `triage: reproduced`, **When** the triage line advances, **Then** the diagnose station traces the error and the verify station confirms it against specs, labeling it `triage: diagnosed`.

### User Story 3 - Obsolete Issue Detection and Automatic Closing (Priority: P2)

The triage line detects issues that describe problems already solved by recent changes or that no longer apply, and automatically closes them.

**Why this priority**: Keeps the backlog clean without manual maintainer effort.

**Independent Test**: An issue describing a bug fixed in a recent commit is processed and automatically closed by the bot.

**Acceptance Scenarios**:

1. **Given** an issue that cannot be reproduced on the latest `main`, **When** the verify station cross-references it, **Then** the bot closes the issue as already implemented or obsolete.

### User Story 4 - Large Issue Detection and Decomposition (Priority: P2)

The triage line identifies large, complex issues and automatically splits them into smaller, manageable tasks.

**Why this priority**: Ensures resulting PRs are small and reviewable.

**Independent Test**: An issue with multiple distinct bugs is split into separate GitHub issues linked to the original.

**Acceptance Scenarios**:

1. **Given** a multi-part bug report, **When** the triage line processes it, **Then** the decompose node splits it into smaller issues.

### User Story 5 - Human-Gated Handoff to Implementation (Priority: P1)

After successful diagnosis and verification, the bot waits for human approval before handing the issue off to the implementation loop.

**Why this priority**: Prevents runaway task generation and allows maintainers to control prioritization.

**Independent Test**: A diagnosed issue stops processing and waits for a human to apply the `lore:implementation` label.

**Acceptance Scenarios**:

1. **Given** a diagnosed issue, **When** it completes the triage line, **Then** it requires a human to manually apply the `lore:implementation` label to start the implementation loop.

## Requirements

### Functional Requirements

- **FR1**: The `issue-triage` assembly line MUST be defined as a YAML graph topology in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`.
- **FR2**: The Reproduce station MUST execute untrusted reproduction code within a Dedicated Agent Pod sandbox.
- **FR3**: The Diagnose station MUST instrument the codebase to trace the root cause of the reproduced failure.
- **FR4**: The Verify station MUST cross-reference the diagnosed behavior against existing specs and documentation.
- **FR5**: The assembly line MUST automatically close issues that the Verify station detects as already implemented or obsolete.
- **FR6**: The assembly line MUST automatically split large issues into smaller tasks via a decompose node.
- **FR7**: State transitions MUST be driven by a label taxonomy (`triage: needs-triage`, `triage: needs-reproduction`, `triage: reproduced`, `triage: unable-to-reproduce`, `triage: diagnosed`, `triage: skipped`, `triage: not-actionable`, `triage: failed`) via the `pipeline.events` bus and GitHub webhook ingress. ([validated by maps each triage outcome to the correct triage:* label and calls addLabel with the issue number](apps/stations/src/work/triage-label/triage-label.test.ts#L33))
- **FR8**: The handoff to the implementation loop MUST be human-gated, requiring manual application of the `lore:implementation` label.
- **FR9**: Incoming triage tasks MUST be processed in batches, ordering older issues first; how a batch is released is an Open Question below.
- **FR10**: The success criteria MUST be computable from what the line already records — the `outcome` of each issue-triage row in `pipeline.station_runs` and the `triage:*` labels on the issues — so the line emits no telemetry events of its own.

## Success Criteria

- **SC-001**: Triage automation rate achieves 80%, computed from `pipeline.station_runs` terminal states.
- **SC-002**: Time to working reproduction is < 5 minutes from issue open to sandbox verification.
- **SC-003**: Actionable rate increases.
- **SC-004**: Missing-repro rate decreases.
- **SC-005**: Skip rate decreases.
- **SC-006**: Reproduction rate increases.
- **SC-007**: Failure rate decreases.
- **SC-008**: Re-triage cycles per issue decreases.
- **SC-009**: Time to first triage verdict decreases.
- **SC-010**: Backlog trend (open issues and median age) decreases.
- **SC-011**: LLM tokens/cost per issue decreases.
- **SC-012**: Docs/tests added from bot failures increases.
- **SC-013**: Reporter response latency decreases.
- **SC-014**: Bot PR merge rate increases.

**Dropped from the plan's KPIs**: Human rework per bot PR — explicitly dropped because it measures implementation-loop/fix work which is out of scope for the triage line.

## Assumptions

- The triage line relies on the existing AI agent subsystem integrations and does not require custom LLM hosting.

## Open Questions

- **Should the triage line automatically decompose large issues into smaller tasks?** — Choices: split automatically via the `decompose` node, or leave the issue whole for a maintainer.
- **How is a batch of triage work released (FR9)?** — Choices: a `cron.<job>.tick` fan-out that starts the oldest labelled issues each tick, as the detection lines do (`apps/floor/src/work/detect/fan-out.ts`); or a per-repo cap on concurrent issue-triage tasks in the task queue, claimed oldest issue first.
