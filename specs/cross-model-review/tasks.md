# Tasks: Cross-Model Review

Spec: [spec.md](spec.md)

## Phase 1 — Shared policy helpers

- [x] T001 `modelFamily()` classifier: failing tests first in new `libs/shared/src/llm/model-family.test.ts`, then the implementation in new `libs/shared/src/llm/model-family.ts`
- [x] T002 `crossModelReviewWarning()` policy helper: failing tests appended to `libs/shared/src/llm/model-family.test.ts`, then the implementation appended to `libs/shared/src/llm/model-family.ts`; export both from `libs/shared/src/index.ts`

## Phase 2 — Interim cross-tier default

- [x] T003 Guard the `implementation` assembly line's cross-tier pin: test in new `libs/assembly-lines/src/implementation-review-tier.test.ts` (loads `implementation.yaml` via `loadAssemblyLineDir`, asserts `review`'s model differs from `implement`'s model); annotated `libs/assembly-lines/src/assembly-lines/implementation.yaml` with a comment recording the policy this test guards. Note: the pin already existed (sonnet vs haiku, unrelated cost tuning) so this test is a characterization/regression guard, not a red-green cycle — it passed on first run

## Phase 3 — Spec status + ADR retirement

- [x] T004 Status flipped In Progress → Shipped once all 8 testable statements carried links (T001 flipped Draft → In Progress with the first link); delete `adrs/ADR-039-cross-model-review.md` (superseded by this spec)

## Phase 4 — Cross-model review round (Opus review, 2026-08-07)

A different model reviewed the branch and returned BLOCK on four defects; all four fixed, TDD, same constraints (no push/PR).

- [x] T005 Blocker 1 + 2 — `modelFamily()` was folding imposter ids into a family (`gpt-neox-20b`/`gpt-j-6b` → openai, `claude-code` → anthropic) and fail-opening to `unknown` on every real-world id form (Bedrock `region.vendor.model`, OpenRouter `vendor/model`, the o-series/`chatgpt-*` OpenAI ids, untrimmed whitespace). Failing tests first (18 new cases across bare/imposter/vendor-prefixed/o-series groups in `model-family.test.ts`), then narrowed the bare-id patterns to known tier/generation tokens and added vendor-prefix stripping for Bedrock + OpenRouter forms
- [x] T006 Also-do — `crossModelReviewWarning()` now special-cases `implementerModel === reviewerModel` with a sharper identity message (self-preference bias is strongest at identity); simplified the multi-`toMatch` assertion to a single `toBe`; dropped the "package exports" test + FR2 bullet (packaging fact, not behavior — was padding the coverage denominator)
- [x] T007 Blocker 3 — `implementation-review-tier.test.ts` no longer hard-asserts both models resolve to `anthropic`; that assertion would go red the moment the feature succeeds (review repointed to a different family). Dropped the assertion, kept the family-agnostic "models differ" test and the YAML comment
- [x] T008 Should-fix 4 — scrubbed all 6 references to the deleted ADR-039 (`spec.md:11,53,55`, `model-family.ts:2,36`, `implementation.yaml:30`); carried its still-live content into `spec.md` (fresheyes provenance, the `code-review.yaml`/`auto_review` scoping, the concrete `openai-code` vendor prerequisites)
- [x] T009 Rebased onto `origin/main` (`#1087`), recomputed every `#Lnnn` anchor from scratch (structural test-file rewrite shifted nearly all of them), re-verified prettier/eslint/vitest/tsc

### Disagreement on record: Status stays `Shipped`, not `In Progress`

The review asked for a downgrade to `In Progress` on the grounds that this branch's entire runtime delta is a YAML comment plus two library functions nothing calls yet. That's an accurate description of the delta, but it isn't a valid *reason* to write `In Progress` into the header: `specs/spec-status-upkeep/spec.md` establishes, as enforced repo convention, that status is a **mechanical function of test-link coverage**, not a subjective completeness judgment — that's the entire point of the ladder (see that spec's "Adoption" section: the whole corpus was demoted specifically to stop status from meaning "vibes"). With every testable statement in this spec linked, `lore/require-status-matches-coverage` treats `In Progress` as an ERROR, not `Shipped` — there is no coverage-legitimate way to write `In Progress` here without either breaking the `0 errors` constraint or manufacturing an artificial unlinked FR for work this task's own scope note put Out of Scope. Addressed the substantive worry instead by rewording the lead paragraph to say explicitly what `Shipped` does and does not mean here (tested primitives, zero runtime callers) — see spec.md's second paragraph.

## Acceptance gate

- [x] `npx prettier --check` + `npx eslint` (0 errors) on every changed file
- [x] `libs/shared` vitest suite green, `libs/assembly-lines` vitest suite green
- [x] `require-spec-link` satisfied for every new `it(...)`
- [x] Every `#Lnnn` spec anchor rechecked against the post-rewrite file (30 links, 30 `it()`s, exact match)
