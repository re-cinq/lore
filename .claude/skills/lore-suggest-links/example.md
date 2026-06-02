# /lore-suggest-links — frozen example

A canonical happy-path transcript on `specs/local-task-runner/spec.md`.
Use this to calibrate progress-note style and decision rationale; do
not paste it back verbatim.

---

```
$ cd ~/repos/re-cinq/lore
$ claude

> /lore-suggest-links specs/local-task-runner/spec.md

I'll suggest inline test links for un-linked testable statements in
specs/local-task-runner/spec.md.

> Reading the spec…
  [Read specs/local-task-runner/spec.md]

> Segmenting + classifying…

  24 statements total:
    • 6 untestable by section heuristic (Problem Statement,
      Limitations, Open Questions) — skipped
    • 18 testable
    • 4 of the 18 already carry a test link
    • 14 candidates for backfill

> Discovering candidate tests…

  [Glob **/*.test.{ts,tsx,js,jsx}, **/*_test.go]
  → 487 test files in this repo

  Pre-filtering by named-symbol overlap (claimNextTask, DbLeaseBackend,
  FileLeaseBackend, executeGraph, claudeCodeHandler, prFooter)…
  [Grep -l for each symbol in test glob]

  Pre-filtering by directory affinity (slug: local-task-runner;
  shared tokens with test paths)…

  Narrowed to 22 candidates across 6 files:
    mcp-server/src/local-runner.test.ts
    agent/src/supervisor/lease.test.ts
    agent/src/supervisor/graph-executor.test.ts
    agent/src/supervisor/claude-code-handler.test.ts
    agent/src/lib/pr-body.test.ts
    agent/src/supervisor/runner-cli.test.ts

> Judging which test validates which statement…

  [Read each candidate test file — focused on describe/it blocks]

  Statement 7 ("It claims a pending task before GKE picks it up.")
    → mcp-server/src/local-runner.test.ts:88
       "claims pending task before GKE" — exercises the SKIP LOCKED
       claim query against pipeline.tasks. Confidence: 92%.

  Statement 8 ("Tasks survive rollout restarts via the lease backend.")
    → agent/src/supervisor/lease.test.ts:42
       "takes over an expired lease and resumes work" — simulates a
       lease past expiry and verifies the new worker resumes.
       Confidence: 88%.

  Statement 11 ("Each stage commits with `Lore-Stage:` trailers.")
    → agent/src/supervisor/graph-executor.test.ts:120
       "emits Lore-Stage trailer per node" — asserts the trailer
       appears on every stage commit. Confidence: 90%.

  Statement 13 ("PR body footer carries `Lore-Task:`.")
    → agent/src/lib/pr-body.test.ts:18
       "prFooter composes Lore-Task: + Refs # footer" — exact match
       on the function this statement names. Confidence: 95%.

  Statement 14 ("Job pod CLI exits with documented codes.")
    → agent/src/supervisor/runner-cli.test.ts:55
       "exits 4 on config-error, 5 on cli-nonzero" — covers the
       exit-code matrix the statement describes. Confidence: 84%.

  Statement 17 ("agent-node handler spawns `claude --print`.")
    → agent/src/supervisor/claude-code-handler.test.ts:30
       "spawns claude --print and pipes input" — directly exercises
       the spawn path. Confidence: 91%.

  Statements 4, 5, 6, 9, 10, 12, 15, 16: no clear single-test match
  found across the 22 candidates. Leaving un-linked.

  Outcome: 6 of 14 candidate statements matched. 8 left un-linked
  for the author to fill in (or for a later cron run).

> Resolving line numbers…
  [Bash grep -n for each match's `it(...)` / `func TestX`]
  All 6 resolved cleanly.

> Applying edits…
  [Edit specs/local-task-runner/spec.md — 6 statements, reverse order]

  ✓ Applied 6 suggestions, skipped 0.

> Diff:

  diff --git a/specs/local-task-runner/spec.md b/specs/local-task-runner/spec.md
  index ab12345..cd67890 100644
  --- a/specs/local-task-runner/spec.md
  +++ b/specs/local-task-runner/spec.md
  @@ -56,7 +56,8 @@
   2. Tasks survive rollout restarts via the lease backend.
  -1. It claims a pending task before GKE picks it up.
  +1. It claims a pending task before GKE picks it up.
  +   ([validated by `local-runner.test.ts:88`](mcp-server/src/local-runner.test.ts#L88))
  -2. Tasks survive rollout restarts via the lease backend.
  +2. Tasks survive rollout restarts via the lease backend.
  +   ([validated by `lease.test.ts:42`](agent/src/supervisor/lease.test.ts#L42))
   ... (4 more inserts)

Open a PR with these suggestions? [y/n]

> y

  [Bash git checkout -b lore/spec-coverage-backfill/local-task-runner-202606031125]
  [Bash git add specs/local-task-runner/spec.md]
  [Bash git commit -m 'lore: backfill suggested test links for specs/local-task-runner/spec.md']
  [Bash git push -u origin lore/spec-coverage-backfill/local-task-runner-202606031125]
  [Bash gh pr create --label lore-managed --label spec-coverage-backfill ...]

  ✓ PR opened: https://github.com/re-cinq/lore/pull/493

Done. 6 suggestions on the way. The author can merge whichever feel
right and reject the rest in PR review. Statements 4, 5, 6, 9, 10,
12, 15, 16 remain un-linked — they'll either get suggestions from
next Monday's cron or stay un-linked until somebody hand-writes them.
```

---

## Empty-set example

```
$ /lore-suggest-links specs/spec-test-coverage/spec.md

Reading…  Segmenting + classifying…

  48 statements total:
    • 18 untestable by section heuristic (Problem Statement, Decisions
      table, Limitations, ...) — skipped
    • 30 testable
    • 30 of the 30 already carry a test link

Nothing to backfill — every testable statement already has a link.
(Stopping here. No commit, no PR.)
```

## Mid-conversation correction

If the developer corrects a suggestion mid-flow ("statement 7's match
is wrong — claimNextTask is in `runner.ts`, not `local-runner.test.ts`"):

- Don't argue. Drop that suggestion.
- Re-judge that statement against the remaining candidates if any
  look promising.
- Continue.

If they correct multiple, reasonable defaults may be off for this
repo. Suggest they try a more targeted invocation
(`/lore-suggest-links {spec_path}` but mention specific tests to
exclude / include in the prompt).
