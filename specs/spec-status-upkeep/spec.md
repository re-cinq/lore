# Feature Specification: Automatic Spec Status Upkeep

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Automatic Spec Status Upkeep                  |
| Branch   | (unassigned)                                  |
| Status   | In Progress                                   |
| Created  | 2026-07-14                                    |
| Owner    | Platform Engineering                          |

Automatic Spec Status Upkeep keeps each spec's and ADR's `| Status |` header honest by deriving it from the doc's own test-link coverage — enforced in CI by a linter, reconciled by a deterministic PR when a feature's task group merges, and swept by a weekly staleness detector — closing the loop that convention alone leaves to rot.

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
enforcement; the three mechanisms below close the loop.

## The status ladder

Status is not a free-text claim — it is a function of the doc's own inline
`([validated by](test.ts#Lline))` links, the same links `require-statement-links`
and the web-ui coverage bar read:

| Testable statements linked | Status  |
|----------------------------|---------|
| none                       | Draft   |
| some                       | In Progress |
| all                        | Shipped |

- Derive a doc's entitled status from its test-link coverage: no linked testable statement yields draft, a partial set yields in-progress, and a complete set yields shipped. ([validated by `spec-status-coverage.test.ts:106`](libs/shared/src/spec-status-coverage.test.ts#L106), [`spec-status-coverage.test.ts:110`](libs/shared/src/spec-status-coverage.test.ts#L110), [`spec-status-coverage.test.ts:114`](libs/shared/src/spec-status-coverage.test.ts#L114), [`spec-status-coverage.test.ts:118`](libs/shared/src/spec-status-coverage.test.ts#L118), [`spec-status-coverage.test.ts:124`](libs/shared/src/spec-status-coverage.test.ts#L124))
- Tally a doc's testable statements against those carrying a test link in one walk, counting an unlinked, a partially linked and a fully linked doc alike. ([validated by `spec-status-coverage.test.ts:53`](libs/shared/src/spec-status-coverage.test.ts#L53), [`spec-status-coverage.test.ts:64`](libs/shared/src/spec-status-coverage.test.ts#L64), [`spec-status-coverage.test.ts:74`](libs/shared/src/spec-status-coverage.test.ts#L74))
- Expose the unlinked statements and the line each starts on from that same walk, so `require-statement-links` and the status ladder can never disagree about what is linked. ([validated by `spec-status-coverage.test.ts:92`](libs/shared/src/spec-status-coverage.test.ts#L92), [`spec-status-coverage.test.ts:98`](libs/shared/src/spec-status-coverage.test.ts#L98))
- Count a statement as testable only when the shared section heuristic says so, so intro, vision, background, rationale, open-question and limitation prose never drags a status down. ([validated by `spec-status-coverage.test.ts:82`](libs/shared/src/spec-status-coverage.test.ts#L82))
- Derive no status at all for a doc with no testable statement, leaving it alone rather than forcing it to draft. ([validated by `spec-status-coverage.test.ts:130`](libs/shared/src/spec-status-coverage.test.ts#L130), [`spec-status-coverage.test.ts:172`](libs/shared/src/spec-status-coverage.test.ts#L172))
- Exempt the terminal statuses — `rejected` (never accepted) and `retired` (shipped, then superseded) — from the ladder entirely, since no coverage reading should reopen a closed decision. Asking for a terminal status's label is a caller bug and fails loudly. ([validated by `spec-status-coverage.test.ts:148`](libs/shared/src/spec-status-coverage.test.ts#L148))
- Render the derived status in each corpus's own surface form: Title Case in a spec's table cell, lowercase in an ADR's frontmatter. ([validated by `spec-status-coverage.test.ts:136`](libs/shared/src/spec-status-coverage.test.ts#L136), [`spec-status-coverage.test.ts:142`](libs/shared/src/spec-status-coverage.test.ts#L142))
- Resolve a doc straight to the label its coverage entitles it to, so a caller reconciling a status never re-implements the ladder. ([validated by `spec-status-coverage.test.ts:156`](libs/shared/src/spec-status-coverage.test.ts#L156), [`spec-status-coverage.test.ts:160`](libs/shared/src/spec-status-coverage.test.ts#L160), [`spec-status-coverage.test.ts:166`](libs/shared/src/spec-status-coverage.test.ts#L166))

Specs and ADRs ride the same ladder. `libs/shared/src/spec-status-coverage.ts`
is the single source both the linter (FR3) and the reconciling PR (FR1) read, so
the rule that reports a violation and the automation that fixes it can never
disagree.

## FR1 — Deterministic flip on feature completion (pipeline-driven work)

When the last spec-task in a feature's task group merges, the Floor's
merge-check detects group completion — no sibling in the `task_group_id`
is still unmerged — and, when the group resolves to a feature + spec path
(feature-planning rows and spec-tasks both carry it):

- Detect that this merge completes the group, then resolve the owning feature before acting. ([validated by `task-queue.test.ts:583`](libs/shared/src/project/tasks/task-queue.test.ts#L583), [`task-queue.test.ts:592`](libs/shared/src/project/tasks/task-queue.test.ts#L592), [`task-queue.test.ts:598`](libs/shared/src/project/tasks/task-queue.test.ts#L598), [`spec-status-flip.test.ts:17`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L17), [`spec-status-flip.test.ts:21`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L21), [`spec-status-flip.test.ts:25`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L25), [`spec-status-flip.test.ts:29`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L29), [`spec-status-flip.test.ts:33`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L33))
- Open a one-line follow-up PR setting the spec's `| Status |` row to the status its test-link coverage entitles it to claim, using the same PR-opening plumbing as `spec-coverage-backfill`. ([validated by `spec-status-flip.test.ts:71`](libs/shared/src/spec-status-flip.test.ts#L71), [`spec-status-flip.test.ts:103`](libs/shared/src/spec-status-flip.test.ts#L103))
- Mark the spec `Shipped` only when every testable statement is linked; a partially-linked spec whose group has merged lands `In Progress` instead, because a merged task group is not evidence that the spec's statements are validated. ([validated by `spec-status-flip.test.ts:71`](libs/shared/src/spec-status-flip.test.ts#L71), [`spec-status-flip.test.ts:103`](libs/shared/src/spec-status-flip.test.ts#L103))
- Demote a `Shipped` spec back to `In Progress` when a statement has lost its link, so the reconciliation runs in both directions. ([validated by `spec-status-flip.test.ts:122`](libs/shared/src/spec-status-flip.test.ts#L122))
- Skip without opening a PR when the spec is missing, has no status row, is terminal (rejected/retired), has no testable statement to derive a status from, or already claims the status its coverage supports. ([validated by `spec-status-flip.test.ts:139`](libs/shared/src/spec-status-flip.test.ts#L139), [`spec-status-flip.test.ts:156`](libs/shared/src/spec-status-flip.test.ts#L156), [`spec-status-flip.test.ts:172`](libs/shared/src/spec-status-flip.test.ts#L172), [`spec-status-flip.test.ts:188`](libs/shared/src/spec-status-flip.test.ts#L188), [`spec-status-flip.test.ts:199`](libs/shared/src/spec-status-flip.test.ts#L199), [`spec-status-flip.test.ts:208`](libs/shared/src/spec-status-flip.test.ts#L208), [`spec-status-flip.test.ts:223`](libs/shared/src/spec-status-flip.test.ts#L223))
- Compare status buckets rather than labels when deciding whether a flip is needed, so the corpus's synonyms (`Implemented` / `Shipped` / `Complete`) keep the PR idempotent. ([validated by `spec-status-flip.test.ts:139`](libs/shared/src/spec-status-flip.test.ts#L139))
- No LLM call — the edit is a deterministic single-row rewrite.
- The PR is opened for human review. Dark-factory auto-merge is task-bound, so a hook-opened flip PR (docs-only path, one file) is not auto-merged in this iteration.
- Transition `lore.features.status` to `implemented` only when the spec ends up claiming `shipped` — freshly set or already current — so the features table and the spec file never diverge; every other outcome is left for a human to reconcile. ([validated by `spec-status-flip.test.ts:40`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L40), [`spec-status-flip.test.ts:50`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L50), [`spec-status-flip.test.ts:61`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L61), [`spec-status-flip.test.ts:71`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L71), [`spec-status-flip.test.ts:82`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L82), [`spec-status-flip.test.ts:93`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L93))

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

## FR3 — `lore/require-status-matches-coverage` (CI enforcement)

FR1 and FR2 are after-the-fact sweeps; neither stops a human from typing
`Shipped` into an unlinked spec. The `lore/require-status-matches-coverage`
ESLint rule closes that at review time, over `specs/**/spec.md` + `adrs/**/*.md`
(the repo's markdown-language config block), at `error`:

- Report a doc whose declared status disagrees with the status its test-link coverage entitles it to claim, naming both the coverage tally and the label to write. ([validated by `status-coverage.test.mjs:101`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L101), [`status-coverage.test.mjs:112`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L112), [`status-coverage.test.mjs:123`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L123), [`status-coverage.test.mjs:134`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L134), [`status-coverage.test.mjs:171`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L171))
- Stay silent when the declared status already matches coverage. ([validated by `status-coverage.test.mjs:89`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L89), [`status-coverage.test.mjs:93`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L93), [`status-coverage.test.mjs:97`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L97), [`status-coverage.test.mjs:182`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L182))
- Report a doc that declares no status the parsers can read — an absent row, or a value outside the known vocabulary — since an unreadable status silently renders no pill and hides from every sweep. ([validated by `status-coverage.test.mjs:157`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L157), [`status-coverage.test.mjs:164`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L164), [`status-coverage.test.mjs:194`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L194))
- Anchor each report on the line a human has to edit — the spec's status row or the ADR's frontmatter key — falling back to line 1 when the doc declares none. ([validated by `status-coverage.test.mjs:101`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L101), [`status-coverage.test.mjs:157`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L157), [`status-coverage.test.mjs:164`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L164), [`status-coverage.test.mjs:171`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L171))
- Skip terminal docs and docs with no testable statement, matching the ladder. ([validated by `status-coverage.test.mjs:145`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L145), [`status-coverage.test.mjs:149`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L149), [`status-coverage.test.mjs:153`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L153), [`status-coverage.test.mjs:190`](tools/eslint-plugin-lore/rules/lib/status-coverage.test.mjs#L190))
- Apply only to `specs/` and `adrs/`, leaving every other markdown file alone.

The rule carries no autofix and no suggestion, deliberately: the `format` CI job
runs `eslint --fix` and commits the result back, so a fixer would silently
rewrite spec statuses across the repo on every PR. The message names the label;
a human writes it.

### Adoption

Adopting FR3 at `error` required reconciling the whole corpus in the same change
— 132 of 138 in-scope docs disagreed with their coverage, because status had
never been answerable to anything. That reconciliation demoted 27 shipped ADRs
and 42 shipped specs, taking the corpus from 47 Shipped specs to 1. This is the
intended consequence of making the ladder authoritative: the previous numbers
described intent, not validation. `Shipped` is now a high bar reachable only by
fully-linked docs, and the expected path back up is adding links (via
`/lore-suggest-links` or `spec-coverage-backfill`), not editing the row.

## Out of Scope

- Rewriting historical statuses beyond the header row (amendment
  sections stay human-authored).
- Inferring `Rejected` — abandonment is a human judgement. `rejected` and
  `retired` are outside the ladder in both directions: the linter skips them and
  FR1 never reopens them.
- The six vestigial `## Status` MADR sections whose prose contradicts their own
  frontmatter (ADR-007/008/009/010 say `Accepted`, ADR-011 `Superseded`). Nothing
  reads them; the corpus reconciliation widens the contradiction and a follow-up
  sweep should delete them.

## Verification

- FR1: merging the final task of a planned feature produces the status
  PR within one watcher cycle; the PR touches exactly one line, and its
  label matches the spec's coverage rather than assuming completion.
- FR2: seeding a repo with an implemented-but-Draft spec yields one
  detector finding; a repo with honest headers yields zero.
- FR3: `npx eslint specs adrs` reports zero errors on a reconciled corpus;
  editing any status row away from its coverage tier reproduces exactly one
  error, anchored on that row.
