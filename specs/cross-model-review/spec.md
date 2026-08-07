# Feature Specification: Cross-Model Review for Agent-Authored Changes

| Field   | Value                                  |
| ------- | -------------------------------------- |
| Feature | Cross-Model Review for Agent-Authored Changes |
| Branch  | (unassigned)                           |
| Status  | Draft                                  |
| Created | 2026-08-07                             |
| Owner   | Platform Engineering                   |

Cross-Model Review makes the review node of every assembly line that reviews
agent-authored code run on a different model family than the model that
authored the change, countering self-preference bias. The policy is expressed
entirely through existing `lore.agent_definitions` rows and their resolve
chain — no new mechanism.

## Problem Statement

LLMs recognize and favor their own generations. When the same model family
both writes and reviews a change, the reviewer tends to read what the author
meant rather than what the diff says. This is the entire reason
danshapiro/fresheyes exists as a standalone tool: it routes review to the
opposite model family from the primary agent and reports that this catches
defects same-family review misses.

Today Lore's implementation and review agents resolve their model through the
same `lore.agent_definitions` chain (per-repo row, org-default row,
`task-types.yaml` fallback). Nothing prevents — and the defaults produce —
implementer and reviewer running on the same family. The autonomous review
loop (`auto_review`) and the code-review assembly line
(`libs/assembly-lines/src/assembly-lines/code-review.yaml`) therefore carry a
structural self-preference bias on exactly the PRs that may later auto-merge
under dark-factory mode.

## Prerequisite

The ai-agent-subsystem's `claude-code` vendor only calls the Anthropic API
today, so cross-provider review is not reachable by row edits alone: the
subsystem needs a second vendor (e.g. `openai-code`) that runs the review
prompt against the OpenAI API and emits the same `REVIEW_RESULT` marker the
node contract parses. That vendor is scoped as a follow-up to ADR-031. Until
it exists, the interim config-only step is a *different Anthropic model tier*
for review — weaker against family-level self-preference, but immediately
available through the resolve chain.

## Functional Requirements

### FR1 — Cross-family org default

- The org-default `agent_definitions` row for review-type agents pins a model
  from a different family than the implementation default. Concretely: while
  the implementation default resolves to the Anthropic/Claude family, the
  review default is pinned to OpenAI's current flagship (`gpt-5.6` at time of
  writing), and vice versa.
- Until the second vendor exists, the org-default review row pins a different
  Anthropic model tier than the implementation default (the interim step
  named under Prerequisite).

### FR2 — Same-family warning in the settings UI

- When an implementation task's model is overridden per-repo, the repo owner
  is responsible for keeping the review model cross-family; the settings UI
  surfaces a warning when implementer and reviewer resolve to the same
  family.

### FR3 — No new mechanism

- The policy is expressed entirely through existing `agent_definitions` rows
  and their resolve chain (per-repo row → org-default row →
  `task-types.yaml`/code fallback). No code path hardcodes the family split.

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
  by editing rows; the full cross-provider step additionally requires the
  `openai-code` vendor named under Prerequisite.
- Review quality on agent-authored PRs no longer depends on a model grading
  its own homework; this strengthens the `bot APPROVED` input to
  `evaluateAutoMerge()`.
- Introduces a second provider dependency into the review path: a
  secondary-provider outage can stall reviews; the accepted mitigation is
  deferral (reviews wait, the task does not silently degrade to same-family
  review).
- Cross-family prompt behavior differs; the review prompt in
  `task-types.yaml` needs a validation pass against the chosen family.
