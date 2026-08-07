# Feature Specification: Cross-Model Review

| Field   | Value                  |
|---------|------------------------|
| Feature | Cross-Model Review     |
| Branch  | feat/cross-model-review |
| Status  | Implemented            |
| Created | 2026-08-07             |
| Owner   | Platform Engineering   |

Cross-Model Review adds a vendor-neutral `modelFamily()` classifier and a `crossModelReviewWarning()` policy helper to `libs/shared/src/llm/model-family.ts`, and documents + guards the interim cross-tier default the `implementation` assembly line's review node already used. "Implemented" here means the two policy primitives are complete and exhaustively tested against real-world model-id forms, not that any production code path calls them yet — nothing in Lore's runtime resolves a model, calls `crossModelReviewWarning()`, or blocks a task on its result. Wiring a caller in is deliberately Out of Scope (see below); this spec is the tested substrate that follow-up work builds on.

## Problem Statement

LLMs favor their own generations. When the model that authored a change also reviews it, the reviewer tends to read what the author meant rather than what the diff says. This is the reason `danshapiro/fresheyes` exists as a standalone tool: it routes review to the opposite model family from the primary agent and reports that this catches defects same-family review misses.

Lore's implementation and review agents resolve their model through the same `lore.agent_definitions` chain (per-repo row, org-default row, `task-types.yaml` fallback), and nothing prevents implementer and reviewer from resolving to the same model family — the default state today. This is a structural self-preference bias wherever an agent both writes and reviews: the `implementation` assembly line's `implement` → `review` loop (the PRs that may later auto-merge under dark-factory mode), the autonomous review loop (`auto_review`), and the `code-review` assembly line (`libs/assembly-lines/src/assembly-lines/code-review.yaml`).

The full fix — routing review to a genuinely different provider — needs a second ai-agent-subsystem vendor (e.g. `openai-code`) that runs the review prompt against a different provider's API and emits the same `REVIEW_RESULT` marker the node contract parses; that vendor does not exist yet (see Out of Scope). This spec covers what is reachable today without it: a shared, testable policy for classifying a model id into a family and flagging same-family (or identical) implementer/reviewer pairs, plus documenting and guarding the interim cross-tier default already present on the `implementation` line.

## Functional Requirements

### FR1 — `modelFamily()` classifies a model id into a vendor family

