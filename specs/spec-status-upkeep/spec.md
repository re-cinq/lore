# Feature Specification: Automatic Spec Status Upkeep

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Automatic Spec Status Upkeep                  |
| Branch   | (unassigned)                                  |
| Status   | Implemented                                   |
| Created  | 2026-07-14                                    |
| Owner    | Platform Engineering                          |

## Problem Statement

The `| Status |` header row in each `specs/<name>/spec.md` is the only
record of whether a feature shipped, and nothing maintains it. A manual
audit (2026-07-14) found 20 of 22 Draft/In-Progress specs were actually
implemented and live — some stale for months. The header is now surfaced
as a status pill in the web-ui spec lists, which makes staleness visible
but not self-correcting.

Two convention layers already exist (shipped alongside this draft): the
repo CLAUDE.md instructs sessions to flip the header in the same branch
that completes a spec, and the `implementation` task prompt in
`scripts/task-types.yaml` carries the same rule. Conventions rot without
enforcement; the two mechanisms below close the loop.

The canonical status vocabulary these mechanisms read and write — the five
buckets, `Retired` vs `Rejected`, and the single-source rule — is recorded
in [ADR-037](../../adrs/ADR-037-spec-status-vocabulary-and-upkeep.md).

## FR1 — Deterministic flip on feature completion (pipeline-driven work)

When the last spec-task in a feature's task group merges, the Floor's
merge-check detects group completion — no sibling in the `task_group_id`
is still unmerged — and, when the group resolves to a feature + spec path
(feature-planning rows and spec-tasks both carry it):

