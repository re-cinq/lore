# /lore-link-coverage — frozen example

A canonical happy-path transcript on a small spec. Use this to calibrate
how the skill should narrate progress; do not paste it back verbatim.

---

```
$ /lore-link-coverage re-cinq/lore specs/local-task-runner/spec.md

> Checking spec status…
  [tool: list_stale_spec_coverage("re-cinq/lore")]

  specs/local-task-runner/spec.md is stale (hash drifted 4h ago,
  last linked by cron on 2026-05-31).

> Preparing…
  [tool: prepare_spec_link("re-cinq/lore",
                            "specs/local-task-runner/spec.md")]

  24 statements segmented:
    • 8 untestable by section heuristic
      (Problem Statement intro / Limitations / Open Questions)
    • 16 need a classifier decision (Solution prose, Acceptance Criteria,
      Architecture notes)
  14 candidate tests pre-filtered, no truncation.
  Assertion hints available: [claimNextTask, LeaseBackend, prFooter].
  Content hash: f3a2d1e7…

> Classifying the 16 unknowns…

  [ordinal 12] "It claims a pending task before GKE picks it up."
    → testable (concrete behaviour, names claimNextTask)

  [ordinal 13] "Tasks survive rollout restarts via the lease backend."
    → testable (verifiable invariant)

  [ordinal 14] "The local runner is intentionally minimal."
    → untestable, category: rationale
    (describes design choice; nothing to verify)

  [ordinal 15] "Worktrees are created lazily on first run."
    → testable

  ... (12 more)

  Final tally:
    11 testable (was 16 unknowns, 11 became testable)
    13 untestable (8 from heuristic + 5 LLM-fallback)

> Judging tests…

  src/local-runner.test.ts › claims pending task before GKE
    → ordinal 12, score 0.92
       rationale: exercises the SKIP LOCKED claim query against
                   pipeline.tasks

  src/local-runner.test.ts › takes over expired lease
    → ordinal 13, score 0.88
       rationale: simulates a lease past expiry and verifies the new
                   worker resumes work

  src/lease-backend.test.ts › DbLeaseBackend acquires atomically
    → ordinal 13, score 0.74
       rationale: covers the lease primitive that statement 13 names

  ... (5 more matches; 6 candidates rejected as no clear single-statement
       match)

> Persisting…
  [tool: persist_spec_link("re-cinq/lore",
                            "specs/local-task-runner/spec.md",
                            "f3a2d1e7…", classifications, judgments)]

  ✓ Saved.
    Coverage: 9 / 11 testable covered (82%), 13 untestable
    8 links written, 0 pruned
    linked_by: local:abc-123

  View: https://lore.example.com/repos/re-cinq/lore/specs/specs%2Flocal-task-runner%2Fspec.md
```

---

## Hash-drift retry path (rare but supported)

```
> Preparing…
  Content hash: f3a2…

> Classifying… judging… (5 min elapses; someone pushes a doc commit
  that re-ingests the spec; the new hash is 9e1d…)

> Persisting…
  ← 409 content_hash_stale, current_hash: 9e1d…

  The spec changed during this conversation. Re-preparing with the
  new content…

  prepare_spec_link returned 26 statements (was 24 — two acceptance
  criteria were added).

> Re-classifying the 4 newly-unknown statements…
> Re-judging the 14 candidates (12 unchanged from last round; reuse
  previous scores and rationales for those)…

> Persisting against hash 9e1d…
  ← 200 OK
```

The developer sees the retry as a one-line note; the skill does the
heavy lifting silently.