- Classify a bare model id by its known tier or generation token — `claude-opus-*`/`claude-sonnet-*`/`claude-haiku-*` as `anthropic`, `gpt-3*`/`gpt-4*`/`gpt-5*`, `o1*`/`o3*`/`o4*`, or `chatgpt-*` as `openai`, `gemini-*` as `google` — case-insensitively and after trimming surrounding whitespace. ([validated by `model-family.test.ts:5`](../../libs/shared/src/llm/model-family.test.ts#L5), [`model-family.test.ts:9`](../../libs/shared/src/llm/model-family.test.ts#L9), [`model-family.test.ts:13`](../../libs/shared/src/llm/model-family.test.ts#L13), [`model-family.test.ts:17`](../../libs/shared/src/llm/model-family.test.ts#L17), [`model-family.test.ts:21`](../../libs/shared/src/llm/model-family.test.ts#L21), [`model-family.test.ts:25`](../../libs/shared/src/llm/model-family.test.ts#L25), [`model-family.test.ts:45`](../../libs/shared/src/llm/model-family.test.ts#L45))
- Classify a Bedrock-style id (`[region.]vendor.model`, e.g. `us.anthropic.claude-sonnet-4-5-...-v1:0`) and an OpenRouter-style id (`vendor/model`, e.g. `anthropic/claude-sonnet-4.5`) directly from the embedded vendor token, without needing the id to also match a bare-id tier pattern. ([validated by `model-family.test.ts:65`](../../libs/shared/src/llm/model-family.test.ts#L65), [`model-family.test.ts:71`](../../libs/shared/src/llm/model-family.test.ts#L71), [`model-family.test.ts:77`](../../libs/shared/src/llm/model-family.test.ts#L77), [`model-family.test.ts:81`](../../libs/shared/src/llm/model-family.test.ts#L81))
- Classify OpenAI's o-series reasoning ids (`o1`, `o3`, `o4-mini`, …) and `chatgpt-*` ids as `openai`, without misclassifying `ollama` — which merely starts with the letter `o`. ([validated by `model-family.test.ts:87`](../../libs/shared/src/llm/model-family.test.ts#L87), [`model-family.test.ts:91`](../../libs/shared/src/llm/model-family.test.ts#L91), [`model-family.test.ts:95`](../../libs/shared/src/llm/model-family.test.ts#L95), [`model-family.test.ts:99`](../../libs/shared/src/llm/model-family.test.ts#L99), [`model-family.test.ts:103`](../../libs/shared/src/llm/model-family.test.ts#L103))
- Classify an unrecognized bare id, an empty string, a whitespace-only string, or an undefined id as `unknown` rather than guessing — an unrecognized id must never be silently folded into an existing family. ([validated by `model-family.test.ts:29`](../../libs/shared/src/llm/model-family.test.ts#L29), [`model-family.test.ts:33`](../../libs/shared/src/llm/model-family.test.ts#L33), [`model-family.test.ts:37`](../../libs/shared/src/llm/model-family.test.ts#L37), [`model-family.test.ts:41`](../../libs/shared/src/llm/model-family.test.ts#L41))
- Reject two id forms a looser bare-prefix match would wrongly fold in: an EleutherAI `gpt-neox`/`gpt-j` id — servable through this repo's own `OllamaProvider` via `LORE_FACT_MODEL` — is not OpenAI, and `claude-code` — the ai-agent-subsystem execution-mode/vendor name, not a model id — is not a real Anthropic model id. ([validated by `model-family.test.ts:51`](../../libs/shared/src/llm/model-family.test.ts#L51), [`model-family.test.ts:55`](../../libs/shared/src/llm/model-family.test.ts#L55), [`model-family.test.ts:59`](../../libs/shared/src/llm/model-family.test.ts#L59))

### FR2 — `crossModelReviewWarning()` flags same-family implementer/reviewer pairs

- Return a warning message naming both models and their shared family when the implementer and reviewer model ids classify to the same known family, and a sharper message naming the single model when implementer and reviewer are the exact same model id — self-preference bias is strongest at identity, not just same-family. ([validated by `model-family.test.ts:109`](../../libs/shared/src/llm/model-family.test.ts#L109), [`model-family.test.ts:117`](../../libs/shared/src/llm/model-family.test.ts#L117))
- Return `null` when the implementer and reviewer model ids classify to different known families, or when either classifies as `unknown` — an unclassifiable model can't support a confident same-family claim in either direction. ([validated by `model-family.test.ts:125`](../../libs/shared/src/llm/model-family.test.ts#L125), [`model-family.test.ts:129`](../../libs/shared/src/llm/model-family.test.ts#L129), [`model-family.test.ts:135`](../../libs/shared/src/llm/model-family.test.ts#L135), [`model-family.test.ts:139`](../../libs/shared/src/llm/model-family.test.ts#L139))

### FR3 — Interim cross-tier default on the `implementation` assembly line (documented, now guarded)

- The `implementation` assembly line's `review` node already pinned a different model (`claude-haiku-4-5-20251001`) than its `implement` node (`claude-sonnet-4-6`) before this spec, as an artifact of unrelated cost tuning rather than a deliberate review-diversity policy. This spec makes that gap intentional: a regression test loads the real YAML and asserts the two models differ, and an inline comment on the `review` node's `model` field records why, so a future edit can't silently collapse the two nodes onto one model without the test going red. ([validated by `implementation-review-tier.test.ts:9`](../../libs/assembly-lines/src/implementation-review-tier.test.ts#L9))

## Alternatives rejected

- **A second same-family review pass.** Cheaper to configure, but redundant with the existing `review` → `address` loop and does not address the bias this spec targets.
- **N-model review panels.** Stronger but multiplies cost and latency per PR; revisit if cross-family review measurably under-catches once a second-provider vendor exists.
- **Hardcoding the family split in code.** The `agent_definitions` resolve chain already exists for exactly this kind of policy (per-repo override → org default → YAML fallback); encoding the split in code would bypass that override semantics.
- **Heuristic/fuzzy family guessing** (e.g. matching on substrings anywhere in the id, or inferring a vendor from a `LORE_LLM_PROVIDER` env default). A wrong guess is worse than an honest `unknown`: `gpt-neox-20b`/`gpt-j-6b` (EleutherAI, servable via this repo's `OllamaProvider`) and `claude-code` (a vendor/execution-mode name, not a model id) are real ids in this codebase's own vocabulary that a bare `startsWith("gpt")`/`startsWith("claude")` check would misclassify — `crossModelReviewWarning()` would then either miss a real same-family pair or flag two genuinely different ones.

## Consequences

- `modelFamily()` and `crossModelReviewWarning()` are pure, colocated, and have no callers outside their own tests yet — they exist to be reused wherever a model-family decision is made (a settings UI warning, a future `agent_definitions` validation), which is deliberately Out of Scope here (see below). This branch's entire runtime delta beyond the two new library functions is a documentation comment on one YAML field.
- The `implementation` line's cross-tier pin is now an intentional, tested policy instead of an unexplained artifact of unrelated cost tuning — but it stays a materially weaker mitigation than cross-family review: `modelFamily()` classifies both `claude-sonnet-4-6` and `claude-haiku-4-5-20251001` as `anthropic`, so `crossModelReviewWarning()` would correctly warn if it were wired against this exact pair. That wiring, and the vendor needed to actually change one side's family, are both deferred (see Out of Scope) — the gap is documented, not silently accepted as sufficient.

## Out of Scope

- **A second ai-agent-subsystem vendor (e.g. `openai-code`).** The `claude-code` vendor only calls the Anthropic API today; true cross-provider review needs a vendor that runs the review prompt against a different provider's API and emits the same `REVIEW_RESULT` marker the node contract parses. Scoped as a follow-up to ADR-031 (the ai-agent-subsystem vendor architecture).
- **Repointing `agent_definitions` org-default rows to a non-Anthropic model.** Blocked on the vendor above; a model id the `claude-code` vendor can't call would fail every review node at runtime.
- **Settings UI warning surfacing.** A settings-UI warning when a repo's implementer/reviewer overrides resolve to the same family is the natural consumer of `crossModelReviewWarning()`, but wiring it into the settings UI is a separate, UI-layer change.
- **Wiring the warning into `code-review.yaml` or other review-bearing assembly lines.** This spec scopes the interim tier pin to the `implementation` line only, since that is the loop that may later auto-merge under dark-factory mode; extending the same pin to `code-review`/`code-review-reply`/`comment-triage` (all of which carry the same structural bias, per Problem Statement) is a natural follow-up, not bundled here.
- **Runtime enforcement that blocks task creation or dispatch on a same-family pair.** `crossModelReviewWarning()` is advisory; nothing in this spec fails a task or a CI check when it fires.
