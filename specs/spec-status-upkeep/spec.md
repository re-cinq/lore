# Feature Specification: Automatic Spec Status Upkeep

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Automatic Spec Status Upkeep                  |
| Branch   | (unassigned)                                  |
| Status   | In Progress                                   |
| Created  | 2026-07-14                                    |
| Owner    | Platform Engineering                          |

Automatic Spec Status Upkeep keeps each spec's `| Status |` header honest by deterministically flipping it to Implemented when a feature's task group merges and by running a weekly staleness detector that flags implemented-but-Draft specs, closing the loop that convention alone leaves to rot.

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

- For each spec whose parsed status is `draft` or `in-progress`
  (`apps/web-ui/src/lib/spec-status.ts` normalization, hoisted to
  shared), gather implementation evidence: all linked pipeline tasks
  merged; inline `([validated by ...])` links resolving to real tests;
  files/routes the spec names existing on the default branch.
- Evidence above threshold → open an issue (or, at high confidence, a
  status-flip PR like FR1) naming the evidence.
- Zero findings is the healthy steady state; the detector exists so a
  stale header survives at most one week, not one quarter.

## Out of Scope

- Rewriting historical statuses beyond the header row (amendment
  sections stay human-authored).
- Inferring `Rejected` — abandonment is a human judgement.

## Verification

- FR1: merging the final task of a planned feature produces the status
  PR within one watcher cycle; the PR touches exactly one line.
- FR2: seeding a repo with an implemented-but-Draft spec yields one
  detector finding; a repo with honest headers yields zero.
