# Implementation Plan: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Branch  | issue-triage                           |
| Spec    | [spec.md](./spec.md)                   |
| Created | 2026-09-28                             |

> **Out of date since 2026-10-02.** This plan was written for the engine Lore ran itself: a line file under `libs/assembly-lines/src/assembly-lines/`, node types, and `runtime: service` node stations under `apps/stations/src/work/`. That engine and its node stations are deleted (`specs/external-floor` FR16.10, FR16.12). Before any task of this plan is implemented it has to be re-planned as a floor pipeline file with floor stations (`.lore/assembly-line-guide.md`).

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

The trigger relies on the existing `github.issues.labeled` webhook ingress handled by the event-router and dispatched via the `pipeline.events` 3-layer bus. Today the `issuesLabeled` handler in `apps/floor/src/events/handlers/github.ts` returns early for every label that is not the repo's single `dispatchLabel` (default `lore`), so `lore:triage` and `triage: needs-triage` are silently dropped. The fix replaces that single-label guard with a label → task-type map (in `libs/shared/src/domain/task-types/dispatch-labels.ts`): `lore` keeps today's behaviour mapping to the repo's `dispatch_default_type`, and `lore:triage` and `triage: needs-triage` map to `issue-triage`. This is the same table that onboarding seeds from, so a label a repo is given and a label this reader understands remain one declaration.

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
- `reproduce` (skipped) -> `done`, applying `triage: skipped` — the reproduction needs an environment the pod cannot provide (hardware, OS, external service), which is what the plan's skip-rate KPI counts
- `reproduce`, `diagnose`, `verify` (failed, after the 3 retries) -> `done`, applying `triage: failed`
- `close-obsolete` (always) -> `done`
- `decompose` (always) -> `done`
- `human-gate` (success) -> `done`

The line completes at a terminal `done` node (a `retrospective`, as the other lines end): the run ends once the issue carries its verdict label — closed as obsolete, split, parked for more information, or handed to a maintainer at `human-gate`, whose success is a maintainer applying `lore:implementation`.

Timeout minutes will be set appropriately (e.g., 15 minutes for reproduce, 10 for diagnose/verify).
Max iterations per node is capped at 3 retries on transient failures.

### Gating

The handoff to the implementation loop is explicitly human-gated at the `human-gate` node, requiring a maintainer to apply the `lore:implementation` label. Today that label would be refused: the webhook handler's `alreadyWorkingOnIssue` (`apps/floor/src/events/handlers/github.ts`) answers any dispatch on an issue that still has an active task with "Already being worked on", and the triage task parked at `human-gate` is exactly that. So the handler must first report success to a triage line parked at `human-gate` for that issue — ending the triage run and its task — and only then dispatch the implementation task.

### State/label taxonomy

- `triage: needs-triage`: Initial state; triggers the assembly line.
- `triage: needs-reproduction`: Applied if the `reproduce` node fails due to missing information.
- `triage: reproduced`: Applied after successful `reproduce` node execution.
- `triage: unable-to-reproduce`: Applied if the `reproduce` node fails to reproduce the bug.
- `triage: diagnosed`: Applied after successful `diagnose` and `verify` node execution.
- `triage: skipped`: Applied if execution is skipped due to environment constraints.
- `triage: not-actionable`: Applied if the issue is deemed invalid or noise.
- `triage: failed`: Applied if the pipeline crashes or exhausts retries.

### Platform work this line needs

The six prerequisites below must be built in this order before the YAML nodes can load or run.

#### Custom node outcomes

`EdgeCondition` in `libs/assembly-lines/src/assembly-line-schema.ts` today only allows `success`, `changes_requested`, `failed`, and `always`. An agent node declares extra outcomes via a new optional `outcomes: string[]` field in `NodeSchema`; the loader validates them at parse time (each declared value becomes a legal `EdgeConditionValue` for edges leaving that node). `libs/assembly-lines/src/transition.ts`'s `selectEdge` resolves a declared custom outcome by exact string match before falling back to the standard set. `libs/assembly-lines/src/node-outcome.ts`'s `stationNodeOutcome` / `parseNodeResult` accept the declared values on the `LORE_NODE_RESULT` line and map them through. Tests: `libs/assembly-lines/src/loader.test.ts` (custom outcome validates, routes, rejects undeclared); `libs/assembly-lines/src/node-result-schema.test.ts` (parse round-trip for each triage outcome).

#### Agent recipes

One `.md` file each in `libs/shared/src/agent-defaults/`:
- `triage-reproduce.md`: frontmatter sets `model` and `timeout_minutes: 15`; body tells the agent to clone the reproduction repository, run the provided steps, and emit one of `LORE_NODE_RESULT: success` (reproduced), `LORE_NODE_RESULT: unable-to-reproduce`, `LORE_NODE_RESULT: needs-reproduction`, or `LORE_NODE_RESULT: skipped` (environment limits).
- `triage-diagnose.md`: frontmatter sets `timeout_minutes: 10`; body instructs instrumentation and root-cause tracing, emits `LORE_NODE_RESULT: success` or `LORE_NODE_RESULT: failed`.
- `triage-verify.md`: frontmatter sets `timeout_minutes: 10`; body cross-references the diagnosis against specs and docs; the issue split reuses `feature-decompose`'s output contract; emits `LORE_NODE_RESULT: success`, `LORE_NODE_RESULT: obsolete`, `LORE_NODE_RESULT: large-issue`, or `LORE_NODE_RESULT: not-actionable`.

