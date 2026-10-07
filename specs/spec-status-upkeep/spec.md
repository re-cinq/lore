# Feature Specification: Automatic Spec Status Upkeep

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Automatic Spec Status Upkeep                  |
| Branch   | (unassigned)                                  |
| Status   | In Progress                                   |
| Created  | 2026-07-14                                    |
| Owner    | Platform Engineering                          |

Automatic Spec Status Upkeep keeps each spec's and ADR's `| Status |` header honest by deriving it from the doc's own test-link coverage and enforcing the result in CI, closing the loop that convention alone leaves to rot.

## Problem Statement

The `| Status |` header row in each `specs/<name>/spec.md` is the only
record of whether a feature shipped, and nothing maintains it. A manual
audit (2026-07-14) found 20 of 22 Draft/In-Progress specs were actually
implemented and live — some stale for months. The header is now surfaced
as a status pill in the web-ui spec lists, which makes staleness visible
but not self-correcting.

The repo CLAUDE.md and the shipped agent prompts (`libs/shared/src/agent-defaults/`)
instruct authors to update the header in the same branch that completes a spec.
The lint rule enforces that convention in CI; the proposed weekly detector below
would catch stale statuses outside the normal review path.

## The status ladder

Status is not a free-text claim — it is a function of the doc's own inline
`([validated by](test.ts#Lline))` links, the same links `require-statement-links`
and the web-ui coverage bar read:

| Testable statements linked | Status  |
|----------------------------|---------|
| none                       | Draft   |
| some                       | In Progress |
| all                        | Shipped |

