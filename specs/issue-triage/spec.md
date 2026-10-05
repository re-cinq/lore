| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Status  | Draft                                  |
| Created | 2026-09-28                             |
| Owner   | Lore Platform Team                     |

The Issue Triage feature introduces a new `issue-triage` assembly line to automatically reproduce bug reports in sandboxed pods, diagnose root causes, verify against specifications, and close obsolete issues before handing off valid bugs to human maintainers for implementation approval. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_3369870e-e221-4db3-bed8-dae817216848), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_865c6fcc-d624-4dce-a512-6cb53a12bc6d), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_335cf272-1965-431a-b1de-14a9890118e9))

## Problem Statement

Developers create GitHub Issues as part of their natural workflow, but triaging them is a manual, time-consuming process. Maintainers must manually verify reproductions, check if the issue is already implemented, and trace root causes before an issue is ready for implementation. Cloudflare demonstrated how a software factory approach can dramatically reduce open issues: their triagebot achieved a ~90% reduction in open issues for the Astro project through a four-stage pipeline (Reproduce, Diagnose, Verify, Fix) documented in their blog post and triagebot-action repository. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#intent-p-1), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_a630c567-53a1-41c2-8c40-0dfebc493064), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_9994672e-7756-4ce3-aab9-762b034c15fd))

By introducing an `issue-triage` assembly line driven by labels, we can automatically clone reproduction repositories, trace root causes, and verify against documentation before committing to an implementation task, saving human triage effort and avoiding blocked tasks.

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

