# Feature Specification: Cross-Model Review for Agent-Authored Changes

| Field   | Value                                         |
| ------- | --------------------------------------------- |
| Feature | Cross-Model Review for Agent-Authored Changes |
| Branch  | docs/convert-field-survey-adrs-to-specs       |
| Status  | Shipped                                       |
| Created | 2026-08-07                                    |
| Owner   | Platform Engineering                          |

Cross-Model Review moves the review of agent-authored code onto a different
model than the model that authored the change, countering self-preference
bias. The interim (single-vendor) step is cross-tier review inside the
Anthropic family; the end state is cross-family review, expressed entirely
through existing `lore.agent_definitions` rows and their resolve chain.

## Problem Statement

LLMs recognize and favor their own generations. When the same model family
both writes and reviews a change, the reviewer tends to read what the author
meant rather than what the diff says. This is the entire reason
danshapiro/fresheyes exists as a standalone tool: it routes review to the
opposite model family from the primary agent and reports that this catches
defects same-family review misses.

Lore's implementation and review agents resolve their model through the
same `lore.agent_definitions` chain (per-repo row, org-default row,
`task-types.yaml` fallback). Nothing prevented — and the defaults produced —
implementer and reviewer running on the same model. The autonomous review
loop (`auto_review`) and the code-review assembly line
(`libs/assembly-lines/src/assembly-lines/code-review.yaml`) therefore
carried a structural self-preference bias on exactly the PRs that may later
auto-merge under dark-factory mode.

## Background — the vendor prerequisite

The ai-agent-subsystem's `claude-code` vendor only calls the Anthropic API
today, so cross-provider review is not reachable by row edits alone: the
subsystem needs a second vendor (e.g. `openai-code`) that runs the review
prompt against the OpenAI API and emits the same `REVIEW_RESULT` marker the
node contract parses. That vendor is scoped as a follow-up to ADR-031.

Decision: while the second vendor is pending, the review defaults pin a
*different Anthropic model tier* than the implementation defaults — weaker
than family-level separation, but immediately available through the
resolve chain. Once the vendor lands, the org-default review row moves to
the cross-family flagship (`gpt-5.6` at time of writing), and vice versa
for OpenAI-authored changes.

## Functional Requirements

### FR1 — Cross-tier defaults (the interim step)

- The implementation assembly line pins its bot-review node to a different model tier than its implement node, so the shipped default never has one model grading its own diff. ([validated by `loader.test.ts:781`](libs/assembly-lines/src/loader.test.ts#L781))

### FR2 — The same-family policy helpers

- `modelFamily()` classifies a model id into its provider family (anthropic / openai / google), returning `unknown` rather than guessing for ids it cannot place. ([validated by `model-family.test.ts:5`](libs/shared/src/llm/model-family.test.ts#L5))
- `crossModelReviewWarning()` returns a warning when implementer and reviewer resolve to the same model family — the input the settings surface renders when a per-repo override collapses author and reviewer back onto one family. ([validated by `model-family.test.ts:20`](libs/shared/src/llm/model-family.test.ts#L20))
- The warning is sharpest when the reviewer is the exact model that authored the change — the reviewer would grade its own homework. ([validated by `model-family.test.ts:29`](libs/shared/src/llm/model-family.test.ts#L29))
- No warning is produced for cross-family pairs, and none when either family is unknown — a policy helper must never scold on a guess. ([validated by `model-family.test.ts:16`](libs/shared/src/llm/model-family.test.ts#L16), [`model-family.test.ts:39`](libs/shared/src/llm/model-family.test.ts#L39))

## Rationale — no new mechanism

The policy is expressed entirely through existing `agent_definitions` rows
and their resolve chain (per-repo row → org-default row →
`task-types.yaml`/code fallback). No code path hardcodes the family split;
encoding it in code would bypass per-repo override semantics. When an
implementation task's model is overridden per-repo, the repo owner is
responsible for keeping the review model cross-family — which is what the
FR2 warning exists to surface.

## Out of scope (follow-up)

- The `openai-code` vendor itself (the ADR-031 follow-up named under
  Background) and the org-default row flip to `gpt-5.6` that depends on it.
- Rendering `crossModelReviewWarning()` in the repo agents settings UI —
  the helper ships first; the settings surface adopts it with its next
  change.
- Validating the review prompt in `task-types.yaml` against the chosen
  cross-family model once the vendor exists.

## Alternatives rejected

- **A second same-family review pass.** Cheaper to configure, but redundant
  with the existing loop and does not address the bias the change targets.
- **N-model review panels.** Stronger but multiplies cost and latency per PR;
  can be revisited if cross-family review measurably under-catches.
- **Hardcoding the family split in code.** The resolve chain already exists
  for exactly this kind of policy; encoding it in code would bypass per-repo
  override semantics.

## Consequences & Risks

- The interim step (different Anthropic tier) is config-only and reversible
  by editing rows or the definition YAML; the full cross-provider step
  additionally requires the vendor named under Background.
- Review quality on agent-authored PRs stops depending on a model grading
  its own homework; this strengthens the `bot APPROVED` input to
  `evaluateAutoMerge()`.
- The end state introduces a second provider dependency into the review
  path: a secondary-provider outage can stall reviews; the accepted
  mitigation is deferral (reviews wait, the task does not silently degrade
  to same-family review).
