# Feature Specification: Local Link Suggester

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Local Link Suggester                     |
| Status         | Shipped                                    |
| Created        | 2026-06-03                               |
| Owner          | Platform Engineering                     |
| Builds on      | [`spec-test-coverage`](../spec-test-coverage/spec.md) v3 (markdown link source-of-truth + backfill cron) |

## Problem Statement

`spec-test-coverage` v3 has two write-paths to suggest test links:

1. **Authors hand-write them** in `spec.md`. Free, zero infrastructure,
   but cognitive overhead: the author has to remember which test
   validates each statement and recall its path + line number.
2. **The `spec-coverage-backfill` cron** opens suggestion PRs every
   Monday at 11:00 UTC. Cheap for the author, but slow — the cron
   sweeps the whole org on its own schedule. A spec I'm editing
   *right now* will not get a suggestion until next Monday at the
   earliest, and the cron's API spend is billed against the org's
   `ANTHROPIC_API_KEY`, not my Claude Code subscription.

There is **no on-demand single-spec path** for the case "I just edited
this spec and want a suggestion *now* without waiting six days." The
deleted v2.5 `local-coverage-linker` (PRs #483 + #484) tried to provide
this via DB-persistence MCP tools, but v3 deleted the DB tables, so
that flow has no target.

## Solution

A **Claude Code skill** — `/lore-suggest-links` — that walks a
developer's local Claude session through the same backfill judge
pipeline the cron runs, but:

- **Subscription-billed.** Every LLM call happens in the developer's
  Claude Code conversation, not via the agent's `callLLMWithTool`.
- **On-demand, single-spec.** Run it when you want, on the spec
  you're editing.
- **Zero server state.** No new MCP tools, no new DB tables, no
  endpoints. The skill drives the flow using built-in tools (Read,
  Grep, Glob, Edit, Bash) over the developer's local repo
  checkout.
- **PR-shaped output.** The skill stages the spec edit, commits,
  and opens a PR with the same shape the cron's backfill PR would
  have. Author reviews their own edit before pushing.

The pipeline mirrors the cron's: segment the spec → identify testable
un-linked statements → discover candidate tests → reason about which
test validates which statement → write the markdown link inline →
commit + PR. The deterministic parts (segmentation, section heuristic,
test-file detection) Claude does in conversation using the patterns
documented in the skill prose; the LLM-y parts (classifying the few
ambiguous statements, judging which test validates which statement)
happen as Claude reasoning, subscription-billed.

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Form factor | **A skill, not an MCP tool**. Prose walks Claude through the flow using built-in `Read` / `Grep` / `Glob` / `Edit` / `Bash` tools | Zero new infrastructure, ships immediately, works for any repo the developer has checked out |
| Spec source | **Local working tree** (the developer's checkout) | Author runs this *while editing* a spec; the file on disk is what they care about, not the (possibly stale) ingested copy in the prod DB |
| Test discovery | **`Glob` + `Grep`** over the working tree | Same source of truth as the file the developer will edit; no dependency on Lore's ingest having run |
| Line-number resolution | **`grep -n`** for the matched `it(...)` / `func Test...` pattern | Author edits the spec to include a `#Lline` anchor; finding the line is a one-shot bash command |
| Multi-statement handling | **One PR per spec** (same as the cron), not one PR per statement | Author reviews all suggestions together; rejection is comment-driven, not PR-driven |
| Heuristic classification | **Replicate `classifyByHeuristic` rules in skill prose**: statements under Problem Statement / Vision / Background / Clarifications / Open Questions / Limitations / Rationale → narrative (skip); everything else → testable candidate | Same boundary as the cron; consistent UX across both paths |
| Already-linked check | **Authors should not overwrite their own work** — skill skips any statement whose trailing parenthetical already contains a test link | Matches `proposeLinkInsertions`'s `already-linked` skip |
| Commit message | `lore: backfill suggested test links for {spec_path}` (same as cron) | Authors can grep for this string across both paths |
| Branch naming | `lore/spec-coverage-backfill/{slug}-{ts}` (same as cron) | Consistency; reviewers see the same shape regardless of which path opened the PR |
| PR labels | `lore-managed` + `spec-coverage-backfill` (same as cron) | The label-driven UI filters and automation work uniformly |

## User Experience

```
$ cd ~/repos/re-cinq/lore
$ claude

> /lore-suggest-links specs/local-link-suggester/spec.md

I'll suggest inline test links for any un-linked testable statements
in specs/local-link-suggester/spec.md.

Reading the spec…  Found 18 statements:
  • 6 narrative (intro / decisions / limitations) — skipping
  • 12 testable, of which:
    - 0 already have a test link
    - 12 are candidates for backfill

Discovering candidate tests in this repo…
  Globbing test files… 487 test files found.
  Pre-filtering by directory affinity + assertion overlap…
  Narrowed to 24 candidates across 8 files.

Judging which test validates which statement…
  [reads each candidate test file via Read]
  [reasons about behaviour vs spec statement]

  Decisions:
    Statement 4 ("The skill drives the flow using built-in tools")
      → no test validates this (it's a design-decision narrative; reclassify as narrative)
    Statement 7 ("`Glob` + `Grep` over the working tree")
      → no test (spec-of-skill, not of code)
    Statement 9 ("commit message: lore: backfill suggested test links")
      → no test (string constant in skill prose)
    ... (9 more)

  Outcome: this spec is mostly about how the SKILL behaves; very few
  statements are validated by code-level tests. Not a great backfill
  candidate. Suggesting 0 inserts.

Want me to try a different spec, or commit the result?
```

The skill is honest when there's nothing to suggest. For specs *about
code* (most of the rest of `specs/`), the output looks like:

```
> /lore-suggest-links specs/local-task-runner/spec.md

Reading…  24 statements, 16 testable, 14 un-linked.

Discovering candidate tests…  Narrowed to 22 candidates across 6 files.

Judging…

  Suggestions (8 of 14 statements matched):

    Statement 4 ("Claims a pending task before GKE picks it up.")
      → mcp-server/src/local-runner.test.ts:88
        ([validated by `local-runner.test.ts:88`])

    Statement 7 ("Tasks survive rollout restarts via the lease backend.")
      → agent/src/supervisor/lease.test.ts:42
        ([validated by `lease.test.ts:42`])

    ... (6 more)

    6 statements untouched (no clear single-test match found).

Applying inserts to specs/local-task-runner/spec.md… done.

Opening PR? [y/n]

> y

  git checkout -b lore/spec-coverage-backfill/local-task-runner-202606031125
  git add specs/local-task-runner/spec.md
  git commit -m 'lore: backfill suggested test links for specs/local-task-runner/spec.md'
  git push -u origin lore/spec-coverage-backfill/local-task-runner-202606031125
  gh pr create --label lore-managed --label spec-coverage-backfill \
    --title 'Suggested test links for specs/local-task-runner/spec.md' \
    --body '...'

  PR opened: https://github.com/re-cinq/lore/pull/N
```

## Architecture

```
┌────────────  Developer's local Claude Code session  ───────────┐
│  /lore-suggest-links specs/X/spec.md                            │
│      │                                                           │
│      ├── Read     specs/X/spec.md                                │
│      ├── prose:   segment statements (sentences + list items)    │
│      ├── prose:   classify (section heuristic)                   │
│      ├── prose:   pickStatementsForBackfill (testable + no link) │
│      │                                                           │
│      ├── Glob    **/*.{test,spec}.{ts,tsx,js,py,go}              │
│      ├── Grep    "claimNextTask" -l   (assertion overlap)        │
│      ├── reasoning: pre-filter to a small candidate set          │
│      │                                                           │
│      ├── Read    candidate test files                            │
│      ├── reasoning: judge which test validates which statement   │
│      │                                                           │
│      ├── Edit    specs/X/spec.md   (insert markdown links)       │
│      └── Bash    git checkout -b … && git push && gh pr create   │
└─────────────────────────────────────────────────────────────────┘

Zero MCP tool calls. Zero LORE_API_URL calls. Zero DB writes anywhere
on Lore's side. The PR opens against the developer's GitHub directly.
```

When the PR merges, the existing ingest + UI pipeline picks it up
naturally — same path as a hand-edited spec.

## Decisions deferred to follow-ups

| | Choice | Rationale |
|---|---|---|
| `lore-suggest-prep` CLI helper | Skip for v1 | Skill walks Claude through the deterministic parts in prose; a CLI shim that runs `segmentStatements` + `classifyByHeuristic` + `selectCandidates` from `@re-cinq/lore-shared` locally would be faster + more precise but adds a new artifact. Worth it only if v1's prose-driven approach proves too lossy. Tracked as F-cli-prep. |
| Working with the *ingested* spec instead of the local file | Skip for v1 | Authors typically run this *while editing* the local file; the ingested copy may be stale and would require a read tool. Tracked as F-ingested-spec for the "review an existing prod spec from any directory" use case. |
| Multi-spec batch | Skip for v1 | The skill takes one `spec_path` argument; an "all-stale-specs in this repo" mode is a sweep wrapper that calls the single-spec flow in a loop. Tracked as F-batch-sweep. |
| Reusing the cron's `proposeLinkInsertions` helper | Skip for v1 (skill emits the markdown edit directly via `Edit` tool) | Importing the helper from `@re-cinq/lore-shared` requires the developer's environment to have `npm install`-ed it. The skill works without — Edit tool inserts inline. If we later add the CLI prep helper (F-cli-prep), it can use `proposeLinkInsertions` directly. |

## File Changes

| File | Change |
|------|--------|
| `.claude/skills/lore-suggest-links/SKILL.md` | NEW. The walked-through flow. ~200 lines of prose. |
| `.claude/skills/lore-suggest-links/example.md` | NEW. Frozen happy-path transcript on a hand-crafted demo spec. Read-once calibration; do not paste back. |
| `CLAUDE.md` | Modify. Add a sentence under the spec-coverage section pointing at the skill for on-demand subscription-billed suggestions. |
| `specs/spec-test-coverage/tasks.md` | Modify. Phase 7 follow-up `F-local-on-demand` is now implemented; mark `[x]` (skill landed) and note this spec. |

No agent / mcp-server / shared / web-ui code changes for v1.

## Acceptance Criteria

1. `.claude/skills/lore-suggest-links/SKILL.md` exists and is registered (appears in the available-skills list once the file is checked in).
2. The skill prose walks Claude through: read spec → segment → classify by section heuristic → pick testable un-linked statements → discover candidate tests via Glob + Grep + Read → judge which test validates which statement → apply inline markdown link edits via Edit → commit + open PR via Bash.
3. The skill's commit message + branch name + PR labels match the `spec-coverage-backfill` cron's so reviewers see uniform PR shapes regardless of source.
4. The skill checks for and skips statements that already have a test link in their trailing parenthetical (matches the cron's `already-linked` skip).
5. When zero statements have a clear single-test match, the skill reports that explicitly and asks the developer whether to commit / open a PR anyway with the zero-suggestion result (a no-op PR) or stop. Default: stop.
6. The skill works against any spec in any repo the developer has checked out locally — no requirement that the repo be onboarded into Lore. It does not call `LORE_API_URL`, does not require `LORE_INGEST_TOKEN`, does not read or write any Lore DB table.
7. A frozen example transcript at `.claude/skills/lore-suggest-links/example.md` shows one full happy path on a hand-crafted demo spec.

## Limitations & Open Questions

1. **No structured candidate pre-filter.** The cron uses `selectCandidates` with assertion overlap + directory affinity + embedding proximity. The skill replicates the first two via Grep + directory matching; embedding proximity isn't available locally. For most repos this is fine — assertion overlap is the strongest signal — but very large repos with thousands of tests may surface noisy candidates. Mitigation: the skill is honest about candidate count and asks the developer to narrow scope when results are noisy. F-cli-prep would fix this by running `selectCandidates` from `@re-cinq/lore-shared` locally.
2. **Line numbers depend on local toolchain.** The skill uses `grep -n` to find the matching `it(...)` or `func TestX` line. If the toolchain emits different test shapes (Java `@Test`, Python `def test_x`), the skill prose covers the common patterns but isn't exhaustive. Author can override by editing the inserted link's anchor.
3. **No content-hash freshness gate.** The cron skips unchanged specs; the skill always processes whatever the developer points it at. That's the right call for on-demand use.
4. **No suggestion-quality telemetry.** The cron records its PR outcomes; the skill doesn't. If a developer wants to know "are these suggestions any good?", they look at their own PR's review history. F-suggestion-telemetry could record outcomes back to a memory if useful.
5. **No coverage-data input.** The cron defers `coverage-ingestion` (the LCOV/Cobertura ingestion spec); the skill defers it too. When that spec ships, both paths benefit identically by surfacing coverage-aware candidates.
6. **Author runs this against a local working tree.** If the repo is huge or the developer hasn't checked out the right branch, the skill can produce stale suggestions. Documented; not load-bearing.
