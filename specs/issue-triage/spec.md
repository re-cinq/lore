# Feature Specification: Issue Triage Assembly Line

| Feature        | Issue Triage Assembly Line               |
|----------------|------------------------------------------|
| Status         | Draft                                    |
| Created        | 2026-09-28                               |
| Owner          | Platform Engineering                     |

An assembly line that handles the initial triage of GitHub issues by reproducing the bug in a sandbox, diagnosing the root cause, and verifying the intent against specs, ending in a human-gated handoff to the implementation loop.

## Problem Statement

Currently, our `implementation-loop` starts from an issue (via the priority labels) and jumps straight to writing a fix. We need to automatically clone reproduction repositories, trace root causes, and verify against documentation before committing to an implementation task, saving human triage effort and avoiding blocked tasks.

## Background: Cloudflare Astro Triage Pattern

Cloudflare implemented a "software factory" pipeline for Astro that reduced open issues significantly using a four-stage state machine: Reproduce, Diagnose, Verify, and Fix. Our goal is to adopt the triage front-half of this pattern (Reproduce, Diagnose, Verify) as a new Assembly Line in Lore.

## FR1 — Trigger & Batch Backlog Selection

- **FR1.1** The line MUST trigger on the event bus (`pipeline.events`) from GitHub webhooks (`github.issues.labeled`).
- **FR1.2** Processing MUST happen in batches, selecting older issues first to maintain the backlog.

## FR2 — GitHub Label Taxonomy and State Machine

- **FR2.1** `triage: needs-triage`: Initial state when an issue is opened or requires a new triage cycle (trigger).
- **FR2.2** `triage: needs-reproduction`: More information or a reproduction repository is required from the user.
- **FR2.3** `triage: reproduced`: The bot successfully reproduced the bug.
- **FR2.4** `triage: unable-to-reproduce`: The bot could not reproduce the bug with the provided information.
- **FR2.5** `triage: diagnosed`: The bot identified the root cause of the bug.
- **FR2.6** `triage: skipped`: The issue was skipped due to CI environment limits or other constraints.
- **FR2.7** `triage: not-actionable`: The issue is noise, a question, or otherwise cannot be acted upon.
- **FR2.8** `triage: failed`: The triage pipeline run encountered a failure.

## FR3 — Assembly Line Definition and Node Graph

- **FR3.1** The `issue-triage` assembly line MUST be defined in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` and pass strict YAML schema validation.
- **FR3.2** The graph MUST include `reproduce`, `diagnose`, `verify`, and `decompose` nodes, routing failure edges and respecting iteration limits.
- **FR3.3** The outcome of each triage node MUST be recorded immutably in `pipeline.station_runs` (ADR-016).

## FR4 — Untrusted Reproduction Sandboxing (Dedicated Agent Pod)

- **FR4.1** Executing user-provided reproduction code MUST run in a Dedicated Agent Pod for strict sandboxing isolation.
- **FR4.2** Execution MUST NEVER run directly on the Floor coordinator.

## FR5 — Diagnosis & Spec Verification

- **FR5.1** The `diagnose` node MUST analyze the codebase using instrumentation and logging to trace the root cause.
- **FR5.2** The `verify` node MUST cross-reference the diagnosed behaviour against existing specs and documentation to determine if the issue is a genuine bug.

## FR6 — Obsolete Issue Detection & Automated Closing

- **FR6.1** The line MUST detect issues that are already implemented or obsolete and automatically close them.

## FR7 — Large Issue Decomposition

- **FR7.1** When a large issue is detected, the `decompose` node MUST automatically split it into smaller, reviewable sub-tasks.

## FR8 — Human-Gated Handoff to Implementation Loop

- **FR8.1** Once an issue is diagnosed, the line MUST halt at a human gate.
- **FR8.2** Maintainers MUST review the diagnosed issue and manually apply implementation priority labels to trigger the `implementation-loop` (it MUST NOT be fully automatic).

## Constraints & Invariants

- Must use Floor's existing 3-layer event bus (`pipeline.events`) and `github.issues.labeled` webhook ingress (ADR-015 and ADR-044).
- Must adhere to branch-as-state / DB-as-state immutability constraints, recording outcomes in `pipeline.station_runs` (ADR-016).
- Must enforce strict sandboxing in Dedicated Agent Pods for executing untrusted reproduction repositories, avoiding execution on the Floor coordinator.
- Must ensure strict assembly line YAML schema compliance.

## Success Criteria

- **SC-001 (Triage automation rate)**: Percentage of issues that reach a confirmed root cause or are closed as intended behavior without human intervention >= 80%.
- **SC-002 (Time to working reproduction)**: Time from issue open to verified reproduction repository < 5 min.
- **SC-003 (Actionable rate)**: Increased actionable rate (`1 - not actionable / all issues`).
- **SC-004 (Missing-repro rate)**: Decreased missing-repro rate (`needs reproduction / triaged`).
- **SC-005 (Skip rate)**: Decreased skip rate (`skipped / triaged`).
- **SC-006 (Reproduction rate)**: Increased reproduction rate.
- **SC-007 (Failure rate)**: Pipeline failure rate with <= 3 retries is minimised.
- **SC-008 (Re-triage cycles per issue)**: Decreased count of loops back to `needs triage`.
- **SC-009 (Time to first triage verdict)**: Decreased time from issue opened to first non-`needs triage` label.
- **SC-010 (Backlog trend)**: Decreased open issues over time and median issue age.
- **SC-011 (LLM tokens/cost per issue)**: Minimised LLM tokens/cost per issue.
- **SC-012 (Docs/tests added from bot failures)**: Increased number of docs, comments, or tests added as a result of bot failures.
- **SC-013 (Reporter response latency)**: Decreased time spent in `fix pending`.
- **SC-014 (Bot PR merge rate)**: Increased bot PR merge rate.
- **SC-015 (Human rework per bot PR)**: Decreased amount of human rework per bot PR.

## Open Questions

> **Question:** How should we isolate untrusted reproduction repositories?
> **Choices:** Dedicated Agent Pod

> **Question:** Should the handoff to the `implementation-loop` be fully automatic, or require human approval?
> **Choices:** Human-gated

> **Question:** How should the triage assembly line process issues?
> **Choices:** Batches (older first)

> **Question:** How should the triage line handle issues it detects as obsolete or already implemented?
> **Choices:** Automatically close

> **Question:** When the triage line detects a large issue, should it automatically split it into smaller tasks?
> **Choices:** Split automatically (via decompose node)
