---
name: testing
description: Behaviour-driven testing rules for any repo and runner. Use when writing tests, building test factories, structuring test files, or deciding what to test. Not for UI-specific testing (see front-end-testing or react-testing).
---

# Testing Patterns

Use the test runner, assertion style and libraries the repo already has; never introduce a new one. The examples are TypeScript, the rules are language-neutral. For the red-green-refactor loop itself see `tdd-loop`; for judging test quality see `test-design-reviewer`; for checking that tests catch bugs see `mutation-testing`.

## Test behaviour through the public API

Tests call the public API and assert on what it returns or causes. They never reach for private methods, internal state, or a spy on a collaborator the caller did not provide.

Wrong: asserts HOW.

```typescript
it("calls validateAmount", () => {
  const spy = vi.spyOn(validator, "validateAmount");
  processPayment(payment);
  expect(spy).toHaveBeenCalled();
});
```

Right: asserts WHAT, on the whole result value.

```typescript
it("rejects an amount of -100", () => {
  const result = processPayment(getMockPayment({ amount: -100 }));
  expect(result).toEqual({ success: false, error: "Amount must be positive" });
});
```

Assert on the whole value, not on `result.success` followed by `result.error`: a boolean check does not narrow a discriminated union, and the whole-value assertion is stronger against mutants.

## Name the data and the outcome

A test name carries the tested data and the expected outcome, and reads as a sentence with `it`: `it("rejects an amount of -100")`, `it("returns 0 for an empty list")`. Never "should".

## Coverage comes through behaviour

`payment-validator.ts` is fully covered by testing `processPayment()` with a negative amount, an amount over the limit, a bad CVV and a valid payment. When coverage drops, ask which business behaviour is untested, not which line is missing.

Cover the boundary (`100` as well as `150` for `>= 100`), each branch, and each side effect, so a realistic mutant (flipped operator, removed statement) fails a test. A line executed without an assertion on its effect is not covered.

## Do not extract for testability

Extract a function for readability or because the same knowledge is used in several places, never to give it its own test file. A single-use helper is an implementation detail of its consumer and is covered by the consumer's behaviour tests. Where a helper really is shared, test it through each consumer.

## No 1:1 mapping between test files and source files

Organise tests by behaviour: `payment-processing.test.ts` may exercise a validator, a gateway and a formatter that live in three source files. Refactoring the source layout must not force a test move.

## Factories with overrides, validated by the real schema

Build test data with a factory that returns a complete, valid object and accepts overrides. Validate with the production schema, never a copy redefined in the test, so an invalid fixture fails loudly. Each test calls the factory, so there is no shared mutable state: no `let`, no `beforeEach` for data.

```typescript
const getMockPayment = (overrides: Partial<Payment> = {}): Payment =>
  PaymentSchema.parse({
    amount: 100,
    currency: "GBP",
    cvv: "123",
    ...overrides,
  });
```

Compose factories for nested data (`getMockOrder({ payment: getMockPayment({ amount: 5 }) })`). When only a few fields matter to callers, type the overrides as `Partial<Pick<T, "a" | "b">>`.

## Exception: a callback passed in is output

When a component or function takes a callback (`onSubmit`), the callback contract is its output, so `expect(onSubmit).toHaveBeenCalledWith(...)` is behaviour testing. What stays forbidden is mocking the function under test, or asserting only that something was called.

## Checklist

- Behaviour through the public API, whole values asserted
- Name states data and outcome, no "should"
- Boundary, branches and side effects covered
- Factories validated by the real schema; no `let`/`beforeEach`
- No 1:1 test-to-file mapping

## Attribution

Adapted from the `testing` skill in [citypaul/.dotfiles](https://github.com/citypaul/.dotfiles/tree/main/claude/.claude/skills/testing), Copyright (c) 2024 Paul Hammond, MIT licence. Modified by re:cinq: rewritten much shorter as a single file, with one example per rule and a Help section added. Licence text: `THIRD_PARTY_NOTICES.md` in [re-cinq/lore](https://github.com/re-cinq/lore/blob/main/THIRD_PARTY_NOTICES.md).

## Help

<!-- lore-help:begin -->
**Summary.** Write behavior-driven tests with test factories and a clear file structure, and decide what is worth testing.
**Usage:** `/testing`
**Use when.** You are writing or restructuring tests and need to choose what to assert and how to build test data.
**Related:** `/front-end-testing`, `/react-testing`, `/test-design-reviewer`
<!-- lore-help:end -->
