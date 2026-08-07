# Feature Specification: Cross-Model Review

| Field   | Value                  |
|---------|------------------------|
| Feature | Cross-Model Review     |
| Branch  | feat/cross-model-review |
| Status  | In Progress            |
| Created | 2026-08-07             |
| Owner   | Platform Engineering   |

Cross-Model Review supersedes [ADR-039](../../adrs/ADR-039-cross-model-review.md): it adds a vendor-neutral `modelFamily()` classifier and a `crossModelReviewWarning()` policy helper to `libs/shared/src/llm/model-family.ts`, and pins the implementation assembly line's review node to a different Anthropic tier than its implement node as the interim, immediately-available mitigation against self-preference bias.

## Problem Statement

LLMs favor their own generations. When the model that authored a change also reviews it, the reviewer tends to read what the author meant rather than what the diff says. Lore's implementation and review agents resolve their model through the same `lore.agent_definitions` chain (per-repo row, org-default row, `task-types.yaml` fallback) and nothing prevents implementer and reviewer from resolving to the same model family — the default state today. This is a structural self-preference bias on exactly the PRs that may later auto-merge under dark-factory mode.

The full fix — routing review to a genuinely different provider — needs a second ai-agent-subsystem vendor (`openai-code`) that does not exist yet (see Out of Scope). This spec covers what is reachable today without that vendor: a shared, testable policy for classifying a model id into a family and flagging same-family implementer/reviewer pairs, plus the interim cross-tier default the `implementation` assembly line can adopt immediately through its existing `agent_definitions`-driven model pins.

## Functional Requirements

### FR1 — `modelFamily()` classifies a model id into a vendor family

- Classify a model id starting with `claude` (case-insensitive) as `anthropic`, one starting with `gpt-` as `openai`, and one starting with `gemini` as `google`. ([validated by `model-family.test.ts:5`](../../libs/shared/src/llm/model-family.test.ts#L5), [`model-family.test.ts:9`](../../libs/shared/src/llm/model-family.test.ts#L9), [`model-family.test.ts:13`](../../libs/shared/src/llm/model-family.test.ts#L13), [`model-family.test.ts:17`](../../libs/shared/src/llm/model-family.test.ts#L17), [`model-family.test.ts:21`](../../libs/shared/src/llm/model-family.test.ts#L21))
- Classify an unrecognized model id, an empty string, or an undefined model id as `unknown` rather than guessing — an unrecognized id must never be silently folded into an existing family. ([validated by `model-family.test.ts:25`](../../libs/shared/src/llm/model-family.test.ts#L25), [`model-family.test.ts:29`](../../libs/shared/src/llm/model-family.test.ts#L29), [`model-family.test.ts:33`](../../libs/shared/src/llm/model-family.test.ts#L33))

### FR2 — `crossModelReviewWarning()` flags same-family implementer/reviewer pairs

- Return a warning message naming both models and their shared family when the implementer and reviewer model ids classify to the same known family. ([validated by `model-family.test.ts:39`](../../libs/shared/src/llm/model-family.test.ts#L39))
- Return `null` when the implementer and reviewer model ids classify to different known families. ([validated by `model-family.test.ts:50`](../../libs/shared/src/llm/model-family.test.ts#L50))
- Return `null`, not a warning, when either model id classifies as `unknown` — an unclassifiable model can't support a confident same-family claim in either direction. ([validated by `model-family.test.ts:54`](../../libs/shared/src/llm/model-family.test.ts#L54), [`model-family.test.ts:60`](../../libs/shared/src/llm/model-family.test.ts#L60), [`model-family.test.ts:64`](../../libs/shared/src/llm/model-family.test.ts#L64))
- Both helpers are exported from `@re-cinq/lore-shared` so any future caller (settings UI, agent-definitions validation) can reuse the same policy instead of re-deriving it.

### FR3 — Interim cross-tier default on the `implementation` assembly line

- The `implementation` assembly line (`libs/assembly-lines/src/assembly-lines/implementation.yaml`) pins its `review` node to a different model than its `implement` node, so the two agent calls in the loop that most needs review diversity are never a single call grading its own output twice.
- Until the `openai-code` vendor (see Out of Scope) exists, both models necessarily resolve to the same `anthropic` family under `modelFamily()` — this is recorded as a known, accepted gap rather than left silent.

## Alternatives rejected

- **A second same-family review pass.** Cheaper to configure, but redundant with the existing `review` → `address` loop and does not address the bias this spec targets.
- **N-model review panels.** Stronger but multiplies cost and latency per PR; revisit if cross-family review measurably under-catches once the `openai-code` vendor exists.
- **Hardcoding the family split in code.** The `agent_definitions` resolve chain already exists for exactly this kind of policy (per-repo override → org default → YAML fallback); encoding the split in code would bypass that override semantics.
- **Heuristic/fuzzy family guessing** (e.g. matching on substrings anywhere in the id, or inferring a vendor from a `LORE_LLM_PROVIDER` env default). A wrong guess is worse than an honest `unknown`, since `crossModelReviewWarning()` would then either miss a real same-family pair or flag two genuinely different ones.

## Consequences

- `modelFamily()` and `crossModelReviewWarning()` are pure, colocated, and have no callers outside their own tests yet — they exist to be reused wherever a model-family decision is made (a settings UI warning, a future agent-definitions validation), which is out of scope here (see below).
- The `implementation` line's review model was already `claude-haiku-4-5-20251001` against an `implement` model of `claude-sonnet-4-6` — incidentally cross-tier, but undocumented and unguarded. This spec makes the pin an intentional, tested policy instead of an artifact of unrelated cost tuning.
- Cross-tier review inside one family is a materially weaker mitigation than cross-family review; `modelFamily()` reports both models as `anthropic` today, and `crossModelReviewWarning()` would correctly warn if it were wired against this pair. That wiring is deferred (see Out of Scope) — the pair is documented as a known gap, not silently accepted as sufficient.

## Out of Scope

- **The `openai-code` (or equivalent) ai-agent-subsystem vendor.** The `claude-code` vendor only calls the Anthropic API; true cross-provider review needs a vendor that runs the review prompt against a different provider's API and emits the same `REVIEW_RESULT` marker the node contract parses. Scoped as a follow-up to ADR-031, tracked by ADR-039's Prerequisites section.
- **Repointing `agent_definitions` org-default rows to a non-Anthropic model.** Blocked on the vendor above; a model id the `claude-code` vendor can't call would fail every review node at runtime.
- **Settings UI warning surfacing.** ADR-039 names a settings-UI warning when a repo's implementer/reviewer overrides resolve to the same family; `crossModelReviewWarning()` is built to support that, but wiring it into the settings UI is a separate, UI-layer change.
- **Wiring the warning into `code-review.yaml` or other review-bearing assembly lines.** This spec scopes the interim tier pin to the `implementation` line only, per the ADR's focus on the auto-merge-eligible loop; extending the same pin to `code-review`/`code-review-reply`/`comment-triage` is a natural follow-up, not bundled here.
- **Runtime enforcement that blocks task creation or dispatch on a same-family pair.** `crossModelReviewWarning()` is advisory; nothing in this spec fails a task or a CI check when it fires.