- **FR1**: The `issue-triage` assembly line MUST be defined as a floor pipeline YAML at `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` in the three-block floor format (`line`, `stations`, `agent_definitions`); lore-api seeds it to the floor at boot via `apps/lore-api/src/work/floor/seed-floor-pipelines.ts`, and its name joins the pinned list in `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` so CI confirms the line loads without error. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_4733905e-e04e-40ca-b176-ec8ee2e372f2), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_9d512c77-3394-406b-9cac-88813ac47d2c), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_3369870e-e221-4db3-bed8-dae817216848), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_865c6fcc-d624-4dce-a512-6cb53a12bc6d), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_335cf272-1965-431a-b1de-14a9890118e9))
- **FR2**: The Reproduce station MUST execute untrusted reproduction code within a Dedicated Agent Pod sandbox by cloning the provided reproduction repository and running the reproduction steps to empirically confirm the bug exists and fails as described. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_8a2880b7-3787-4d87-9a2b-d51db889f41a), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#custom-sandboxing-p-1), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#q_cfdeebf2-f20a-4590-b608-dd08f05097f9), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_abfb1e53-4c99-4353-b79b-3a7a84c1f1ab))
- **FR3**: The Diagnose station MUST instrument the codebase to trace the root cause of the reproduced failure. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_930336a3-d868-4057-884d-d0fcd18b81fd))
- **FR4**: The Verify station MUST cross-reference the diagnosed behavior against existing specs and documentation to determine if the issue is a genuine bug, a misunderstanding, or intended behaviour. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_2a657e4e-8363-407b-80ac-a9c16626b946))
- **FR5**: The assembly line MUST automatically close issues that the Verify station detects as already implemented or obsolete via the `close-obsolete` service station in `apps/stations/src/`; the station posts a comment with the verdict then calls `project.issues.close`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#q_obsolete_issues), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_5f40ed4e-0c99-47a0-8e59-dfaadf0e3778))
- **FR6**: The assembly line MUST automatically split large issues into smaller tasks via a `decompose` agent node that reuses the `feature-decompose` output contract. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#q_split_large_issues), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#q-review-c5))
- **FR7**: The `github.issues.labeled` webhook event MUST start a floor run for the `issue-triage` line when the applied label is `lore:triage` or `triage: needs-triage`; this dispatch is wired in the `github.issues.labeled` handler registered in `apps/stations/src/events/repo-handlers.ts`, which calls `floor.lines.start('issue-triage', {repo, issue_url, issue_number})`; subsequent state transitions are driven by the label taxonomy applied by the `triage_label` service station at each node outcome via the `pipeline.events` bus and `github.issues.labeled` webhook ingress. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_319f01cc-71e7-4091-8e09-6d07ac2cbe94), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_de9d024e-dc6b-48fb-ace7-922c8dfd13ea), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_eaf2b9b6-9ef7-4279-8f67-a27a29202e24), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_b6744d75-9d52-4bf9-8c0a-8a0a30e792c6))
- **FR8**: The handoff to the implementation loop MUST be human-gated, requiring manual application of the `lore:implementation` label; once a maintainer applies that label to an issue whose triage run is parked at `human-gate`, the `github.issues.labeled` handler in `apps/stations/src/events/repo-handlers.ts` reports success to the parked visit via `libs/shared/src/outbound/floor/floor-report.ts`, ends the triage run, and only then dispatches the implementation task. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#q_69fe6b62-0944-4e8c-9f07-5bb0766d9d09), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_09dd3a33-b730-42da-ba78-3b3b4c245486), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_70b7505f-22a2-4526-b530-0b04fd776695), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_03102ffa-aac7-4292-b8b1-989c4cb2fb9d))
- **FR9**: Incoming triage work MUST be processed in batches without shared context, ordering older issues first; a cron-tick fan-out sweep under `apps/stations/src/work/issue-triage-tick/` (triggered by a cron emitter in `libs/shared/src/work/scheduler/cron-emitters.ts`) picks the oldest `triage: needs-triage`-labelled issues up to a per-repo concurrency cap and starts a floor run for each, following the same pattern as `apps/stations/src/work/loop-tick/`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#q_batch_vs_single))
- **FR10**: The success criteria MUST be computable from what the line already records — the `outcome` of each issue-triage row in `pipeline.station_runs` and the `triage:*` labels on the issues — so the line emits no telemetry events of its own.
- **FR11**: The `reproduce` station MUST declare custom outcomes `[unable-to-reproduce, needs-reproduction, skipped]` and the `verify` station MUST declare `[obsolete, large-issue, not-actionable]` in the floor pipeline YAML's `stations` block; the floor's own loader routes these as valid edge targets and rejects any outcome not declared — no Lore-side schema change to `libs/assembly-lines/src/assembly-line-schema.ts`, `transition.ts`, or `node-outcome.ts` is required. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_ed28d148-910b-4fab-b862-d96449c25a5b), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#custom-platform-work-p-1))
- **FR12**: Three agent recipes MUST be shipped as `libs/shared/src/agent-defaults/triage-reproduce.md`, `libs/shared/src/agent-defaults/triage-diagnose.md`, and `libs/shared/src/agent-defaults/triage-verify.md`, each with frontmatter (`model`, `timeout_minutes`) and a body stating what the agent writes and which `LORE_NODE_RESULT` value it emits for each custom outcome; the `triage-reproduce` recipe uses `timeout_minutes: 15` and emits `success`, `unable-to-reproduce`, `needs-reproduction`, or `skipped`; `triage-diagnose` uses `timeout_minutes: 10` and emits `success` or `failed`; `triage-verify` uses `timeout_minutes: 10` and emits `success`, `obsolete`, `large-issue`, or `not-actionable`; `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` fails CI for any agent definition with an empty prompt. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_8ef41e6d-4766-4250-8370-d2cef2568fa0), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_4018efc4-7f36-43c0-a278-e918494c6a13))
- **FR13**: The `issue-triage` task type MUST be added to `TaskTypeSchema` in `libs/shared/src/domain/models/pipeline-task.ts` and assigned a trust tier in `TRUST_LEVELS` in `libs/shared/src/domain/pipeline-task-trust.ts`; a floor run is started directly via `floor.lines.start` from the stations drain handler — no `assemblyLineFor` mapping is needed — and the line's name is added to the pinned pipeline list in `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_5c4111fb-4cc5-4e23-9825-4ffe30ebf771))
- **FR14**: The eight `triage:*` labels (`triage: needs-triage`, `triage: needs-reproduction`, `triage: reproduced`, `triage: unable-to-reproduce`, `triage: diagnosed`, `triage: skipped`, `triage: not-actionable`, `triage: failed`) MUST be created in each onboarded repository before the `issues` station runs; a `triage_label` service station in `apps/stations/src/work/triage-label/` MUST apply the label matching each node outcome via `project.issues.addLabel`; the station type and its outcomes are declared in the floor pipeline YAML's `stations` block — no change to `libs/assembly-lines/src/assembly-line-schema.ts` is required. The labels drive the issue triage state machine with the following roles: `triage: needs-triage` — initial state when an issue is opened or requires a new triage cycle; `triage: needs-reproduction` — more information or a reproduction repository is required from the reporter; `triage: reproduced` — the bot confirmed the bug exists as described; `triage: unable-to-reproduce` — the bot could not reproduce the bug with the provided information; `triage: diagnosed` — the bot identified the root cause of the bug; `triage: skipped` — the issue was skipped due to CI environment limits or other constraints; `triage: not-actionable` — the issue is noise, a question, or otherwise cannot be acted upon; `triage: failed` — the triage pipeline run encountered a failure. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_c5fabbb0-e893-455f-a399-28ef20c8f0ab), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_b6744d75-9d52-4bf9-8c0a-8a0a30e792c6), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_31c22fda-4435-484b-b50c-faa08710a1e6), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_45619497-2698-4287-a02f-bc4b3b887fcd), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_f84b27ad-9c1f-4b7b-ae40-18f9bcb37ed3), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_5937490f-18d5-4e67-8432-5c55cbddfe8f), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_06672cce-7f23-42fd-ac52-d6e982732e79), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_ec00c450-4107-4b45-9d3f-7f3620201cef), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_d1403574-e43d-4b5d-ba47-6104c74d10e8), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_64bbb924-f379-4076-b6e4-a45a28711037))
- **FR15**: `close-obsolete` MUST be implemented as a new service station in `apps/stations/src/work/close-issue/`, written with `@re-cinq/floor-station`, that posts a comment with the triage verdict and calls `project.issues.close`; its station type and outcomes are declared in the floor pipeline YAML's `stations` block — no change to `libs/assembly-lines/src/assembly-line-schema.ts` is required. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_5f40ed4e-0c99-47a0-8e59-dfaadf0e3778))
- **FR16**: `human-gate` MUST be declared as a `kind: human` station entry in the floor pipeline YAML's `stations` block with `route: '{args.issue_url}'`; the `github.issues.labeled` handler in `apps/stations/src/events/repo-handlers.ts` MUST, before the `alreadyWorkingOnIssue` guard, detect a `lore:implementation` label on an issue whose triage run is parked at `human-gate`, report success to that visit via `libs/shared/src/outbound/floor/floor-report.ts`, end the triage run, and only then dispatch the implementation task. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_5e255321-ef0b-4cc2-8ebe-6c1d511e8416))

