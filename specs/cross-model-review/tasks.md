# Tasks: Cross-Model Review

Spec: [spec.md](spec.md)

## Phase 1 — Shared policy helpers

- [ ] T001 `modelFamily()` classifier: failing tests first in new `libs/shared/src/llm/model-family.test.ts`, then the implementation in new `libs/shared/src/llm/model-family.ts`
- [ ] T002 `crossModelReviewWarning()` policy helper: failing tests appended to `libs/shared/src/llm/model-family.test.ts`, then the implementation appended to `libs/shared/src/llm/model-family.ts`; export both from `libs/shared/src/index.ts`

## Phase 2 — Interim cross-tier default

- [ ] T003 Guard the `implementation` assembly line's cross-tier pin: failing test first in new `libs/assembly-lines/src/implementation-review-tier.test.ts` (loads `implementation.yaml` via `loadAssemblyLineDir`, asserts `review`'s model differs from `implement`'s model, and asserts both currently classify to the `anthropic` family via `modelFamily()`), then annotate `libs/assembly-lines/src/assembly-lines/implementation.yaml` with a comment recording the policy this test guards

## Phase 3 — Spec status + ADR retirement

- [ ] T004 Flip `specs/cross-model-review/spec.md`'s `| Status |` row to `In Progress` in the same commit as T001's first test link; delete `adrs/ADR-039-cross-model-review.md` (superseded by this spec)

## Acceptance gate

- [ ] `npx prettier --check` + `npx eslint` (0 errors) on every changed file
- [ ] `libs/shared` vitest suite green, `libs/assembly-lines` vitest suite green
- [ ] `require-spec-link` satisfied for every new `it(...)`
