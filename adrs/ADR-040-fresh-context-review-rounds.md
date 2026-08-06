---
adr_number: 40
title: "Fresh-context review rounds with plan reconsideration"
status: draft
date: 2026-08-05
deciders: []
domains: [review, assembly-lines, floor]
---

# ADR-040: Fresh-context review rounds with plan reconsideration

This ADR proposes restructuring the autonomous review loop so that each
review round runs with a fresh agent context, and repeated blocked rounds
route back to a replan node instead of re-iterating the same patch.

## Context

Lore's review loop today: implementation PR → review agent → on
CHANGES_REQUESTED with iteration < 2, a new implementation task with the
feedback on the same branch → at iteration >= 2, escalate to human review.
Two properties limit it:

1. **Context accumulation.** Follow-up rounds carry the prior conversation;
   the reviewer and fixer anchor on earlier judgments instead of re-reading
   the diff cold.
2. **No plan-level exit.** When the patch keeps failing review, the loop
   only ever iterates the patch. If the approach is wrong, two rounds of
   polishing a wrong approach precede escalation.

danshapiro/trycycle structures the same loop differently and reports better
convergence: up to 8 independent review rounds where each reviewer has no
memory of prior rounds, and a scheduled plan-reconsideration step (after
round 4, then every 2 rounds) that revisits the plan when blockers persist.
The assembly-line substrate already supports the required shape: back-edges
with `iteration_max` (enforced by `loader.ts` cycle detection) and per-node
iteration accounting in `nextTransition()` / `pipeline.assembly_line_nodes`.

## Decision

The implementation and code-review assembly lines gain:

- **Fresh context per review round.** Each review node execution is a new
  Agent CR whose prompt contains the diff, the spec, and conventions — not
  the transcript of prior rounds. Each round already spawns a distinct
  Agent CR under ADR-031; the change here is entirely prompt construction
  (excluding the prior round's digest from the next round's prompt), not a
  new execution mechanism. Round-over-round state lives only in the branch
  (commits) and the node rows, which is already the branch-as-state
  doctrine.
- **A replan back-edge.** After N blocked review rounds (initial N = 2,
  configurable per line), the walk routes to a replan node that re-derives
  the approach from the spec and the accumulated review verdicts, then
  re-enters implementation. The replan edge carries its own `iteration_max`
  so total work stays bounded before `needs-human-help` escalation. N = 2
  is deliberately lower than trycycle's round-4 reconsideration: trycycle's
  rounds are subscription-billed local runs, Lore's are API-billed pod
  launches, so replanning earlier is the cheaper failure path here; the
  threshold is per-line configuration, not a constant.

## Alternatives rejected

- **Raising the iteration cap alone.** More rounds of the same anchored
  context is more cost for the same failure mode.
- **Passing full review history into every round.** This is the current
  behavior extended; it deepens anchoring rather than removing it.
- **Adopting trycycle itself.** It is a local Claude Code skill, not a
  Floor-side workflow; the pattern ports, the tool does not.

## Consequences

- More Agent CR launches per difficult PR; bounded by the two iteration caps.
- The review loop can now recover from a wrong approach without a human,
  which is the dominant escalation cause worth removing before widening
  dark-factory adoption.
- YAML changes to `implementation.yaml` / `code-review.yaml` plus a replan
  prompt in `task-types.yaml`; no schema migration — node iteration tracking
  already exists.
- Review verdict history must be summarized into the replan prompt (a bounded
  digest, not a transcript) to keep the fresh-context property honest.