- Derive a doc's entitled status from its test-link coverage: no linked testable statement yields draft, a partial set yields in-progress, and a complete set yields shipped. ([validated by `spec-status-coverage.test.ts:103`](libs/shared/src/work/spec-status-coverage.test.ts#L143), [`spec-status-coverage.test.ts:107`](libs/shared/src/work/spec-status-coverage.test.ts#L147), [`spec-status-coverage.test.ts:111`](libs/shared/src/work/spec-status-coverage.test.ts#L151), [`spec-status-coverage.test.ts:115`](libs/shared/src/work/spec-status-coverage.test.ts#L155), [`spec-status-coverage.test.ts:121`](libs/shared/src/work/spec-status-coverage.test.ts#L161))
- Tally a doc's testable statements against those carrying a test link in one walk, counting an unlinked, a partially linked and a fully linked doc alike. ([validated by `spec-status-coverage.test.ts:50`](libs/shared/src/work/spec-status-coverage.test.ts#L50), [`spec-status-coverage.test.ts:61`](libs/shared/src/work/spec-status-coverage.test.ts#L62), [`spec-status-coverage.test.ts:71`](libs/shared/src/work/spec-status-coverage.test.ts#L73))
- Expose the unlinked statements and the line each starts on from that same walk, so `require-statement-links` and the status ladder can never disagree about what is linked. ([validated by `spec-status-coverage.test.ts:89`](libs/shared/src/work/spec-status-coverage.test.ts#L129), [`spec-status-coverage.test.ts:95`](libs/shared/src/work/spec-status-coverage.test.ts#L135))
- Count a statement as linked only when one of its links passes the caller's grounding check, and report a statement whose links all failed it as ungrounded as well as unlinked, so the status rule can say a link is hollow rather than missing. ([validated by counts the statement linked at L99 as unlinked and ungrounded when the predicate accepts only L10](libs/shared/src/work/spec-status-coverage.test.ts#L91), [validated by leaves a statement with no link unlinked but not ungrounded](libs/shared/src/work/spec-status-coverage.test.ts#L119))
- Count a statement as testable only when the shared section heuristic says so, so intro, vision, background, rationale, open-question and limitation prose never drags a status down. ([validated by `spec-status-coverage.test.ts:79`](libs/shared/src/work/spec-status-coverage.test.ts#L82))
- Derive no status at all for a doc with no testable statement, leaving it alone rather than forcing it to draft. ([validated by `spec-status-coverage.test.ts:127`](libs/shared/src/work/spec-status-coverage.test.ts#L167), [`spec-status-coverage.test.ts:169`](libs/shared/src/work/spec-status-coverage.test.ts#L209))
- Exempt the terminal statuses — `rejected` (never accepted) and `retired` (shipped, then superseded) — from the ladder entirely, since no coverage reading should reopen a closed decision. Asking for a terminal status's label is a caller bug and fails loudly. ([validated by `spec-status-coverage.test.ts:145`](libs/shared/src/work/spec-status-coverage.test.ts#L185))
- Render the derived status in each corpus's own surface form: Title Case in a spec's table cell, lowercase in an ADR's frontmatter. ([validated by `spec-status-coverage.test.ts:133`](libs/shared/src/work/spec-status-coverage.test.ts#L173), [`spec-status-coverage.test.ts:139`](libs/shared/src/work/spec-status-coverage.test.ts#L179))
- Resolve a doc straight to the label its coverage entitles it to, so a caller reconciling a status never re-implements the ladder. ([validated by `spec-status-coverage.test.ts:153`](libs/shared/src/work/spec-status-coverage.test.ts#L193), [`spec-status-coverage.test.ts:157`](libs/shared/src/work/spec-status-coverage.test.ts#L197), [`spec-status-coverage.test.ts:163`](libs/shared/src/work/spec-status-coverage.test.ts#L203))

Specs and ADRs ride the same ladder. `libs/shared/src/work/spec-status-coverage.ts`
is the single source for the linter (FR1), so the status row is enforced in the
same pull request that changes the statements or their links.

## FR1 — `re-lint/require-status-matches-coverage` (CI enforcement)

The `re-lint/require-status-matches-coverage`
ESLint rule enforces the status ladder at review time, over `specs/**/spec.md` + `adrs/**/*.md`
(the repo's markdown-language config block), at `error`:

- Report a doc whose declared status disagrees with the status its test-link coverage entitles it to claim, naming both the coverage tally and the label to write. ([validated by `status-coverage.test.mjs:104`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L104), [`status-coverage.test.mjs:115`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L115), [`status-coverage.test.mjs:126`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L126), [`status-coverage.test.mjs:137`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L137), [`status-coverage.test.mjs:177`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L177))
- Stay silent when the declared status already matches coverage. ([validated by `status-coverage.test.mjs:89`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L89), [`status-coverage.test.mjs:93`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L93), [`status-coverage.test.mjs:100`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L100), [`status-coverage.test.mjs:188`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L188))
- Report a doc that declares no status the parsers can read — an absent row, or a value outside the known vocabulary — since an unreadable status silently renders no pill and hides from every sweep. ([validated by `status-coverage.test.mjs:163`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L163), [`status-coverage.test.mjs:170`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L170), [`status-coverage.test.mjs:200`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L200))
- Anchor each report on the line a human has to edit — the spec's status row or the ADR's frontmatter key — falling back to line 1 when the doc declares none. ([validated by `status-coverage.test.mjs:104`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L104), [`status-coverage.test.mjs:163`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L163), [`status-coverage.test.mjs:170`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L170), [`status-coverage.test.mjs:177`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L177))
- Skip terminal docs and docs with no testable statement, matching the ladder. ([validated by `status-coverage.test.mjs:151`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L151), [`status-coverage.test.mjs:155`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L155), [`status-coverage.test.mjs:159`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L159), [`status-coverage.test.mjs:196`](https://github.com/re-cinq/re-lint/blob/v1.0.0/src/rules/lib/status-coverage.test.mjs#L196))
- Apply only to `specs/` and `adrs/`, leaving every other markdown file alone.

The rule carries no autofix and no suggestion, deliberately: the `format` CI job
runs `eslint --fix` and commits the result back, so a fixer would silently
rewrite spec statuses across the repo on every PR. The message names the label;
a human writes it.

### Adoption

Adopting FR1 at `error` required reconciling the whole corpus in the same change
— 132 of 138 in-scope docs disagreed with their coverage, because status had
never been answerable to anything. That reconciliation demoted 27 shipped ADRs
and 42 shipped specs, taking the corpus from 47 Shipped specs to 1. This is the
intended consequence of making the ladder authoritative: the previous numbers
described intent, not validation. `Shipped` is now a high bar reachable only by
fully-linked docs, and the expected path back up is adding links (via
`/lore-suggest-links` or `spec-coverage-backfill`), not editing the row.

## FR2 — Status-staleness detector (proposed follow-up)

Human-driven and interactive work bypasses the normal review path, so a weekly
safety net would catch what the convention misses. This detector is not implemented.

- For each spec whose parsed status is `draft` or `in-progress`, gather
  implementation evidence: inline `([validated by ...])` links resolving to real
  tests and files/routes the spec names existing on the default branch.
- Evidence above threshold → open an issue naming the evidence.
- Zero findings is the healthy steady state; the detector would keep a stale
  header from surviving longer than one week.

## Out of Scope

- Rewriting historical statuses beyond the header row (amendment
  sections stay human-authored).
- Inferring `Rejected` — abandonment is a human judgement. `rejected` and
  `retired` are outside the ladder in both directions: the linter skips them.
- The six vestigial `## Status` MADR sections whose prose contradicts their own
  frontmatter (ADR-007/008/009/010 say `Accepted`, ADR-011 `Superseded`). Nothing
  reads them; the corpus reconciliation widens the contradiction and a follow-up
  sweep should delete them.

## Verification

- FR1: `npx eslint specs adrs` reports zero errors on a reconciled corpus;
  editing any status row away from its coverage tier reproduces exactly one
  error, anchored on that row.
- FR2 (when implemented): seeding a repo with an implemented-but-Draft spec
  yields one detector finding; a repo with honest headers yields zero.
