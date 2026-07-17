---
adr_number: 37
title: "Spec status: one canonical vocabulary, machine-maintained"
status: in progress
date: 2026-07-16
domains: [pipeline, agent]
---

# ADR-037: Spec status vocabulary and automatic upkeep

Every spec and ADR carries a lifecycle status, and that status is the org's
backlog signal — the web-UI pills render it, the upkeep automation flips it, and
humans read it to know what is real. This ADR fixes the vocabulary those statuses
are written in: five buckets normalized from free text, tolerant on input and
canonical on output, single-sourced in `libs/shared` and held to its web-UI mirror
by a parity test — plus the two machine layers that keep the headers honest once
convention rots.

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

**The synonym table is tolerant because Lore parses corpora it does not own.**
This repo's own specs use five of these words; the rest are not dead weight. Lore
serves every onboarded repo, each with its own house style, and MADR — the ADR
standard — natively says `proposed` / `accepted` / `superseded` / `deprecated`.
Lore's own `onboard` prompt ([task-types.yaml](../scripts/task-types.yaml))
instructs every new repo to write `status: accepted`, so Lore *manufactures* the
inputs the table absorbs. A parser that only knew `Shipped` would return `null` on
a conformant MADR corpus: no pill, and `status-staleness` skipping the file.

Three choices carry weight:

- **Tolerant on input, canonical on output.** The synonyms exist for reading, and
  the bucket is the only thing that escapes the parser — see §2.
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
it keeps a mirror plus its own UI-only concerns (`SPEC_STATUS_LABEL` / `_COLOR` /
`_ORDER`). The mirror is held in lockstep by a parity test that imports shared's
pure module **by relative file path — never the package**:

