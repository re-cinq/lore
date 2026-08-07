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

### Resolved: `Shipped` → `Implemented` (bucket-preserving, not a re-opened disagreement)

My original pushback (`In Progress` is impossible without breaking the `0 errors` constraint or inventing an unlinked FR) held up. But the follow-up correction was right: `lore/require-status-matches-coverage` compares **buckets**, not literal strings — `libs/shared/src/spec-status.ts`'s `shipped` bucket regex is `/^(shipped|implemented|complete|accepted|done|live)/`, verified directly in that file and in the rule's actual comparison path (`status-coverage.mjs`'s `statusMismatch`, which diffs `parseDocStatus(...).status` against `expectedStatus(...)`, both bucket values). So `Implemented` satisfies the lint rule exactly as `Shipped` does, while reading honestly for a branch that is unmerged and undeployed — and matches a sibling branch in the identical position, standardizing how the org's fully-linked-but-unmerged specs report their state. Changed `| Status |` to `Implemented`; kept the reworded lead paragraph (now saying "Implemented" instead of "Shipped").

## Phase 5 — Fable re-review (2026-08-07)

Fable re-reviewed the fix round: APPROVE-WITH-NITS, verified by running (not just reading) every id this repo configures. One should-fix, a good catch.

- [x] T010 `KNOWN_MODELS` (`libs/shared/src/project/agents/agent-defs-port.ts:31`, the Agents tab's curated model dropdown) includes `claude-fable-5`, which `ANTHROPIC_BARE_ID`'s `(opus|sonnet|haiku)` alternation missed — `modelFamily("claude-fable-5")` read `unknown`, so a Fable-5 reviewer against a Sonnet implementer got no same-family warning. Failing tests first (`claude-fable-5` case + a guard iterating the real `KNOWN_MODELS` array asserting none classify `unknown`), then added `fable` to the alternation. The guard test earned its own FR1 bullet so the next dropdown addition can't silently repeat this
- [x] T011 Documented the accepted gen-first-legacy-id limitation (`claude-3-opus-20240229` etc. read `unknown`) as a Consequences bullet, per the review's optional ask — not present on any config surface here, left as-is

## Phase 6 — Owner directive: repoint the pin to real Sonnet/Opus separation (2026-08-07)

The owner directed repointing `review` → `claude-sonnet-4-6` and `implement` → `claude-opus-4-8` (from `KNOWN_MODELS`), to turn FR3 from documentation into delivery. Verified `KNOWN_MODELS` (`libs/shared/src/project/agents/agent-defs-port.ts:31`) does carry a single `claude-opus-4-8` entry, matching the candidate.

**Investigated per ask #4 ("check nothing else pins those nodes' models... if a DB-seeded row would override the YAML, say so clearly") and found something bigger than a conflicting override: the assembly-line node's `model:` field is never read by the CR-dispatch path at all, for either node, today or after the requested edit.** Traced end to end (full citation trail now in spec.md's Known Limitations):

- `nodeAgentSpec` sets `model: node.model` on `LoreTaskSpec`, but `specToAgent` (which builds the real `Agent` CR) never reads it — `AgentSpec` (`@re-cinq/agent-contracts`) has no `model` field.
- The deployed model comes from the `Station`/`AgentDefinition` a node's `station_ref` resolves to, or — absent one — `spec.taskType` (`catalogLookupName`, `apps/floor/src/jobs/station/per-task-token.ts`); `injectRepoToken`'s own comment says the clone "preserves" the catalog model unchanged.
- Neither `implement` nor `review` sets `station_ref`. Both resolve to `spec.taskType` = `"implementation"` (the assembly line's constant `definitionName`), i.e. the **same** catalog `Station` — seeded one-per-task-type from `scripts/task-types.yaml` (`apps/floor/src/jobs/agent/agent-catalog.ts` — "one Station per task type"; `apps/floor/src/delivery/gen-catalog.ts` reads only `task-types.yaml`, never the assembly-line YAML directory).
- So `implement` and `review` have always run the identical model (`claude-sonnet-4-6`, the `implementation` task type's catalog default) — never the YAML's declared `claude-haiku-4-5-20251001` for review. The prior rounds' shared premise ("pin pre-existed as incidental cost tuning") was itself unverified against the dispatch code; it never actually saved a cent, because it never took effect.
- A working escape hatch already exists in this codebase: `code-review-reply.yaml` sets `station_ref: code-review-refine` to borrow a different task type's catalog model. The same pattern (`review` node gets `station_ref: review`, plus bumping `scripts/task-types.yaml`'s `review:`/`implementation:` model fields and re-running `npm run gen:catalog`) would make the directive real — but that touches the standalone `review` task type used by the org-wide autonomous review loop and the `implementation` task type's non-assembly-line default, a production blast radius well beyond this one node.

**Decision: did not make the literal edit.** Repointing the YAML's two `model:` values (to `claude-opus-4-8`/`claude-sonnet-4-6` or anything else) would be exactly as inert as the values it replaces — the coordinator's own task-4 warning ("a YAML change that production ignores would be a worse lie than the comment-only version") applies directly, and a *bigger*-looking but equally-fake change is worse than the status quo, not better. Did not touch `scripts/task-types.yaml` or the generated catalog chart either — that is a real, org-wide production/cost decision (the standalone `review` task type backs the autonomous review loop for every repo) that needs its own explicit sign-off, not a side effect of this spec branch's fix round. This is squarely the kind of call the owner needs to make, per instruction #5's own invitation to push back rather than comply silently.

**What was safely done**: corrected FR3 and Consequences to stop describing this as an effective (if weak) mitigation — it is a guarded *declaration*, not an enforced property; added a `## Known Limitations` section (spec.md) with the full trace and the two real options; updated the `review` node's YAML comment (comment-only, safe) to say the same. No test-value change, since asserting `review == claude-sonnet-4-6` / `implement == claude-opus-4-8` would encode a claim about deployed behavior that is not true and that this round did not make true.

- [x] T012 Investigated the CR-dispatch path (`nodeAgentSpec` → `specToAgent` → `catalogLookupName`/`injectRepoToken` → `agent-catalog.ts`/`gen-catalog.ts`); confirmed the assembly-line node `model:` field has no effect without an explicit `station_ref`, and neither `implement` nor `review` sets one
- [x] T013 Declined to make the literal model-value repoint (would be equally inert); declined to wire `station_ref` + `task-types.yaml` (production blast radius beyond this branch, needs owner sign-off) — pushed back per instruction #5 with the full evidence trail
- [x] T014 Corrected `spec.md` FR3 + Consequences out of "effective mitigation" framing into "guarded declaration, not yet enforced"; added `## Known Limitations` with the citation trail and the two real options; updated the YAML comment to match (comment-only)

## Acceptance gate

- [x] `npx prettier --check` + `npx eslint` (0 errors) on every changed file
- [x] `libs/shared` vitest suite green, `libs/assembly-lines` vitest suite green
- [x] `require-spec-link` satisfied for every new `it(...)`
- [x] Every `#Lnnn` spec anchor rechecked against the post-rewrite file (32 links, 32 `it()`s, exact match — unchanged this round, no test file touched)
