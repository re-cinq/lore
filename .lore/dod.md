# Definition of Done

> The question this epic answers is narrower than "match Orbit": **what is
> missing from our graph that the implementation loop actually starves on.**
> Four things, ranked. [...] Nothing here touches code yet — filed during an
> in-flight refactor on purpose.

**Strategy: `changes_requested`** — This is an epic, not a testable unit. Its
own text is a work list of four independent feature tickets with an explicit
build order (#1768 first, then #1769, #1770 rides along, #1771 later), and it
states outright that nothing here touches code yet. There is no single
behaviour the epic introduces; every honest acceptance test would have to pick
one of the four children and would thereby redefine the epic as that slice —
the one move the DoD contract forbids ("really several tickets ... park it").

## Why this cannot be one DoD

Each checklist item is a separate capability with its own seam and its own
acceptance surface:

- **#1768** — cross-file references + imports edges on `CodeChunk` (call
  graph). New Dgraph edges + `lore-code-trace` projection.
- **#1769** — per-run branch overlay (`${repo}|run:${id}|…` xid prefix,
  bulk-delete by prefix). Overlay ingest + GC.
- **#1770** — branch-scoped per-test coverage for `tdd-round`. `main`-scoped
  half independent; branch half blocked on #1769.
- **#1771** — station-run failures as `Failure` nodes joined to files/symbols
  for `fix-ci` (stores resolving sha, never the diff).

The "Locked decisions" and "Two non-obvious design calls" are epic-level
architecture guidance shared across all four, not a behaviour to assert.

## What is needed to proceed

Run each child ticket through its own DoD node separately:

- [ ] #1768 as its own ticket (no blockers)
- [ ] #1769 as its own ticket (#1768 lands first by preference, not dependency)
- [ ] #1770 as its own ticket (branch half blocked on #1769)
- [ ] #1771 as its own ticket (benefits from #1768)

Each will name or create its spec statement(s) and get one acceptance test per
un-linked testable statement at that time.

## Out of scope

- Any code change on this branch — the epic explicitly defers all four builds.
