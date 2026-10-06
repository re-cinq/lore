# Implementation Plan: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Branch  | issue-triage                           |
| Spec    | [spec.md](./spec.md)                   |
| Created | 2026-09-28                             |

This plan details the implementation of a new `issue-triage` assembly line on the external floor, driven by GitHub label events, that automatically reproduces bugs in isolated pods, diagnoses root causes, and verifies them against specs before handing off to maintainers.

## Technical Context

| Aspect               | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Language/Runtime     | TypeScript ESM / Node 22                                        |
| Modules touched      | `apps/stations`, `libs/assembly-lines`, `libs/shared`           |
| Storage              | `pipeline.station_runs`, `pipeline.events`                      |
| Testing              | vitest via workspace-source aliases                             |
| Constraints          | Strict sandboxing for untrusted code execution                  |

## Constitution Check

| Principle     | Verdict          | Note                        |
| ------------- | ---------------- | --------------------------- |
| Simple Design | PASS             | Reuses the external floor, existing pipeline event bus, and Dedicated Agent Pod architecture; no new engine introduced. |

## Mechanisms

### Trigger wiring

The trigger relies on the existing `github.issues.labeled` webhook ingress. The stations drain handler `issueLabeled` in `apps/stations/src/events/repo-handlers.ts` currently calls `dispatchLabeledIssue` (from `libs/shared/src/work/backlog/label-dispatch.ts`) which handles the `lore` label for implementation dispatch. This handler is extended to also detect `lore:triage` and `triage: needs-triage` labels, and when either matches, calls `floorClient().lines.start('issue-triage', {repo, issue_url, issue_number})` via `libs/shared/src/outbound/floor/floor-client.ts`.

### Batch processing

