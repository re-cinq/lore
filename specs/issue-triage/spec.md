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

## FR1 — Trigger & Routing

- **FR1.1** The line MUST trigger on the 3-layer event bus (`pipeline.events`) via the GitHub webhook ingress `POST /api/webhook/github` mapping to `github.issues.labeled` events (ADR-044).
- **FR1.2** Processing MUST happen in batches, selecting older issues first to maintain the backlog.

## FR2 — GitHub Label Taxonomy and State Machine

- **FR2.1** `triage: needs-triage`: Initial state when an issue is opened or requires a new triage cycle (triggers the webhook).
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
- **FR3.3** The outcome of each triage node MUST be recorded immutably in the `pipeline.station_runs` table as per ADR-016.
- **FR3.4** Failure edges for `unable-to-reproduce`, `not-actionable`, and `failed` MUST route to a terminal `retrospective` node.

## FR4 — Untrusted Reproduction Sandboxing (Dedicated Agent Pod)

- **FR4.1** Executing user-provided reproduction code MUST run in a Dedicated Agent Pod for strict sandboxing isolation.
- **FR4.2** Execution MUST NEVER run directly on the Floor coordinator.

## FR5 — Diagnosis & Spec Verification

- **FR5.1** The `diagnose` node MUST analyze the codebase using instrumentation and logging to trace the root cause.
- **FR5.2** The `verify` node MUST cross-reference the diagnosed behaviour against existing specs and documentation to determine if the issue is a genuine bug.

## FR6 — Obsolete Issue Detection & Automated Closing

- **FR6.1** The line MUST detect issues that are already implemented or obsolete and automatically close them via GitHub API in the node outcome handler.

## FR7 — Large Issue Decomposition

- **FR7.1** When a large issue is detected, the `decompose` node MUST automatically split it into smaller, reviewable sub-tasks.

## FR8 — Constraints & Compliance Requirements

- **FR8.1** The assembly line MUST use Floor's existing 3-layer event bus (`pipeline.events`) and `github.issues.labeled` webhook ingress per ADR-015 and ADR-044.
- **FR8.2** The line MUST adhere to DB-as-state immutability constraints, recording outcomes in `pipeline.station_runs` per ADR-016.
- **FR8.3** The assembly line definition MUST comply strictly with the YAML schema validation in `libs/assembly-lines/src/loader.ts`.

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
- **SC-012**: The fix-related metrics (`Reporter response latency` for `fix pending`, `Bot PR merge rate`, `Human rework per bot PR`, and `Docs/tests added from bot failures`) have been deliberately dropped because they measure fix-side states, which are out of scope for the triage taxonomy and assembly line.

## Open Questions

> **Question:** How should we isolate untrusted reproduction repositories?
> **Choices:** Dedicated Agent Pod | In-Process

> **Question:** Should the handoff to the `implementation-loop` be fully automatic, or require human approval?
> **Choices:** Human-gated | Automatic
