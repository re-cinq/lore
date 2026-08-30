---
name: tdd-loop
description: Run one strict red-green-refactor round. Use when implementing behaviour test-first — write exactly one failing test for the smallest facet, write the least code that makes it pass, then refactor with the bar green. Covers the one-facet rule, designing away mocks and stubs, Kent Beck's green-bar strategies, and the Simple Design Dynamo.
---

This is the authoritative copy of Lore's TDD contract for agent runs. It is checked
into the Lore repo at `apps/mcp-server/agent-skills/skills/tdd-loop/` and served to
pods by the gateway's `/skills` registry.

You run the three phases yourself, in order, in one pass. Do not skip a phase and do
not run two facets in one round.

## The three laws

1. Do not write production code unless it is to make a failing test pass.
2. Do not write more of a unit test than is sufficient to fail — a compile or import
   failure counts.
3. Do not write more production code than is sufficient to make the currently failing
   test pass.

## Phase 1 — RED

Detect the toolchain from the project (`package.json`, `go.mod`, `pyproject.toml`,
`Cargo.toml`, `pom.xml`, `Gemfile`, `mix.exs`, `Makefile`, CI config) and mirror the
conventions already in the repo's tests — framework, directory, file suffix, assertion
style. Assume nothing about the language.

**The one-facet rule.** Name the single smallest behaviour that moves you forward. If
the behaviour you were handed would force more than one new facet, write the test for
the smallest facet only and report the leftovers rather than growing the round.

Write **exactly one** test. Run it. Confirm it fails **for the reason you expect** —
the behaviour is absent, not the import path typo'd or a fixture missing. A test you
did not run is not a red bar, it is a guess.

If a behaviour would not change the code under test at all, say so and write nothing.
A test that forces no change is not worth writing.

### No mocks, no stubs

Design every test to exercise pure logic with real values — value in, value out, not
interactions. A facet that seems to *require* a double is a design signal: the real
problem is an unmanaged side effect, not the absence of a mock. Pick a facet that is
testable without doubles, and note that the production code should push the I/O to the
edges so the pure core is directly testable.

- Stubbed lookup → pure function on a value. `discountFor(user)` taking a real `User`,
  not `discountFor(userId)` fetching one behind a `UserRepository` stub.
- Interaction mock → assert on a returned value. Have the core return the intent and
  assert `notificationsFor(order)`; sending happens at the edge.
- Clock/RNG stub → inject the value. `isExpired(deadline, now)`, both plain values.

A true collaborator boundary that must eventually be pinned down is a separate
**contract test**, never an ad-hoc mock sprinkled into a unit test.

### Test naming

The principle is language-agnostic; the surface form follows the language.

- Short, clear, scannable. The name carries the expected behaviour **and** the tested
  data — never the implementation.
- No "should".
- Apply the *ask-why* check: a name that does not answer why the test exists is a
  structural name, not an intent-revealing one.
- Include the context only when the enclosing suite does not already establish it.

Good: `returns 0 for an empty list`, `returns I for 1`, `throws RangeError for 0`.
Bad: `should return zero`, `test sum`, `works correctly`.

## Phase 2 — GREEN

Write the fewest lines that turn the bar green. No extra features, no speculative
generality, no refactoring yet.

**Kent Beck's green-bar strategies:**

- *Obvious implementation* — when the real code is trivial and unmistakable, write it.
- *Fake it* — when it is not, return a constant and let a later test replace constants
  with variables.
- *Triangulate* — leave generalization to the NEXT test. Do not guess the general
  solution now.

Run the suite — the whole suite if it is fast, otherwise the new test plus everything
touching the files involved. All of it must pass.

**Never edit the test to make it pass.** If the test is wrong, say so and stop; that is
a finding, not a green bar.

### Where code goes

Never create code in catch-all `utils` / `misc` / `helpers` / `common` / `shared` /
`lib` modules. Place and name code by the domain concept it serves — discount logic in
`pricing/`, not `utils/calc.ts`. When no home exists, create a domain-named module,
never a generic bucket.

### Naming

Meaningful but concise — one to three words (`pendingOrders`, `isContainer`,
`retryCount`). No single letters except trivial loop indices; no `temp`/`data`/`x`; no
sprawling four-plus-word names. Name by role: `rawInput`, `normalized`.

## Phase 3 — REFACTOR

The bar is green. Improve the design without changing behaviour, and fit the new code
into the surrounding architecture. The suite stays green throughout.

**Duplication is duplicated knowledge, not just duplicated text.** Hunt for and
collapse: the same business rule expressed two ways, a constant or validation
re-derived in two places, parallel structures encoding one concept, a domain concept
named differently across modules, the same idea living in both code and a test.

Refactor **both** production and test code. Test refactoring counts: collapsing
duplicated tests into one parameterized test, removing now-subsumed tests, extracting
shared setup, clarifying names. Behaviour coverage must not shrink.

### The Simple Design Dynamo

Reuse is a **result** of removing duplication, never a prediction. Never extract because
something "might" be reused. For each candidate, in order:

1. Remove the duplication — collapse the copies into one. The reusable shape only
   becomes visible after the duplication is gone.
2. Separate what varies from what stays the same.
3. Extract a template — the algorithm steps with explicit variation points.
4. Name each operation concretely. **If a step cannot be named, the variation is not
   understood yet — stop and look.**
5. Parameterize the details — lift literals into arguments. Generic logic in code,
   specific values in data passed in.

This loops: removing duplication creates structures → you name them → better names
raise cohesion → higher cohesion makes the next, bigger duplication visible.

**Rule of three.** Two copies = notice, and remove the duplication *in place*. Promote
to a shared module only on the third genuinely similar case. Lifting on the second copy
couples unrelated callers and is harder to undo than the duplication was.

### Reveal intent

For any name you touch, ask "why does this exist / what is it really?" — the name must
answer that, not describe the mechanism. A function name containing "and"
(`parseAndStore`) is two responsibilities; split it. Improve names iteratively:
nonsense → structurally accurate → intent-revealing.

### Fewest elements

Inline indirection that does not pull its weight — a wrapper that only forwards. Apply
"too simple to break": never add a test for trivial composition of already-trusted
parts. Reject premature abstraction.

### Refactor discipline — this is where rounds go wrong

- **Never change production code and test code in the same step.** Each step touches
  only tests or only production code, then run the suite to green before the next.
  Changing both at once means a green bar no longer proves the refactor was safe.
- One target per step, always.
- **If a step turns the suite red, revert that step** rather than chasing the failure.
- Grep for existing abstractions to reuse before inventing new ones.
- May move or extract code and create files, but never add behaviour or expand scope
  beyond the current test.

### Out-of-scope smells

While you have the context loaded, note architecture and code smells you spot that are
**unrelated** to the current round — god objects, leaky abstractions, missing seams,
dead code. **Do not fix them**; that blows the round's scope. Collect them as
`future_improvements`: location + smell + one-line suggested fix. Report them; act on
none.

## Ending the round

Commit and push per the delivery contract in your task instructions — in a pod, the
work dies with the container otherwise. Commit only on green; a red suite is never
pushed.

Report: the facet you closed, the facet you would take next, the post-refactor test
result, and the `future_improvements` list.
