# Implementation Plan: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line |
| ------- | -------------------------- |
| Branch  | feat/issue-triage          |
| Spec    | [spec.md](./spec.md)       |
| Created | 2026-09-28                 |

This feature introduces a new `issue-triage` assembly line that processes incoming GitHub issues through reproduce, diagnose, and verify stages. It runs untrusted reproduction code in sandboxed pods, maintains state via GitHub labels, and requires human approval before handing off to the implementation loop.

## Technical Context

| Aspect               | Value                                             |
| -------------------- | ------------------------------------------------- |
| Language/Runtime     | TypeScript ESM / Node 22                          |
| Modules touched      | `apps/floor`, `libs/assembly-lines`               |
| Storage              | `pipeline.events`, `pipeline.station_runs`        |
| Testing              | vitest via workspace-source aliases               |
| Constraints          | DB-as-state immutability, Sandboxed execution     |

## Constitution Check

| Principle               | Verdict | Note |
| ----------------------- | ------- | ---- |
| Use the Ubiquitous Lang | PASS    | Uses existing task queue and pipeline.events |
| DB as State             | PASS    | Nodes write to `pipeline.station_runs` |

## Mechanisms

### Trigger wiring

The existing GitHub webhook ingress in `apps/floor/src/events/handlers/github.ts` (listening for `github.issues.labeled`) maps `triage: needs-triage` and `lore:triage` labels to the `issue-triage` task type. A scheduled cron backstop can pick up older issues for batch processing.

### Data model

Uses existing `pipeline.events` and `pipeline.station_runs` tables. The assembly run is tracked via `assembly_line_id` with `(assembly_line_id, node_id, iteration)` unique constraints.

### Assembly-line graph

Defined in `libs/assembly-lines/src/assembly-lines/issue-triage.yaml`. Nodes include `reproduce` (sandboxed), `diagnose`, `verify`, `close-obsolete`, and `decompose`. The graph uses standard node edges with failure handling.

### Gating

Handoff to implementation is strictly human-gated. Maintainers must review the diagnosis and manually transition the issue (e.g. applying priority labels or `lore:implementation`) rather than automatic progression.

### State/label taxonomy

- `triage: needs-triage`: Trigger for triage line.
- `triage: needs-reproduction`: Requires more info.
- `triage: reproduced`: Bug confirmed.
- `triage: unable-to-reproduce`: Bug not confirmed.
- `triage: diagnosed`: Root cause identified.
- `triage: skipped`: Skipped due to CI limits.
- `triage: not-actionable`: Noise.
- `triage: failed`: Pipeline failure.

## Failure Edges & Rollback

A failure in the pipeline transitions the issue to `triage: failed`. It can be retried up to 3 times (per KPIs). If it continually fails, it requires human intervention. Rollback is accomplished by removing the label mapping from the webhook handler.

## Project Structure

```text
specs/issue-triage/
├── spec.md
├── plan.md
└── tasks.md
```
`libs/assembly-lines/src/assembly-lines/issue-triage.yaml`
`apps/floor/src/events/handlers/github.ts`
