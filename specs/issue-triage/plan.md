# Implementation Plan: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Branch  | issue-triage                           |
| Spec    | [spec.md](./spec.md)                   |
| Created | 2026-09-28                             |

This plan details the implementation of a new `issue-triage` assembly line, driven by GitHub label events, that automatically reproduces bugs in isolated pods, diagnoses root causes, and verifies them against specs before handing off to maintainers.

## Technical Context

| Aspect               | Value                                             |
| -------------------- | ------------------------------------------------- |
| Language/Runtime     | TypeScript ESM / Node 22                          |
| Modules touched      | `apps/floor`, `libs/assembly-lines`, `mcp-server` |
| Storage              | `pipeline.station_runs`, `pipeline.events`        |
| Testing              | vitest via workspace-source aliases               |
| Constraints          | Strict sandboxing for untrusted code execution    |

## Constitution Check

| Principle     | Verdict          | Note                        |
| ------------- | ---------------- | --------------------------- |
| Simple Design | PASS             | Reuses existing pipeline event bus and Agent CR architecture. |

## Mechanisms

### Trigger wiring

The trigger relies on the existing `github.issues.labeled` webhook ingress handled by the event-router and dispatched via the `pipeline.events` 3-layer bus. The webhook handler in `apps/floor/src/events/handlers/github.ts` will map labels `lore:triage` and `triage: needs-triage` to the `issue-triage` task type and create the corresponding pipeline task.

### Data model

The pipeline uses the existing `pipeline.station_runs` table for immutable state-as-DB checkpoints.
A new `issue-triage` line will be configured in `lore.repos.settings` if any feature flags are required, but defaults to executing based on the task type mapping.

### Assembly-line graph

Defined in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`.
Nodes:
- `reproduce`: An agent station configured for a Dedicated Agent Pod sandbox to clone and run the reproduction.
- `diagnose`: An agent station to instrument and trace root causes.
- `verify`: An agent station to check specs/docs.
- `close-obsolete`: A service station to close the issue if verified as obsolete.
- `decompose`: An agent station to split large issues.
- `human-gate`: A human station where a maintainer reviews the diagnosis and applies `lore:implementation` to proceed.

Edges:
- `reproduce` (success) -> `diagnose`
- `diagnose` (success) -> `verify`
- `verify` (success) -> `human-gate`
- `verify` (obsolete) -> `close-obsolete`
- `verify` (large-issue) -> `decompose`
- `verify` (not-actionable) -> `done`, applying `triage: not-actionable`
- `reproduce` (unable-to-reproduce or needs-reproduction) -> `done`, applying the matching label
- `close-obsolete` (always) -> `done`
- `decompose` (always) -> `done`
- `human-gate` (success) -> `done`

The line completes at a terminal `done` node (a `retrospective`, as the other lines end): the run ends once the issue carries its verdict label — closed as obsolete, split, parked for more information, or handed to a maintainer at `human-gate`, whose success is a maintainer applying `lore:implementation`.

Timeout minutes will be set appropriately (e.g., 15 minutes for reproduce, 10 for diagnose/verify).
Max iterations per node is capped at 3 retries on transient failures.

### Gating

The handoff to the implementation loop is explicitly human-gated at the `human-gate` node, requiring a maintainer to apply the `lore:implementation` label.

### State/label taxonomy

- `triage: needs-triage`: Initial state; triggers the assembly line.
- `triage: needs-reproduction`: Applied if the `reproduce` node fails due to missing information.
- `triage: reproduced`: Applied after successful `reproduce` node execution.
- `triage: unable-to-reproduce`: Applied if the `reproduce` node fails to reproduce the bug.
- `triage: diagnosed`: Applied after successful `diagnose` and `verify` node execution.
- `triage: skipped`: Applied if execution is skipped due to environment constraints.
- `triage: not-actionable`: Applied if the issue is deemed invalid or noise.
- `triage: failed`: Applied if the pipeline crashes or exhausts retries.

## Failure Edges & Rollback

- If `reproduce` fails to reproduce the issue, it transitions to `triage: unable-to-reproduce` and the line terminates.
- If a node encounters a system failure, it retries up to 3 times before transitioning to `triage: failed` and terminating.
- The feature can be rolled back by removing `lore:triage` and `triage: needs-triage` from the webhook label mapping, effectively ignoring those labels.

## Project Structure

```text
specs/issue-triage/
├── spec.md    
├── plan.md    
└── tasks.md   
```

Files touched:
- `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`
- `specs/github-issue-dispatch/spec.md`
- `apps/floor/src/events/handlers/github.ts`
