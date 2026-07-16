---
adr_number: 37
title: "Spec status: one canonical vocabulary, machine-maintained"
status: shipped
date: 2026-07-16
domains: [pipeline, agent]
---

# ADR-037: Spec status vocabulary and automatic upkeep

## Context

The `| Status |` header row in each `specs/<name>/spec.md` is the only record of
whether a feature shipped. Nothing maintained it. A manual audit (2026-07-14)
found **20 of 22** Draft/In-Progress specs were actually implemented and live,
some stale for months — the backlog the org reads off its own specs was mostly
fiction.

Two problems sat behind that number.

**The vocabulary was undocumented.** Authors wrote whatever they liked —
`Draft`, `WIP`, `In Review`, `Accepted`, `Superseded`, `Implemented — 2026-05-01`.
[28e6694b](https://github.com/re-cinq/lore/pull/836) normalized every spec and ADR
onto a fixed set and added `Retired`, but recorded no decision: no ADR mentioned
the buckets, and the rationale survived only as code comments. Meanwhile the
web-ui grew a status pill, which made staleness *visible* but not
*self-correcting*.

**Nothing enforced the vocabulary either.** The normalization lives in a regex
table in [spec-status.ts](../libs/shared/src/spec-status.ts), and `apps/web-ui`
carries a hand-mirrored copy — it is deliberately not an npm workspace member
(workspace + Docker isolation, ADR-036), so it cannot import the package. The two
were kept in step "by comment only", and had already drifted: shared bucketed
`proposed` as `in-progress`, web-ui did not, so a spec marked `Proposed` rendered
**no status pill at all**.

Conventions were tried first and rotted. The repo CLAUDE.md instructs sessions to
flip the header in the branch that completes a spec, and the `implementation` task
prompt in `scripts/task-types.yaml` carries the same rule. The audit is what those
conventions produced.

## Decision

**One canonical status vocabulary, held by a test, and maintained by machine
rather than by convention.**

### 1. Five buckets, normalized from free text

Free-text status values normalize into exactly five buckets
([spec-status.ts](../libs/shared/src/spec-status.ts)) via a regex synonym table.
A spec's status is read from its `| Status | <value> |` table row, an ADR's from
its YAML frontmatter `status:` key, and both feed the same buckets so the corpus
is treated uniformly. ([validated by `spec-status.test.ts:12`](libs/shared/src/spec-status.test.ts#L12), [`spec-status.test.ts:38`](libs/shared/src/spec-status.test.ts#L38), [`spec-status.test.ts:62`](libs/shared/src/spec-status.test.ts#L62), [`spec-status.test.ts:80`](libs/shared/src/spec-status.test.ts#L80), [`spec-status.test.ts:104`](libs/shared/src/spec-status.test.ts#L104))

Bold markers and trailing prose are stripped before bucketing, so
`**Draft**` and `Implemented — 2026-05-01` land in the same buckets as their bare
forms. ([validated by `spec-status.test.ts:30`](libs/shared/src/spec-status.test.ts#L30))

| Bucket | Synonyms | `require-statement-links` |
|---|---|---|
| `draft` | draft | warn |
| `in-progress` | in progress, in review, planning, wip, proposed | warn |
| `shipped` | shipped, implemented, complete, accepted, done, live | warn |
| `rejected` | rejected, abandoned | skip |
| `retired` | retired, superseded, removed, deprecated, obsolete | skip |

Two choices carry weight:

- **`Retired` is distinct from `Rejected`.** They mean opposite histories:
  `retired` shipped and was later superseded; `rejected` was never accepted.
  Collapsing them would erase the "was live" fact, which is exactly what a reader
  of an old spec needs to know. Both are terminal and both skip the lint rule,
  while every other bucket warns. ([validated by `spec-status.test.ts:50`](libs/shared/src/spec-status.test.ts#L50), [`spec-status.test.ts:56`](libs/shared/src/spec-status.test.ts#L56), [`spec-status.test.ts:92`](libs/shared/src/spec-status.test.ts#L92), [`spec-status.test.ts:98`](libs/shared/src/spec-status.test.ts#L98), [`spec-status.test.ts:118`](libs/shared/src/spec-status.test.ts#L118), [`spec-status.test.ts:123`](libs/shared/src/spec-status.test.ts#L123), [`spec-status.test.ts:127`](libs/shared/src/spec-status.test.ts#L127))
- **`accepted` folds into `shipped`**, since it is the ADR-native word for the
  same state — as do `implemented`, `complete`, `done` and `live`, and `proposed`
  folds into `in-progress`. ([validated by `spec-status.test.ts:18`](libs/shared/src/spec-status.test.ts#L18), [`spec-status.test.ts:44`](libs/shared/src/spec-status.test.ts#L44), [`spec-status.test.ts:86`](libs/shared/src/spec-status.test.ts#L86))

### 2. `libs/shared/src/spec-status.ts` is the single source; a parity test holds the mirror

Consumers import the shared module. `apps/web-ui` cannot (ADR-036 boundaries), so
it keeps a mirror plus its own UI-only concerns (pill color, sort order, display
label). The mirror is held in lockstep by a parity test that imports shared's pure
module **by relative file path — never the package**:

- Both implementations bucket every synonym in the vocabulary identically, including bold cells, trailing qualifiers, and values in no bucket at all. ([validated by `spec-status.parity.test.ts:50`](apps/web-ui/src/lib/spec-status.parity.test.ts#L50))
- Both report no status when the table carries no `Status` row. ([validated by `spec-status.parity.test.ts:60`](apps/web-ui/src/lib/spec-status.parity.test.ts#L60))

This follows the existing
[feature-types.parity.test.ts](../apps/web-ui/src/lib/feature-types.parity.test.ts)
precedent and ADR-036's philosophy: import boundaries are enforced by tests, not
by convention. A comment did not stop the `proposed` drift; the test does.

### 3. Statuses are maintained by machine, in two layers

Both layers are deterministic — **no LLM** — and both produce artifacts for human
review rather than acting unilaterally. Spec:
[specs/spec-status-upkeep/spec.md](../specs/spec-status-upkeep/spec.md).

**FR1 — deterministic flip on feature completion**
([spec-status-flip.ts](../libs/shared/src/spec-status-flip.ts),
[merge-check.ts](../apps/floor/src/jobs/merge/merge-check.ts)):

- The flip fires only when a merging spec-task leaves no unmerged sibling in its `task_group_id` and the group resolves to an owning feature. ([validated by `spec-status-flip.test.ts:14`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L14), [`spec-status-flip.test.ts:18`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L18), [`spec-status-flip.test.ts:22`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L22), [`spec-status-flip.test.ts:26`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L26), [`spec-status-flip.test.ts:30`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L30))
- It opens one PR carrying the upkeep labels, and skips silently when the spec is already Implemented, missing from the default branch, or has no status row. ([validated by `spec-status-flip.test.ts:61`](libs/shared/src/spec-status-flip.test.ts#L61), [`spec-status-flip.test.ts:90`](libs/shared/src/spec-status-flip.test.ts#L90), [`spec-status-flip.test.ts:106`](libs/shared/src/spec-status-flip.test.ts#L106), [`spec-status-flip.test.ts:115`](libs/shared/src/spec-status-flip.test.ts#L115))
- The edit is a single-cell rewrite that leaves every other line byte-for-byte intact, preserves CRLF, and is idempotent by content — an already-shipped or retired spec is never re-marked. ([validated by `spec-status.test.ts:150`](libs/shared/src/spec-status.test.ts#L150), [`spec-status.test.ts:164`](libs/shared/src/spec-status.test.ts#L164), [`spec-status.test.ts:170`](libs/shared/src/spec-status.test.ts#L170), [`spec-status.test.ts:176`](libs/shared/src/spec-status.test.ts#L176), [`spec-status.test.ts:181`](libs/shared/src/spec-status.test.ts#L181), [`spec-status.test.ts:187`](libs/shared/src/spec-status.test.ts#L187), [`spec-status.test.ts:196`](libs/shared/src/spec-status.test.ts#L196))

The `lore.features` row transitions to `implemented` only when the flip succeeded or
the spec was already current, so the table and the file never diverge.

**FR2 — weekly status-staleness detector**
([status-staleness.ts](../libs/shared/src/detect/status-staleness.ts)). FR1 only
sees pipeline-driven work; human-driven and interactive work bypasses it entirely:

- A `status-staleness` detect line sweeps every spec-carrying repo weekly and scores each draft/in-progress spec on resolving inline links, linked pipeline tasks all merged, and backticked paths present in the indexed code. ([validated by `status-staleness.test.ts:65`](libs/shared/src/detect/status-staleness.test.ts#L65), [`status-staleness.test.ts:82`](libs/shared/src/detect/status-staleness.test.ts#L82), [`status-staleness.test.ts:97`](libs/shared/src/detect/status-staleness.test.ts#L97))
- Any signal firing yields one aggregated `stale-spec-status` issue naming the evidence, deduped against an already-open one; zero findings is the healthy steady state. ([validated by `status-staleness.test.ts:272`](libs/shared/src/detect/status-staleness.test.ts#L272), [`status-staleness.test.ts:298`](libs/shared/src/detect/status-staleness.test.ts#L298), [`status-staleness.test.ts:347`](libs/shared/src/detect/status-staleness.test.ts#L347))

**FR2 files an issue, not a PR.** A detect node runs in a station pod, which by
design has no `project.repo.read` (ADR-031 D6/D7: no Postgres, Dgraph, or GitHub
App in the pod), so it cannot read a spec off the default branch to rewrite it. A
weekly PR-opener would also stack duplicates, since FR1's content-based idempotency
does not hold while a flip PR sits unmerged and the default branch still reads
`Draft`. Issue-only needs neither new plumbing nor a new dedup rule.

**`Rejected` is never inferred.** Abandonment is a human judgement; no evidence
distinguishes "abandoned" from "not started yet".

## Consequences

- The spec backlog becomes self-correcting: a stale header survives at most one
  week rather than a quarter. FR1 catches pipeline work at the moment of
  completion; FR2 catches everything else.
- The web-ui mirror still exists and must be edited in step with shared — but the
  parity test now fails CI instead of letting the drift ship. Adding a synonym is
  a two-file change, by construction.
- FR2's evidence comes from chunks, which reflect the last reindex rather than the
  live default branch. A just-merged file reads as missing for up to a day. That
  costs findings and never invents them, which is the right direction to err for a
  detector whose healthy state is silence.
- The evidence signals are heuristic. A spec legitimately mid-flight can carry
  merged tasks and resolving test links, so FR2 reports rather than decides, and
  the issue names its evidence so a human can dismiss it in seconds.
- Two unrelated "status" vocabularies now coexist and are easy to conflate:
  `StatusBucket` here (markdown lifecycle, five values, regex-bucketed) and
  `lore.features.status` (row lifecycle, seven values, DB CHECK-constrained). FR1's
  invariant is precisely that the two agree at the point of completion.
