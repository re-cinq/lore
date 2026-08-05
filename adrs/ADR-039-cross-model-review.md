---
adr_number: 39
title: "Cross-model review for agent-authored changes"
status: draft
date: 2026-08-05
domains: [review, agent-definitions, quality]
---

# ADR-039: Cross-model review for agent-authored changes

This ADR proposes that the review node of every assembly line that reviews
agent-authored code run on a different model family than the model that
authored the change, to counter self-preference bias.

## Context

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

## Decision

The org-default `agent_definitions` row for review-type agents pins a model
from a different family than the implementation default. When an
implementation task's model is overridden per-repo, the repo owner is
responsible for keeping the review model cross-family; the settings UI
surfaces a warning when implementer and reviewer resolve to the same family.

No new mechanism is introduced: this is a policy expressed entirely through
existing `agent_definitions` rows and their resolve chain.

## Alternatives rejected

- **A second same-family review pass.** Cheaper to configure, but redundant
  with the existing loop and does not address the bias the change targets.
- **N-model review panels.** Stronger but multiplies cost and latency per PR;
  can be revisited if cross-family review measurably under-catches.
- **Hardcoding the family split in code.** The resolve chain already exists
  for exactly this kind of policy; encoding it in code would bypass per-repo
  override semantics.

## Consequences

- Config-only change; reversible by editing rows.
- Review quality on agent-authored PRs no longer depends on a model grading
  its own homework; this strengthens the `bot APPROVED` input to
  `evaluateAutoMerge()`.
- Introduces a second provider dependency into the review path: a
  secondary-provider outage can stall reviews; the accepted mitigation is
  deferral (reviews wait, the task does not silently degrade to same-family
  review).
- Cross-family prompt behavior differs; the review prompt in
  `task-types.yaml` needs a validation pass against the chosen family.