- Detect that this merge completes the group, then resolve the owning feature before acting. ([validated by `task-queue.test.ts:600`](libs/shared/src/project/tasks/task-queue.test.ts#L600), [`task-queue.test.ts:609`](libs/shared/src/project/tasks/task-queue.test.ts#L609), [`task-queue.test.ts:615`](libs/shared/src/project/tasks/task-queue.test.ts#L615), [`spec-status-flip.test.ts:14`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L14), [`spec-status-flip.test.ts:18`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L18), [`spec-status-flip.test.ts:22`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L22), [`spec-status-flip.test.ts:26`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L26), [`spec-status-flip.test.ts:30`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L30))
- Open a one-line follow-up PR flipping the spec's `| Status |` row to `Implemented` using the same PR-opening plumbing as `spec-coverage-backfill`, skipping when the spec is already shipped/retired, missing, or has no status row. ([validated by `spec-status-flip.test.ts:61`](libs/shared/src/spec-status-flip.test.ts#L61), [`spec-status-flip.test.ts:90`](libs/shared/src/spec-status-flip.test.ts#L90), [`spec-status-flip.test.ts:106`](libs/shared/src/spec-status-flip.test.ts#L106), [`spec-status-flip.test.ts:115`](libs/shared/src/spec-status-flip.test.ts#L115))
- No LLM call — the edit is a deterministic single-row rewrite.
- The PR is opened for human review. Dark-factory auto-merge is task-bound, so a hook-opened flip PR (docs-only path, one file) is not auto-merged in this iteration.
- The `lore.features.status` transition to `implemented` fires only when the flip succeeded or the spec is already current, so the features table and the spec file never diverge.

## FR2 — Status-staleness detector (everything else)

Human-driven and interactive work bypasses the pipeline, so a weekly
safety net catches what FR1 and convention miss. Add a
`status-staleness` detect assembly line to the existing detect family
(`spec_drift`, `gap_detect` pattern: `cron.<job>.tick` → one repo-less
per-repo line, deterministic detect node):

- For each spec whose parsed status is `draft` or `in-progress` (the shared
  `parseDocStatus` normalization), gather implementation evidence: linked
  pipeline tasks all merged; inline `([validated by ...])` links resolving to
  real tests; paths the spec names existing in the repo's indexed code. ([validated by `status-staleness.test.ts:65`](libs/shared/src/detect/status-staleness.test.ts#L65), [`status-staleness.test.ts:74`](libs/shared/src/detect/status-staleness.test.ts#L74), [`status-staleness.test.ts:82`](libs/shared/src/detect/status-staleness.test.ts#L82), [`status-staleness.test.ts:97`](libs/shared/src/detect/status-staleness.test.ts#L97), [`status-staleness.test.ts:33`](libs/shared/src/detect/status-staleness.test.ts#L33), [`status-staleness.test.ts:44`](libs/shared/src/detect/status-staleness.test.ts#L44), [`status-staleness.test.ts:52`](libs/shared/src/detect/status-staleness.test.ts#L52), [`status-staleness.test.ts:329`](libs/shared/src/detect/status-staleness.test.ts#L329), [`status-staleness.test.ts:263`](libs/shared/src/detect/status-staleness.test.ts#L263))
- Evidence above threshold — any one signal firing — opens one aggregated issue
  per repo naming every spec and the evidence behind it, deduped against an
  already-open one. ([validated by `status-staleness.test.ts:112`](libs/shared/src/detect/status-staleness.test.ts#L112), [`status-staleness.test.ts:118`](libs/shared/src/detect/status-staleness.test.ts#L118), [`status-staleness.test.ts:130`](libs/shared/src/detect/status-staleness.test.ts#L130), [`status-staleness.test.ts:148`](libs/shared/src/detect/status-staleness.test.ts#L148), [`status-staleness.test.ts:171`](libs/shared/src/detect/status-staleness.test.ts#L171), [`status-staleness.test.ts:175`](libs/shared/src/detect/status-staleness.test.ts#L175), [`status-staleness.test.ts:184`](libs/shared/src/detect/status-staleness.test.ts#L184), [`status-staleness.test.ts:197`](libs/shared/src/detect/status-staleness.test.ts#L197), [`status-staleness.test.ts:205`](libs/shared/src/detect/status-staleness.test.ts#L205), [`status-staleness.test.ts:272`](libs/shared/src/detect/status-staleness.test.ts#L272), [`status-staleness.test.ts:347`](libs/shared/src/detect/status-staleness.test.ts#L347), [`status-staleness.test.ts:366`](libs/shared/src/detect/status-staleness.test.ts#L366))
- The line joins the detect family as a two-node `detect → done` definition whose
  node the station dispatches by `job_ref`. ([validated by `loader.test.ts:322`](libs/assembly-lines/src/loader.test.ts#L322), [`stations.test.ts:90`](apps/lore-station/src/stations/stations.test.ts#L90))
- A spec whose draft/in-progress header is honest yields no finding — zero is the
  healthy steady state; the detector exists so a stale header survives at most one
  week, not one quarter. ([validated by `status-staleness.test.ts:108`](libs/shared/src/detect/status-staleness.test.ts#L108), [`status-staleness.test.ts:124`](libs/shared/src/detect/status-staleness.test.ts#L124), [`status-staleness.test.ts:136`](libs/shared/src/detect/status-staleness.test.ts#L136), [`status-staleness.test.ts:142`](libs/shared/src/detect/status-staleness.test.ts#L142), [`status-staleness.test.ts:298`](libs/shared/src/detect/status-staleness.test.ts#L298))
- It files an issue rather than a status-flip PR: the detect node runs in a station
  pod, which has no `project.repo.read` to read the spec off the default branch,
  and a weekly PR-opener would stack duplicates while an unmerged flip PR leaves
  the branch reading `Draft` (ADR-037).
- No LLM — every signal is a deterministic read of chunks and task rows.

## Out of Scope

- Rewriting historical statuses beyond the header row (amendment
  sections stay human-authored).
- Inferring `Rejected` — abandonment is a human judgement.

## Verification

- FR1: merging the final task of a planned feature produces the status
  PR within one watcher cycle; the PR touches exactly one line.
- FR2: seeding a repo with an implemented-but-Draft spec yields one
  detector finding; a repo with honest headers yields zero.
