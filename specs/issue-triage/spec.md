| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Branch  | issue-triage                           |
| Status  | In Progress                            |
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
- **FR7**: The `issues.labeled` webhook event MUST dispatch an `issue-triage` task when the applied label is `lore:triage` or `triage: needs-triage`; this mapping is wired in `apps/floor/src/events/handlers/github.ts` and `libs/shared/src/domain/task-types/dispatch-labels.ts`. Subsequent state transitions are driven by the label taxonomy (`triage: needs-triage`, `triage: needs-reproduction`, `triage: reproduced`, `triage: unable-to-reproduce`, `triage: diagnosed`, `triage: skipped`, `triage: not-actionable`, `triage: failed`) applied by the `triage_label` service station at each node outcome, via the `pipeline.events` bus and GitHub webhook ingress. ([validated by dispatches issue-triage task for lore:triage label](apps/floor/src/events/handlers/github.test.ts#L55), [dispatches issue-triage task for triage: needs-triage label](apps/floor/src/events/handlers/github.test.ts#L78))
- **FR8**: The handoff to the implementation loop MUST be human-gated, requiring manual application of the `lore:implementation` label.
- **FR9**: Incoming triage tasks MUST be processed in batches, ordering older issues first; how a batch is released is an Open Question below.
- **FR10**: The success criteria MUST be computable from what the line already records — the `outcome` of each issue-triage row in `pipeline.station_runs` and the `triage:*` labels on the issues — so the line emits no telemetry events of its own.
- **FR11**: The assembly-line schema (`libs/assembly-lines/src/assembly-line-schema.ts`) MUST accept per-node declared extra outcomes via an `outcomes` field so that `reproduce` can emit `unable-to-reproduce`, `needs-reproduction`, and `skipped`, and `verify` can emit `obsolete`, `large-issue`, and `not-actionable`; `libs/assembly-lines/src/transition.ts` and `libs/assembly-lines/src/node-outcome.ts` MUST route them as valid `EdgeConditionValue` targets. ([validated by accepts a node with declared custom outcomes (unable-to-reproduce, skipped, etc.)](libs/assembly-lines/src/loader.test.ts#L619), [rejects an edge whose `on` value is not declared in the source node's outcomes](libs/assembly-lines/src/loader.test.ts#L664), [accepts %s when it is in the node's declared outcomes list](libs/assembly-lines/src/node-result-schema.test.ts#L121), [accepts a declared custom outcome in bare-word form](libs/assembly-lines/src/node-result-schema.test.ts#L131), [rejects a custom outcome absent from the declared outcomes list — the walk cannot route what it never declared](libs/assembly-lines/src/node-result-schema.test.ts#L139), [still rejects undeclared strings even when other custom outcomes are declared](libs/assembly-lines/src/node-result-schema.test.ts#L147))
- **FR12**: Three agent recipes MUST be shipped as `libs/shared/src/agent-defaults/triage-reproduce.md`, `libs/shared/src/agent-defaults/triage-diagnose.md`, and `libs/shared/src/agent-defaults/triage-verify.md`, each stating what the agent writes and how it reports each of its custom outcomes on its `LORE_NODE_RESULT` line; `libs/assembly-lines/src/prompt-refs.test.ts` MUST fail CI for any agent node whose recipe file does not exist. ([validated by triage-reproduce, triage-diagnose, and triage-verify exist with non-empty prompts and correct timeout_minutes](libs/assembly-lines/src/triage-agent-recipes.test.ts#L10), [each recipe documents every LORE_NODE_RESULT outcome it can emit](libs/assembly-lines/src/triage-agent-recipes.test.ts#L38))
- **FR13**: The `issue-triage` task type MUST be added to `TaskTypeSchema` in `libs/shared/src/domain/models/pipeline-task.ts` and assigned a trust tier in `TRUST_LEVELS` in `libs/shared/src/domain/pipeline-task-trust.ts`; it MUST be mapped to this line in `assemblyLineFor` (`apps/floor/src/work/task/dispatch-agent-cr.ts`) and added to the pinned bundled-lines list in `libs/assembly-lines/src/loader.test.ts`.
- **FR14**: The eight `triage:*` labels MUST be created in each onboarded repository before the `issues` station runs (which refuses labels that do not exist); a `triage_label` service station in `apps/stations/src/work/triage-label/` MUST apply the label matching each node outcome.
- **FR15**: `close-obsolete` MUST be implemented as a new `close_issue` service station in `apps/stations/src/work/close-issue/` — posting a comment with the verdict then calling `project.issues.close` — with its `close_issue` node type added to `NodeType` and `PRODUCIBLE_OUTCOMES` in `libs/assembly-lines/src/assembly-line-schema.ts`.
- **FR16**: `human-gate` MUST be implemented as a new `issue_label` human-station type in `libs/assembly-lines/src/human-station.ts` with a manifest in `apps/stations/`; the `issuesLabeled` handler in `apps/floor/src/events/handlers/github.ts` MUST, before the `alreadyWorkingOnIssue` guard, detect a `lore:implementation` label on an issue whose triage run is parked at `human-gate`, report success to that node via the existing `RUN_RESUME_EVENT` (ending the triage run and its task), and only then dispatch the implementation task.

### Compliance Requirements

- **CR1**: MUST use the Floor's existing 3-layer event bus (`pipeline.events`) and `github.issues.labeled` webhook ingress as defined in ADR-015 and ADR-044.
- **CR2**: Each triage node's outcome MUST be recorded immutably in `pipeline.station_runs`; the next step MUST be derivable from persisted state alone without an in-memory walker (ADR-016).
- **CR3**: Executing untrusted reproduction repositories MUST run in a Dedicated Agent Pod; it MUST NOT execute on the Floor coordinator.
- **CR4**: The `issue-triage.yaml` MUST pass strict schema validation enforced by `libs/assembly-lines/src/loader.ts` at load time.

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

**Dropped from the plan's KPIs**: Human rework per bot PR — explicitly dropped because it measures implementation-loop/fix work which is out of scope for the triage line. Bot PR merge rate — not in the plan's KPIs; dropped.

## Assumptions

- The triage line relies on the existing AI agent subsystem integrations and does not require custom LLM hosting.

## Open Questions

- **How is a batch of triage work released (FR9)?** — Choices: a `cron.<job>.tick` fan-out that starts the oldest labelled issues each tick, as the detection lines do (`apps/floor/src/work/detect/fan-out.ts`); or a per-repo cap on concurrent issue-triage tasks in the task queue, claimed oldest issue first.