### Compliance Requirements

- **CR1**: MUST use the Floor's existing 3-layer event bus (`pipeline.events`) and `github.issues.labeled` webhook ingress as defined in ADR-015 and ADR-044. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_fec34c5d-9ce4-4061-b1f8-067e0b972883))
- **CR2**: Each triage node's outcome MUST be recorded immutably in `pipeline.station_runs`; the next step MUST be derivable from persisted state alone without an in-memory walker (ADR-016). ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_94b1f0d8-14f6-4ead-acef-00d2e196321e))
- **CR3**: Executing untrusted reproduction repositories MUST run in a Dedicated Agent Pod; it MUST NOT execute on the Floor coordinator or the stations service. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_cb20c686-8e98-46f0-be5c-6e9cf2bee271))
- **CR4**: The `issue-triage.yaml` pipeline MUST pass the floor's own schema validator when imported via `apps/lore-api/src/work/floor/seed-floor-pipelines.ts` at boot. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_117adbdc-2e72-40d2-b6ae-a1bcb60ebbfc))

## Success Criteria

- **SC-001**: Triage automation rate achieves 80%, computed from `pipeline.station_runs` terminal states. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_8a8476c9-006a-401a-806c-2595228c034a))
- **SC-002**: Time to working reproduction is < 5 minutes from issue open to sandbox verification. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_0e367fbf-d509-4215-b9ac-83e070e9842e))
- **SC-003**: Actionable rate (1 − `not actionable` / all issues) increases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_43af14b9-810d-468c-b901-d734902ceaef))
- **SC-004**: Missing-repro rate (`needs reproduction` / triaged) decreases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_90b5bcd9-c8f7-43ad-82f2-efe124f40c1d))
- **SC-005**: Skip rate (`skipped` / triaged) decreases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_3a04b551-a84e-4e26-b84f-f240d86ef826))
- **SC-006**: Reproduction rate (issues reproduced / opened) increases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_af66a417-eae6-4864-bb79-495bcb259908))
- **SC-007**: Failure rate (`failed` / runs) decreases; failed runs may be retried up to 3 times. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_54ec2d52-0ce4-416f-bfa8-6196886791b0))
- **SC-008**: Re-triage cycles per issue (count of loops back to `needs triage`) decreases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_a383ac8d-fa20-47fb-93b9-cbc682c35cc3))
- **SC-009**: Time to first triage verdict (issue opened → first non-`needs triage` label) decreases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_94fe7a4b-433f-4eff-8c21-36061889c1e7))
- **SC-010**: Backlog trend (open issues over time and median issue age) decreases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_64298868-f15c-4165-ada9-74adcd517533))
- **SC-011**: LLM tokens/cost per issue decreases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_2c2109cb-6896-4b40-b1d4-24111687a2f3))
- **SC-012**: Docs/tests added as a result of bot failures increases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_3a9c25ef-9fab-4689-aa4d-b60889f75551))
- **SC-013**: Reporter response latency (time an issue spends parked at `human-gate`, labeled `triage: diagnosed` awaiting `lore:implementation`) decreases; for the triage line this is the `fix pending` equivalent from the plan's KPI rationale, measured as the interval from the `triage: diagnosed` label being applied to the `lore:implementation` label triggering the handoff, computable from `pipeline.station_runs`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#kpi_1c9e9282-1268-4eab-a9fb-0fca1e066b2b))

