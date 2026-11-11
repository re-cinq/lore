---
name: test-design-reviewer
description: Review test quality using Dave Farley's eight properties of good tests. Use when assessing a test file or suite for understandability, maintainability, repeatability, atomicity, necessity, granularity, speed, and evidence of test-first development.
context: fork
agent: Explore
model: claude-sonnet-4-6
---

Review tests as executable specifications and safety evidence. Read the tests before the implementation so their public story can stand on its own, then inspect the production boundary and repository constraints needed to judge the claims accurately. The eight properties come from Dave Farley's [Properties of Good Tests](https://www.linkedin.com/pulse/tdd-properties-good-tests-dave-farley-iexge/).

## Properties

| Property | Inspect | Strong evidence |
|---|---|---|
| Understandable | Names, arrange/act/assert flow, domain vocabulary | The behavior and failure are clear without reconstructing internals |
| Maintainable | Coupling, duplication, fixtures, public boundaries | Behavior-preserving refactors do not require unrelated test rewrites |
| Repeatable | Time, randomness, concurrency, network, shared resources | Repeated and parallel runs have controlled inputs and cleanup |
| Atomic | Shared state, ordering, cleanup, failure isolation | A test can run alone and its failure identifies one behavior |
| Necessary | Distinct risk or contract protected | Removing the test would remove meaningful evidence |
| Granular | Scope of behavior and diagnostic quality | Assertions describe one coherent outcome; related assertions may stay together |
| Fast | Measured feedback time at the appropriate layer | The suite is fast enough for its intended feedback loop |
| First | Evidence of test-first development | A captured RED run, development trace, or history shows the test failed for the expected reason before production behavior changed |

## Rating

Rate each property `Strong`, `Mixed`, `Weak`, or `Not assessed`.

- Use exact file locations and observed evidence.
- Do not calculate an aggregate score; unequal risks and repository contexts make a weighted number falsely precise.
- Mark **First** `Not assessed` when only the final tree is available. Static test shape cannot prove chronology.
- Mark **Fast** `Not assessed` unless execution evidence or trustworthy timing is available.
- Prefer the smallest change that strengthens observable behavior. Do not demand one assertion per test, one test per file, or unit tests where a higher-level contract is the honest evidence boundary.

## Review process

1. Establish the claimed behavior, test layer, repository policy, and relevant risk.
2. Read the tests without the implementation and record what a failure would mean.
3. Inspect the public production boundary, fixtures, and configured runner.
4. Run focused tests or timing only when authorized and useful; report exactly what ran.
5. Rate every property with evidence, including `Not assessed` where evidence is absent.
6. Rank only actionable findings by severity and impact, each with the smallest credible fix.
7. Separate test defects from production-design seams and local policy preferences.

## Output

```markdown
## Test design review: [scope]

| Property | Rating | Evidence |
|---|---|---|
| Understandable | Strong/Mixed/Weak/Not assessed | [file:line and reason] |
| ... one row per property ... | | |

### Findings

1. **[severity] - [problem]** (`path:line`)
   Impact: [observable risk].
   Smallest fix: [action].

### Validation gaps

- [Anything not assessed and the evidence needed]
```

No findings is a valid result; do not invent work to populate the section.

## Attribution

Adapted from the `test-design-reviewer` skill in [citypaul/.dotfiles](https://github.com/citypaul/.dotfiles/tree/main/claude/.claude/skills/test-design-reviewer), Copyright (c) 2024 Paul Hammond, MIT licence. Modified by re:cinq: shortened into a single file and a Help section added. Licence text: `THIRD_PARTY_NOTICES.md` in [re-cinq/lore](https://github.com/re-cinq/lore/blob/main/THIRD_PARTY_NOTICES.md).

## Help

<!-- lore-help:begin -->
**Summary.** Rate the quality of tests against Dave Farley's eight properties of good tests.
**Usage:** `/test-design-reviewer`
**Use when.** You are reviewing a test suite or a change's tests and want an evidence-based assessment of how well they would catch regressions.
**Related:** `/testing`, `/mutation-testing`
<!-- lore-help:end -->
