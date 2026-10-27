---
name: tdd-loop
description: >-
  Run a strict Red-Green-Refactor TDD loop to a goal, one test at a time, by
  orchestrating the bender-the-tester, bender-the-coder, and bender-the-architect subagents.
argument-hint: "[--gate-tests] [session goal]"
disable-model-invocation: true
---

# TDD Loop

You are orchestrating a strict Test-Driven Development loop. The session goal is:

$ARGUMENTS

Do NOT enter plan mode. Plan mode would design all the tests up front, which
defeats incremental TDD. Run this in normal execution mode and write exactly one
real test per cycle.

Subagents cannot spawn subagents — YOU (the main thread) drive the loop and spawn
each subagent via the Agent tool. The three share the working tree, so artifacts
pass between them on disk; you thread the goal and each step's result in the prompt.

## Optional flag — `--gate-tests`
If `$ARGUMENTS` begins with `--gate-tests`, strip it from the goal and enable the
opt-in Rule-1 hard stop in step h2 below. Without the flag, the quality signal is
purely advisory and never blocks the loop.

## Step 1 — Seed a test list (behaviors, NO test code)
Brainstorm a short list of behaviors for the goal. Rules:
- It does not need to be exhaustive. List the interesting cases plus a few edge and
  failure cases.
- Group by equivalence class — only list cases that are truly distinct facets, not
  instances of the same rule.
- Tag each item gold (happy path) or thorn (failure mode). Mark the kernel test.
- When hardening legacy code, you may seed the list from a
  `legacy-find-missing-tests` coverage-gap table (convert gap rows into items).
Show the list. No test code yet.

## Step 2 — Loop until the goal is met / the list is exhausted
For each cycle:

a. SELECT the next test with these heuristics, in order:
   - Kernel first: a degenerate case costing ~zero implementation that forces the
     API into existence (signature, input/return type, sync/async, where it lives).
   - Then clear a couple of thorns to settle the API shape.
   - Then the dominant rule on the gold: pick the test that forces ONE and ONLY ONE
     new facet. Skip any test that would not change the code (not worth writing);
     of those that do, take the smallest new facet. (ZOMBIES — zero, one, many,
     boundary, interface, exceptions — orders cases within an equivalence class.)
   - Sweep remaining thorns at the end.
   - Triangulate: if the previous green step hardcoded a value, the next item is
     the test that forces generalization.

b. RED: `Agent(bender-the-tester)` with the goal + the one selected facet. It writes
   one failing test, runs it, and returns the test path + the actual failure
   output + any leftover facets.

c. GATE: verify the test fails for the right reason. If it passed, errored wrongly,
   or the writer reported leftover facets, fold those into the list and re-select.

d. GREEN: `Agent(bender-the-coder)` with the test path + the test-writer's actual
   RED run output + the goal. Pass the real failure, not a paraphrase.

e. GATE: verify the suite is green. One corrective retry; else stop and report.

f. BUILD ARCHITECTURE CONTEXT for the refactor (your job, before spawning the
   architect):
   - Local context — the changed files, their imports/importers, sibling files in
     the same module, the matching test files.
   - Overview context — project layout, key modules/layers, existing
     abstractions/patterns/conventions the new code should conform to (grep for
     similar code; read CLAUDE.md / AGENTS.md if present).

g. REFACTOR: `Agent(bender-the-architect)` with the changed files + the goal + the local
   and overview context from (f).

h. GATE: confirm the architect re-ran tests and the suite is still green. If red,
   the architect should have reverted; otherwise stop and report.

h2. QUALITY SIGNAL (advisory; opt-in hard stop). Optionally run `/four-rules-report`
   on this cycle's changed files (empty-arg → change-set scope) and surface its
   Verdict as design feedback. Fold any Cracks/Broken items into the
   `future_improvements` backlog (step j) — never act on them mid-cycle.
   - Default: purely advisory. It NEVER reverts, fails, or blocks the cycle — the
     green bar already passed at gate h.
   - With `--gate-tests`: if the report grades Rule 1 BROKEN (behaviour-bearing
     production code added this cycle with no test), STOP the loop and report it
     instead of crossing off the item, so the missing test gets written. Only Rule 1
     escalates; Rules 2–4 stay advisory.

i. Cross off the item. Append any newly-discovered behaviors/refactors to the list
   (do not chase them mid-cycle). Re-show the updated list.

j. Collect the architect's `future_improvements` into a running, de-duplicated
   backlog — out-of-scope smells for later, never acted on this run.

## Step 3 — Report
- Cycles completed and files changed.
- Final suite status.
- The latest four-rules Verdict (if the quality signal was run), as advisory context.
- The remaining test list.
- The aggregated Future Improvements backlog (location + smell + suggested fix per
  item) for future sessions.

## Loop rules
- One test per cycle, always. Never let the test-writer batch tests.
- The subagents never commit. If you want green checkpoints, YOU (main thread)
  handle commits, and only when the user asks.
- This flow is language-agnostic — the subagents detect the toolchain and use the
  repo's idiomatic runner, layout, naming, and assertions.

## Help

<!-- lore-help:begin -->
**Summary.** Run a strict Red-Green-Refactor loop to a goal by orchestrating the tester, coder and architect subagents, one test at a time.
**Usage:** `/tdd-loop [--gate-tests] [session goal]`
**Use when.** You have a goal to reach test-first and want subagents to take turns writing the failing test, the minimal code and the refactor.
**Related:** `/tdd-start`, `/mutation-testing`
<!-- lore-help:end -->
