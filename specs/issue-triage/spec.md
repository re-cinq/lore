# Feature Specification: Issue Triage Assembly Line

| Field     | Value                                                                    |
|-----------|--------------------------------------------------------------------------|
| Feature   | Issue Triage Assembly Line                                               |
| Status    | In Progress                                                              |
| Created   | 2026-09-28                                                               |
| Owner     | Platform Engineering                                                     |
| Builds on | [specs/4-ux-repo-onboarding](../4-ux-repo-onboarding/spec.md)            |

Issue triage is a distinct autonomous assembly line workflow and lifecycle that operates on incoming GitHub issues before implementation, featuring its own label taxonomy, sandboxed reproduction execution in dedicated agent pods, root cause diagnosis, documentation/spec verification, obsolete issue auto-closing, task decomposition, and human-gated handoff to the implementation-loop.

## Problem Statement

When users file issues, they often lack a clear reproduction, or might be describing an intended behavior documented in a specification. Today, these tickets sit in a backlog until a human maintainer reads them, attempts to reproduce the problem locally, checks documentation, and decides if it is a bug, a feature, or invalid. This manual triage is a bottleneck. Furthermore, untrusted code provided in issue reproductions poses a security risk if executed directly on the host or inside a privileged CI environment.

## FR1 — Triage Label Taxonomy and State Machine

- FR1.1: The system MUST define and react to a `triage:*` label taxonomy: `triage: needs-triage`, `triage: needs-reproduction`, `triage: reproduced`, `triage: unable-to-reproduce`, `triage: diagnosed`, `triage: skipped`, `triage: not-actionable`, `triage: failed`.
- FR1.2: A GitHub webhook event for a newly opened issue MUST automatically apply `triage: needs-triage` to begin the triage state machine.
- FR1.3: The state machine transitions MUST be driven by the outcomes of the assembly line stations, applying the appropriate `triage:*` label upon completion of each phase.

## FR2 — Batch Dispatch and Ticket Ordering

- FR2.1: Open issues marked with `triage: needs-triage` MUST be processed in batch dispatch.
- FR2.2: Ticket processing order MUST be oldest-first to prevent starvation of older issues.
- FR2.3: The system MUST implement duplicate detection to prevent redundant processing of the same underlying issue.

## FR3 — Assembly Line Definition and Graph Transitions

- FR3.1: The `issue-triage` assembly line graph MUST be defined in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`.
- FR3.2: The graph MUST define the standard transition path: `reproduce` -> `diagnose` -> `verify` -> `decompose` -> `human-gate`.

## FR4 — Reproduction Station and Dedicated Agent Pod Sandboxing

- FR4.1: The assembly line MUST include a Reproduction Station that attempts to run the user-provided code or steps to reproduce the issue.
- FR4.2: The Reproduction Station MUST execute untrusted reproduction code within Sandboxed Dedicated Agent Pods.
- FR4.3: The sandbox MUST strictly isolate the execution environment, ensuring no exposure of host credentials, secrets, or internal network access.

## FR5 — Diagnosis and Root Cause Analysis Station

- FR5.1: Following reproduction, a Diagnosis Station MUST perform root cause analysis on successfully reproduced issues.
- FR5.2: The Diagnosis Station MUST utilize codebase context (via standard Lore context assembly) to trace the root cause and propose an explanation.

## FR6 — Spec and Documentation Conformance Verification Station

- FR6.1: A Verification Station MUST check the diagnosed issue against existing specifications and documentation.
- FR6.2: This station MUST distinguish genuine bugs (spec violations) from intended behaviors (working as designed).

## FR7 — Obsolete, Duplicate, and Already-Implemented Issue Detection

- FR7.1: The triage line MUST detect obsolete, duplicate, or already-implemented issues.
- FR7.2: Such issues MUST be automatically closed by the bot, accompanied by a clear explanatory comment detailing why the issue was closed.

## FR8 — Issue Decomposition for Oversized Tickets

- FR8.1: A Decomposition Station MUST evaluate the scope of the diagnosed issue.
- FR8.2: Broad or oversized issues MUST be decomposed into smaller, actionable sub-tasks linked to a parent tracking issue.

## FR9 — Human-Gated Handoff to Implementation Loop

- FR9.1: The final station MUST act as a human gate.
- FR9.2: Diagnosed issues MUST be reviewed by human maintainers who apply priority labels (e.g., `priority:high`).
- FR9.3: Only after a human applies a priority label does the task hand off from the `issue-triage` line to the `implementation-loop`.

## Out of Scope

- Modifying the internal logic of the `implementation-loop` or its backlog selection rules.
- Automatic mutation of `priority` labels without human intervention.
- Modifying the underlying Dark Factory execution engine or Station consolidation registry contracts.

## Acceptance Criteria

- When an issue is opened, it automatically receives the `triage: needs-triage` label and enters the `issue-triage` assembly line.
- Untrusted reproduction steps execute safely within a sandboxed pod, never compromising the host.
- The pipeline correctly moves an issue through reproduce, diagnose, verify, and decompose stages, updating labels accordingly.
- Issues describing intended behavior are auto-closed with a polite explanation citing the relevant specification.
- Handoff to implementation only occurs when a maintainer adds a priority label.