**Dropped from the plan's KPIs**: Human rework per bot PR — explicitly dropped because it measures implementation-loop/fix work which is out of scope for the triage line. Bot PR merge rate — not in the plan's KPIs; dropped.

## Assumptions

- The triage line relies on the existing AI agent subsystem integrations and does not require custom LLM hosting. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_fbb61717-ddb6-4610-a917-a0bb1855ca8a))
- The Fix stage is out of scope; the triage line hands off to the existing `implementation-loop` Assembly Line which already handles writing patches, running tests, and opening PRs. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_15a6b455-355a-47b8-9ded-0851ad705ed8), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_359e6632-b6cf-4931-ae0b-02ed7710db76))
- The Lore Platform Team owns and operates the assembly line, the Event Router, and the Floor coordinator. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_7b39b3ce-cd00-4920-afe6-fdd631e7877f))
- Maintainers of onboarded repositories trigger the workflow by adding the `lore:triage` or `triage: needs-triage` label to an issue. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_e3e12bde-6b20-4d91-872b-9bc29d74e90f))
- The pipeline design (Reproduce → Diagnose → Verify) is adopted from the Cloudflare triagebot approach for the Astro project, which demonstrated that a software factory pipeline can reduce open issues by ~90%. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#intent-p-1), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_a630c567-53a1-41c2-8c40-0dfebc493064), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_9994672e-7756-4ce3-aab9-762b034c15fd))
