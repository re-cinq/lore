---
name: tdd-start
description: "Start a project or feature using strict TDD Red-Green-Refactor cycle. Use when building new functionality test-first."
---

# TDD Instructions

## The Three Laws of TDD

1. Do not write production code unless it is to make a failing test pass.
2. Do not write more of a unit test than is sufficient to fail (compilation failures count).
3. Do not write more production code than is sufficient to make the currently failing test pass.

## The Red-Green-Refactor Cycle

### Red
- Write one failing test.
- Run the test and confirm it fails for the expected reason.
- Do not write any production code yet.

### Green
- Write the simplest code that makes the failing test pass.
- "Simplest" means fewest lines, not most elegant — hardcoding is acceptable at this stage.
- Run the tests you are working on and confirm they pass before moving on.

### Refactor
- Clean up duplication and improve clarity in both production and test code.
- Do not change behaviour — all tests must remain green throughout refactoring.
- Run the tests you are working on after every small change.

## Guidelines

- **One test at a time.** Never write a second failing test while the first is still red, unless asked to go faster.
- **Commit on green.** A passing test suite is a stable checkpoint; commit before refactoring.
- **Triangulate.** If the simplest implementation is to hardcode a value, write a second test that forces a general solution.
- **Test behaviour, not implementation.** Tests should describe what the code does, not how it does it.
- **Keep tests fast.** Slow tests discourage running them; aim for sub-second feedback.
- **Delete dead tests.** A test that no longer adds coverage or documents behaviour is noise — remove it.

## Test Naming Convention

A test name carries the tested data and the expected outcome, reads as a sentence with `it`, and never says "should": `returns I for 1`, `throws RangeError for 0`, `rejects an amount of -100`. Mirror the naming already used in the repo's tests.

## What Makes a Good First Test

- The simplest possible case (e.g. `toRoman(1) === "I"`).
- Forces the function signature to exist.
- Can be made green in one or two lines of production code.

## Refactoring Checklist

Review **both production and test code** for every item below before declaring the refactor done.

- [ ] No duplicated logic in production code
- [ ] No duplicated structure in test code (use a parameterised test or a factory function with overrides)
- [ ] Names clearly describe intent
- [ ] No commented-out code
- [ ] All tests still pass

## Help

<!-- lore-help:begin -->
**Summary.** Start a project or feature with a strict Red-Green-Refactor cycle, one failing test at a time.
**Usage:** `/tdd-start`
**Use when.** You are building new functionality test-first and want the three laws of TDD enforced step by step.
**Related:** `/tdd-loop`, `/testing`
<!-- lore-help:end -->