- Both implementations bucket every synonym in the vocabulary identically, including bold cells, trailing qualifiers, and values in no bucket at all. ([validated by `spec-status.parity.test.ts:57`](apps/web-ui/src/lib/spec-status.parity.test.ts#L57))
- Parity is asserted over both corpora, since both mirrors parse both: a spec's `| Status |` row and an ADR's frontmatter `status:`. ([validated by `spec-status.parity.test.ts:65`](apps/web-ui/src/lib/spec-status.parity.test.ts#L65))
- Both report no status when a spec table carries no `Status` row, and when an ADR carries no frontmatter at all. ([validated by `spec-status.parity.test.ts:73`](apps/web-ui/src/lib/spec-status.parity.test.ts#L73), [`spec-status.parity.test.ts:81`](apps/web-ui/src/lib/spec-status.parity.test.ts#L81))

This follows the existing
[feature-types.parity.test.ts](../apps/web-ui/src/lib/feature-types.parity.test.ts)
precedent and ADR-036's philosophy: import boundaries are enforced by tests, not
by convention. A comment did not stop the `proposed` drift; the test does.

Historical note, since the file dates mislead: the web-ui pill
([0dfb32d1](https://github.com/re-cinq/lore/pull/814)) came **first**, and shared's
table ([b255f45a](https://github.com/re-cinq/lore/pull/835)) was copied from it two
days later for the lint rule. Shared is the single source by decision, not by
seniority — which is exactly how `proposed` came to exist in the copy and not the
original.

### 3. Only the bucket is displayed — never the author's raw word

`parseDocStatus` returns the bucket alone, for both corpora. Each bucket has
exactly one display name (`SPEC_STATUS_LABEL`), and every surface — pill and
filter chips, spec and ADR alike — renders that:

- Every synonym of a bucket renders as one label, so `Shipped`, `Implemented — merged to main 2026-06-30`, `Complete` and `Accepted (pre-implementation)` all read **Shipped**. ([validated by `spec-status.test.ts:54`](apps/web-ui/src/lib/spec-status.test.ts#L54))
- The pill takes a bucket, so its colour and its word cannot disagree. ([validated by `SpecStatusPill.test.tsx:7`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L7), [`SpecStatusPill.test.tsx:13`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L13), [`SpecStatusPill.test.tsx:24`](apps/web-ui/src/components/SpecStatusPill.test.tsx#L24))

Previously the pill printed the raw cell text, lightly truncated, while its colour
came from the bucket. That was a feature of the free-text era — showing the
author's own word was the point — but once
[28e6694b](https://github.com/re-cinq/lore/pull/836) normalized the corpus it
became a leak: one state rendered as four different green pills, the filter chips
(which always showed bucket names) disagreed with the cards they filtered, and the
types let `{status: "rejected", label: "Superseded"}` render a retired spec in
rejected red. Buckets in, buckets out.

The cost is that an unrecognized-but-bucketed spelling no longer surfaces the
author's wording. That bought little: `parseSpecStatus` already returns `null` for
anything in no bucket, so the raw word only ever varied *within* a bucket — which
is precisely the variation that confused readers.

The two corpora make the case sharper than specs alone did. Since
[#861](https://github.com/re-cinq/lore/pull/861) the same pill renders ADRs, whose
frontmatter spells shipped as `accepted` — so the raw-word era would have printed
**Implemented** and **Accepted** side by side in one list for a single state. The
bucket is the only thing the two corpora agree on, so it is the only thing to
render. Note this is a *display* table: the write-side vocabulary — what a status
flip puts back *into* a file — is shared's `statusLabel(status, kind)`, which
deliberately keeps each corpus's own spelling (`Shipped` in a spec cell,
`shipped` in ADR frontmatter). Read normalizes; write respects the house style.

### 4. Statuses are maintained by machine, in two layers

Both layers are deterministic — **no LLM** — and both produce artifacts for human
review rather than acting unilaterally. Spec:
[specs/spec-status-upkeep/spec.md](../specs/spec-status-upkeep/spec.md).

**FR1 — deterministic flip on feature completion**
([spec-status-flip.ts](../libs/shared/src/spec-status-flip.ts),
[merge-check.ts](../apps/floor/src/jobs/merge/merge-check.ts)):

- The flip fires only when a merging spec-task leaves no sibling with work outstanding in its `task_group_id`, and the group resolves to an owning feature. ([validated by `spec-status-flip.test.ts:14`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L14), [`spec-status-flip.test.ts:18`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L18), [`spec-status-flip.test.ts:22`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L22), [`spec-status-flip.test.ts:26`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L26), [`spec-status-flip.test.ts:30`](apps/floor/src/jobs/merge/spec-status-flip.test.ts#L30))
- It writes the status the spec's test-link coverage entitles it to claim — never a fixed word: no links → `Draft`, some → `In Progress`, all → `Shipped`. The literal comes from the write-side vocabulary (`statusLabel`), which spells the same bucket per corpus (a spec cell is Title Case, an ADR's frontmatter lowercase). One PR carries the upkeep labels; it skips silently when the spec is missing, has no status row, is terminal, has nothing testable to derive from, or already claims what its coverage supports. ([validated by `spec-status-flip.test.ts:71`](libs/shared/src/spec-status-flip.test.ts#L71), [`spec-status-flip.test.ts:103`](libs/shared/src/spec-status-flip.test.ts#L103), [`spec-status-flip.test.ts:139`](libs/shared/src/spec-status-flip.test.ts#L139), [`spec-status-flip.test.ts:156`](libs/shared/src/spec-status-flip.test.ts#L156))
- The edit is a single-cell rewrite that leaves every other line byte-for-byte intact, preserves CRLF, and is idempotent by content — an already-shipped or retired spec is never re-marked. ([validated by `spec-status.test.ts:150`](libs/shared/src/spec-status.test.ts#L150), [`spec-status.test.ts:164`](libs/shared/src/spec-status.test.ts#L164), [`spec-status.test.ts:170`](libs/shared/src/spec-status.test.ts#L170), [`spec-status.test.ts:176`](libs/shared/src/spec-status.test.ts#L176), [`spec-status.test.ts:181`](libs/shared/src/spec-status.test.ts#L181), [`spec-status.test.ts:187`](libs/shared/src/spec-status.test.ts#L187), [`spec-status.test.ts:196`](libs/shared/src/spec-status.test.ts#L196))

The `lore.features` row transitions to `implemented` only when the flip succeeded or
the spec was already current, so the table and the file never diverge.

**"Done" is the absence of outstanding work, not the presence of merges.** The
gate originally counted rows `WHERE status <> 'merged'`, which cannot distinguish
"not yet done" from "will never be done". Three statuses never reach `merged` and
so stalled the flip permanently: `completed` (an agent that found no changes opens
no PR, and `mergeableTasks` only selects `pr-created`/`review` — a locally-run task
lands here too), and `retried` (superseded). Those are settled. `failed`,
`cancelled` and `needs-human-help` are unfinished business and still hold the group
open — FR1 must not announce a feature the pipeline never finished; FR2's weekly
detector is the net for a group a human resolved by hand.

`retried` is only safe to ignore because `retryTask` now passes the original's
`task_group_id` to the replacement. It previously omitted it, so the replacement
was born groupless: the `retried` original blocked forever *and* merging its
replacement could never clear the group. Ignoring `retried` without that fix would
have flipped the spec while the retry was still running — trading a false negative
for a worse false positive.

Note the asymmetry with FR2, which treats `failed`/`cancelled` as settled: FR1
*acts* (opens a PR, transitions the feature row) while FR2 only *reports* evidence
for a human. The threshold to act is higher than the threshold to mention.

**FR2 — weekly status-staleness detector**
([status-staleness.ts](../libs/shared/src/detect/status-staleness.ts)). FR1 only
sees pipeline-driven work; human-driven and interactive work bypasses it entirely:

- A `status-staleness` detect line sweeps every spec-carrying repo weekly and scores each draft/in-progress spec on resolving inline links, linked pipeline tasks all merged, and backticked paths present in the indexed code. ([validated by `status-staleness.test.ts:66`](libs/shared/src/detect/status-staleness.test.ts#L66), [`status-staleness.test.ts:83`](libs/shared/src/detect/status-staleness.test.ts#L83), [`status-staleness.test.ts:98`](libs/shared/src/detect/status-staleness.test.ts#L98))
- Any signal firing yields one aggregated `stale-spec-status` issue naming the evidence, deduped against an already-open one; zero findings is the healthy steady state. ([validated by `status-staleness.test.ts:285`](libs/shared/src/detect/status-staleness.test.ts#L285), [`status-staleness.test.ts:311`](libs/shared/src/detect/status-staleness.test.ts#L311), [`status-staleness.test.ts:360`](libs/shared/src/detect/status-staleness.test.ts#L360))

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
- Adding a *bucket* is now a three-file change in web-ui: the regex table, the
  colour map, and `SPEC_STATUS_LABEL`. `Record<SpecStatus, string>` makes the last
  two compile errors rather than omissions.
- A reader loses the ability to see which synonym an author wrote without opening
  the spec. Deliberate: that string was the confusion, and the raw header is one
  click away.
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
