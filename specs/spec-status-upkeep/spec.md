# Feature Specification: Automatic Spec Status Upkeep

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Automatic Spec Status Upkeep                  |
| Branch   | (unassigned)                                  |
| Status   | Draft                                         |
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

## FR1 — Deterministic flip on feature completion (pipeline-driven work)

When the last task in a feature's task group merges, the Floor already
detects completion (it writes the group-summary episode). At that same
hook, when the group is linked to a spec path (feature-planning rows and
spec-tasks both know theirs):

- Open a one-line follow-up PR flipping the spec's `| Status |` row to
  `Implemented`, using the same PR-opening plumbing as
  `spec-coverage-backfill` (`proposeLinkInsertions` sibling).
- No LLM call — the edit is a deterministic single-row rewrite.
- Under dark-factory auto-merge rules the PR is eligible to land itself
  (docs-only path, one file).
- The `lore.features.status` transition to `implemented` and the spec
  header flip happen from the same event, so table and file never
  diverge.

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
