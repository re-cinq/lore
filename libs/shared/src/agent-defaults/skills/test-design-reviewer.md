---
name: test-design-reviewer
description: Evaluates test quality using Dave Farley's 8 properties. Use when reviewing tests, assessing test suite quality, or analyzing test effectiveness against TDD best practices.
context: fork
agent: Explore
model: claude-sonnet-4-6
---

Review the given tests against Dave Farley's eight properties of good tests (https://www.linkedin.com/pulse/tdd-properties-good-tests-dave-farley-iexge/). Read the tests before the implementation. Score each property from 1 to 10 with evidence from the code, and score conservatively when unsure about test-first adherence.

## The eight properties

| Property | High score (9-10) | Low score (1-3) |
|---|---|---|
| Understandable (U) | Reads like a specification; intent is clear without the implementation | Cryptic; leans on implementation details |
| Maintainable (M) | Proper abstractions; implementation changes rarely break tests | Tightly coupled; minor changes break tests |
| Repeatable (R) | Deterministic, same result anywhere | Depends on external state or timing |
| Atomic (A) | Isolated, no shared state, parallelizable | Order-dependent, heavy interdependence |
| Necessary (N) | Every test adds value, no redundancy | Many tests add nothing or repeat each other |
| Granular (G) | One behaviour per test; a failure pinpoints the issue | Sprawling tests; failures need investigation |
| Fast (F) | Milliseconds; the suite runs quickly | Slow enough to hurt the development flow |
| First (T) | Evidence of test-first; tests drove the design | Written after the code; mirrors its structure |

## Farley Score

```
Farley Score = (U×1.5 + M×1.5 + R×1.25 + A×1.0 + N×1.0 + G×1.0 + F×0.75 + T×1.0) / 9
```

9.0-10: exemplary; 7.5-8.9: excellent; 6.0-7.4: good; 4.5-5.9: fair; 3.0-4.4: poor; below 3.0: critical, consider rewriting.

## Output format

```
## Test Design Review: [File/Suite Name]

| Property | Score | Evidence |
|----------|-------|----------|
| Understandable | X/10 | [brief justification] |
| Maintainable | X/10 | [brief justification] |
| Repeatable | X/10 | [brief justification] |
| Atomic | X/10 | [brief justification] |
| Necessary | X/10 | [brief justification] |
| Granular | X/10 | [brief justification] |
| Fast | X/10 | [brief justification] |
| First (TDD) | X/10 | [brief justification] |

### Farley Score: X.X/10 [Rating]

### Top Recommendations
1. [Highest impact improvement, with a code example where it helps]
2. [Second priority]
3. [Third priority]
```

Acknowledge what is done well, be specific, give both individual and aggregate scores for several files, and end with the link to Dave Farley's article above.

## Attribution

Adapted from [Andrea Laforgia's claude-code-agents repository](https://github.com/andrealaforgia/claude-code-agents/blob/main/alf-test-design-reviewer/alf-test-design-reviewer.md).

## Help

<!-- lore-help:begin -->
**Summary.** Score the quality of tests against Dave Farley's eight properties of good tests.
**Usage:** `/test-design-reviewer`
**Use when.** You are reviewing a test suite or a change's tests and want a scored assessment of how well they would catch regressions.
**Related:** `/testing`, `/mutation-testing`
<!-- lore-help:end -->
