# Tasks: Cross-Model Review

Spec: [spec.md](spec.md)

## Phase 1 — Shared policy helpers

- [x] T001 `modelFamily()` classifier: failing tests first in new `libs/shared/src/llm/model-family.test.ts`, then the implementation in new `libs/shared/src/llm/model-family.ts`
- [x] T002 `crossModelReviewWarning()` policy helper: failing tests appended to `libs/shared/src/llm/model-family.test.ts`, then the implementation appended to `libs/shared/src/llm/model-family.ts`; export both from `libs/shared/src/index.ts`

## Phase 2 — Interim cross-tier default

- [x] T003 Guard the `implementation` assembly line's cross-tier pin: test in new `libs/assembly-lines/src/implementation-review-tier.test.ts` (loads `implementation.yaml` via `loadAssemblyLineDir`, asserts `review`'s model differs from `implement`'s model, and asserts both currently classify to the `anthropic` family via `modelFamily()`); annotated `libs/assembly-lines/src/assembly-lines/implementation.yaml` with a comment recording the policy this test guards. Note: the pin already existed (sonnet vs haiku, unrelated cost tuning) so this test is a characterization/regression guard, not a red-green cycle — it passed on first run

## Phase 3 — Spec status + ADR retirement

- [x] T004 Status flipped In Progress → Shipped once all 8 testable statements carried links (T001 flipped Draft → In Progress with the first link); delete `adrs/ADR-039-cross-model-review.md` (superseded by this spec)

## Acceptance gate

- [x] `npx prettier --check` + `npx eslint` (0 errors) on every changed file
- [x] `libs/shared` vitest suite green, `libs/assembly-lines` vitest suite green
- [x] `require-spec-link` satisfied for every new `it(...)`