Batch dispatch for the triage line follows the same pattern as `apps/stations/src/work/loop-tick/` (the implementation loop's tick). A new cron-tick sweep `apps/stations/src/work/issue-triage-tick/` is declared as a stations sweep triggered by a `cron.issue_triage.tick` event emitted by `libs/shared/src/work/scheduler/cron-emitters.ts`. On each tick the sweep queries for the oldest `triage: needs-triage`-labelled issues up to a per-repo concurrency cap and calls `floor.lines.start` for each one without shared context between runs. Older issues (by `created_at`) are processed first.

### Assembly-line graph

The line lives at `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` in the three-block floor format (`line`, `stations`, `agent_definitions`). lore-api seeds it at boot via `apps/lore-api/src/work/floor/seed-floor-pipelines.ts`, keying on the file's content as its version. The line's name is added to the pinned list in `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` ("declare the lines…"); CI fails if absent or if any agent definition has an empty prompt.

**Nodes and their stations:**

- `reproduce` — `kind: agent`, agent definition `triage-reproduce`, `timeout_minutes: 15`. Declares custom outcomes in the `stations` block: `[unable-to-reproduce, needs-reproduction, skipped]`. Runs in a Dedicated Agent Pod.
- `diagnose` — `kind: agent`, agent definition `triage-diagnose`, `timeout_minutes: 10`.
- `verify` — `kind: agent`, agent definition `triage-verify`, `timeout_minutes: 10`. Declares custom outcomes: `[obsolete, large-issue, not-actionable]`.
- `triage-label` — `kind: service`, station `triage-label`. Applied after each agent node to stamp the matching `triage:*` label on the issue.
- `close-obsolete` — `kind: service`, station `close-issue`. Posts verdict comment and closes the issue.
- `decompose` — `kind: agent`, agent definition `feature-decompose` (reuses existing contract). Splits the issue into smaller child issues.
- `human-gate` — `kind: human`, `route: '{args.issue_url}'`. Parks the run until a maintainer applies `lore:implementation`.
- `done` — the terminal exit node (a `retrospective`-equivalent; the floor itself uses `exit`).

**Edges:**

- `reproduce` (success) → `triage-label` → `diagnose`
- `reproduce` (unable-to-reproduce) → `triage-label` → `done`
- `reproduce` (needs-reproduction) → `triage-label` → `done`
- `reproduce` (skipped) → `triage-label` → `done`
- `reproduce` (failed, after 3 retries) → `triage-label` → `done`
- `diagnose` (success) → `triage-label` → `verify`
- `diagnose` (failed, after 3 retries) → `triage-label` → `done`
- `verify` (success) → `triage-label` → `human-gate`
- `verify` (obsolete) → `close-obsolete` → `done`
- `verify` (large-issue) → `decompose` → `done`
- `verify` (not-actionable) → `triage-label` → `done`
- `verify` (failed, after 3 retries) → `triage-label` → `done`
- `human-gate` (success) → `done`

Every declared outcome on `reproduce` and `verify` has a corresponding edge; the floor refuses a file that leaves an outcome with nowhere to go.

### Agent recipes

One `.md` file per agent definition in `libs/shared/src/agent-defaults/`:

- `triage-reproduce.md` — frontmatter: `model`, `timeout_minutes: 15`; body: clone the reproduction repository, run the provided steps, emit `LORE_NODE_RESULT: success` (reproduced), `LORE_NODE_RESULT: unable-to-reproduce`, `LORE_NODE_RESULT: needs-reproduction` (missing info), or `LORE_NODE_RESULT: skipped` (environment limits).
- `triage-diagnose.md` — frontmatter: `timeout_minutes: 10`; body: instrument and trace root cause, emit `LORE_NODE_RESULT: success` or `LORE_NODE_RESULT: failed`.
- `triage-verify.md` — frontmatter: `timeout_minutes: 10`; body: cross-reference diagnosis against specs and docs; reuse `feature-decompose` output contract for the large-issue path; emit `LORE_NODE_RESULT: success`, `LORE_NODE_RESULT: obsolete`, `LORE_NODE_RESULT: large-issue`, or `LORE_NODE_RESULT: not-actionable`.

`apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` fails CI for any agent definition with an empty prompt — the three recipes must be created before the YAML node can load.

### Custom node outcomes

On the external floor, custom outcomes are declared in the `stations` block of the pipeline YAML (the `outcomes:` field under each station entry). The floor's own loader validates that every declared outcome has an edge and routes `on: <outcome>` edges by exact string match. No Lore-side changes are needed.

### Label creation and `triage_label` service station

The eight `triage:*` labels must be created in each onboarded repository (as a one-time setup step) before any triage run reaches the labelling station.

`triage_label` is a new service station in `apps/stations/src/work/triage-label/`, written with `@re-cinq/floor-station`. It reads the node outcome and calls `project.issues.addLabel(issueNumber, triageLabelForOutcome(outcome))`. Its station type and outcomes (`["success", "failed"]`) are declared in the pipeline YAML's `stations` block — no `NodeType`/`PRODUCIBLE_OUTCOMES` change in `libs/assembly-lines/src/assembly-line-schema.ts`.

### `close-obsolete` service station

`close-issue` is a new service station in `apps/stations/src/work/close-issue/`, written with `@re-cinq/floor-station`. It posts a comment with the triage verdict and calls `project.issues.close(issueNumber)`. Its station type is declared in the pipeline YAML's `stations` block — no schema.ts change.

### `human-gate` and handler fix

`human-gate` is declared in the pipeline YAML's `stations` block as `kind: human` with `route: '{args.issue_url}'` — the GitHub issue page where a maintainer acts by applying `lore:implementation`.

Handler fix in `apps/stations/src/events/repo-handlers.ts`: before the `activeTaskByIssue` active-task check in `libs/shared/src/work/backlog/label-dispatch.ts` runs, check whether a `lore:implementation` label event is arriving on an issue whose `issue-triage` run is currently parked at `human-gate`. If so: call `reportToVisit` via `libs/shared/src/outbound/floor/floor-report.ts` to report success to the parked visit, end the triage run, then fall through to dispatch the implementation task. Without this fix, the parked triage task makes the handler answer "Already being worked on" and the handoff is lost.

## Failure Edges & Rollback

- If `reproduce` fails to reproduce the issue, it transitions to `triage: unable-to-reproduce` and the line terminates.
- If a node encounters a system failure, it retries up to 3 times before transitioning to `triage: failed` and terminating.
- The feature can be rolled back by removing `lore:triage` and `triage: needs-triage` from the label dispatch mapping in `apps/stations/src/events/repo-handlers.ts`.

## Project Structure

```text
specs/issue-triage/
├── spec.md
├── plan.md
└── tasks.md
```

Files touched:

- `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` — the floor pipeline definition
- `libs/shared/src/agent-defaults/triage-reproduce.md` — reproduce recipe
- `libs/shared/src/agent-defaults/triage-diagnose.md` — diagnose recipe
- `libs/shared/src/agent-defaults/triage-verify.md` — verify recipe
- `libs/shared/src/work/scheduler/cron-emitters.ts` — cron tick emitter for triage
- `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` — bundled-lines list
- `apps/stations/src/events/repo-handlers.ts` — label dispatch + human-gate resume
- `apps/stations/src/work/issue-triage-tick/` — cron-tick batch fan-out sweep
- `apps/stations/src/work/triage-label/` — `triage_label` service station
- `apps/stations/src/work/close-issue/` — `close_issue` service station
- `specs/github-issue-dispatch/spec.md` — promote planned dispatch entries