`libs/assembly-lines/src/prompt-refs.test.ts` fails CI for any agent node whose `prompt_ref` names a file that does not exist — adding all three recipes before the YAML nodes load is mandatory to keep CI green.

#### Task type registration

Four symbols, four files, in sequence:
1. Add `"issue-triage"` to `TaskTypeSchema` in `libs/shared/src/domain/models/pipeline-task.ts`.
2. Add an `"issue-triage"` entry to `TRUST_LEVELS` in `libs/shared/src/domain/pipeline-task-trust.ts` (tier: `implementation`, matching the trust ladder the feature requires).
3. Map `"issue-triage"` → `"issue-triage"` (the YAML name) in `assemblyLineFor` in `apps/floor/src/work/task/dispatch-agent-cr.ts`.
4. Add `"issue-triage"` to the pinned bundled-lines name list in `libs/assembly-lines/src/loader.test.ts` so the "loads all bundled assembly lines without error" test covers it.

#### Label creation and `triage_label` service station

The `issues` station (`apps/stations/src/planning/file-issues/`) calls the GitHub API to apply labels and refuses a label that does not exist in the repository. The eight `triage:*` labels must be created in each onboarded repository (onboarding scaffolding or a one-time setup step) before any triage run reaches the `issues` station.

`triage_label` is a new `runtime: service` station in `apps/stations/src/work/triage-label/`: it reads the node outcome from its input and calls `project.issues.addLabel(issueNumber, triageLabelForOutcome(outcome))`. Its node type is `triage_label`; it must be added to `NodeType` and `PRODUCIBLE_OUTCOMES` (`["success", "failed"]`) in `libs/assembly-lines/src/assembly-line-schema.ts`. Test: `apps/stations/src/work/triage-label/triage-label.test.ts` (applies the correct label per outcome).

#### `close-obsolete` service station

`close_issue` is a new `runtime: service` station in `apps/stations/src/work/close-issue/`: it posts a comment with the triage verdict and calls `project.issues.close(issueNumber)`. Its `close_issue` node type must be added to `NodeType` and `PRODUCIBLE_OUTCOMES` (`["success", "failed"]`) in `libs/assembly-lines/src/assembly-line-schema.ts`. Test: `apps/stations/src/work/close-issue/close-issue.test.ts` (comments with verdict then closes).

#### `human-gate` human-station type and handler fix

`issue_label` is a new human-station type added to `HUMAN_STATION_TYPES` in `libs/assembly-lines/src/human-station.ts`. Its `route` is `{args.issue_url}` — the GitHub issue page where a maintainer acts. A manifest in `apps/stations/` registers it as a service station so the pooled stations service can park and resume it.

Handler fix in `apps/floor/src/events/handlers/github.ts`: before the `alreadyWorkingOnIssue` guard runs, check whether a `lore:implementation` label event is arriving on an issue whose `issue-triage` run is currently parked at `human-gate`. If so: call `reportToParkedNode(run, "success")` via the existing `RUN_RESUME_EVENT`, end the triage task, then fall through to dispatch the implementation task. Without this fix the parked triage task makes the handler answer "Already being worked on" and the handoff is lost. Test: `apps/floor/src/events/handlers/github.test.ts` (lore:implementation on a parked triage run resumes before alreadyWorkingOnIssue fires; separate path for a non-triage issue still deduplicates correctly).

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
- `libs/assembly-lines/src/assembly-line-schema.ts` — `NodeType`, `EdgeCondition`, `PRODUCIBLE_OUTCOMES`, `NodeSchema` (`outcomes` field)
- `libs/assembly-lines/src/transition.ts` — `selectEdge` custom-outcome routing
- `libs/assembly-lines/src/node-outcome.ts` — `stationNodeOutcome` / `parseNodeResult` custom-outcome parse
- `libs/assembly-lines/src/human-station.ts` — `issue_label` human-station type
- `libs/assembly-lines/src/loader.test.ts` — bundled-lines list
- `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` — the line definition
- `libs/shared/src/agent-defaults/triage-reproduce.md` — reproduce recipe
- `libs/shared/src/agent-defaults/triage-diagnose.md` — diagnose recipe
- `libs/shared/src/agent-defaults/triage-verify.md` — verify recipe
- `libs/shared/src/domain/models/pipeline-task.ts` — `TaskTypeSchema`
- `libs/shared/src/domain/pipeline-task-trust.ts` — `TRUST_LEVELS`
- `libs/shared/src/domain/task-types/dispatch-labels.ts` — label → task-type map
- `apps/floor/src/work/task/dispatch-agent-cr.ts` — `assemblyLineFor`
- `apps/floor/src/events/handlers/github.ts` — label dispatch + human-gate resume
- `apps/stations/src/work/triage-label/` — `triage_label` service station
- `apps/stations/src/work/close-issue/` — `close_issue` service station
- `specs/github-issue-dispatch/spec.md` — promote planned dispatch entries
