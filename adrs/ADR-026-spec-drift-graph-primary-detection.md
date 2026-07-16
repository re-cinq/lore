---
adr_number: 26
title: "Spec-drift detection: graph-primary signal, hardened dedup + infra retry"
status: shipped
date: 2026-06-17
domains: [agent, pipeline]
---

# ADR-026: Graph-primary spec-drift detection

This ADR makes spec-drift detection decide from the statement-level spec-trace graph where it is populated, keeping the symbol-name heuristic only as a de-noised fallback, and hardens the dedup key plus transient-infra retry so real drift is neither buried nor forever-suppressed.

## Context

The weekly `spec_drift` cron
([spec-drift.ts](../apps/floor/src/application/jobs/cron/spec-drift.ts)) decided
drift by LLM-extracting named "assertions" from a spec and checking each name
against the code-chunk `symbol_name` set. Three failures fell out of that design,
all visible in the [#571](https://github.com/re-cinq/lore/issues/571) batch
(~30 drift tasks filed 2026-06-15, all `lore-failed`):

1. **False positives.** Endpoints (`GET /healthz`), fields, and methods are not
   top-level symbols, so a clean spec read as "completely diverged".
2. **No self-healing.** A bad-secret deploy (ADR-025 cutover) made the Job pods
   fail with `CreateContainerConfigError` → `BackoffLimitExceeded`; the watcher
   filed terminal `lore-failed` issues and nothing retried them after the fix.
3. **Forever-suppression.** A `failed` drift task counted as "open" in the dedup
   window, so it suppressed re-detection of its spec permanently — the opposite
   failure mode, burying real drift.

The spec-trace graph already carries a deterministic, statement-level drift
signal (`Statement.violated` / `Statement.drifted`) that the detector ignored.

## Decision

**Decide drift from the spec-trace graph where it is populated; keep the symbol
heuristic only as a de-noised fallback.**

- **Graph-primary.** When a spec is projected, drift = statements flagged
  `violated` or `drifted` ([decideGraphDrift](../apps/floor/src/application/jobs/cron/spec-drift-rules.ts)).
  Authoritative; a spec whose statements all resolve is not drifted. Pure markdown
  link-rot stays owned by the link-rot validate pass — not re-filed here.
- **Heuristic fallback.** No graph → score only `function`/`class`/`interface`/
  `type` kinds, and require both a divergence ratio over threshold **and** an
  absolute floor of missing symbols ([decideHeuristicDrift](../apps/floor/src/application/jobs/cron/spec-drift-rules.ts)).
- **Dedup on a stable key.** `context_bundle.spec_path` (+ repo + task type), not
  the LLM-reworded title; `failed` ages out on a short cooldown instead of
  suppressing forever; a per-run cap bounds the batch.
- **Self-heal transient infra.** Classify `BackoffLimitExceeded` /
  `CreateContainerConfigError` / image-pull errors as transient
  ([infra-failure.ts](../apps/floor/src/application/jobs/infra-failure.ts)) and
  re-queue a bounded number of times from the watcher
  ([loretask-watcher.ts](../apps/floor/src/application/jobs/scheduled/loretask-watcher.ts))
  rather than filing a terminal `lore-failed`.
- **Actionable issues.** Every drift issue lists the graph-detected drifted
  statements verbatim, carries a static remediation guidance block
  ([drift-issue-guidance.ts](../apps/floor/src/application/jobs/cron/drift-issue-guidance.ts)),
  attributes the creator as `spec-drift`, and links the `Lore-Task` trailer to the
  deployed task page ([issue-body.ts](../apps/floor/src/application/task-processing/issue-body.ts)).

The deterministic `spec_drift` cron is the single detector of record; the
`scripts/agent-prompts/spec-drift.md` reference doc is aligned to it.

Spec + acceptance criteria: integrated into [specs/spec-traceability-graph/spec.md](../specs/spec-traceability-graph/spec.md) (§"Drift detection job — the weekly consumer"), the graph that produces the `violated`/`drifted` signal.

## Consequences

- Repos with a populated trace graph get precise, statement-level drift with no
  symbol-name false positives; repos without one fall back to a stricter
  heuristic. Graph coverage varies by repo (`LORE_DGRAPH_HTTP` + projection), so
  the fallback remains load-bearing.
- An infra outage during a sweep no longer manufactures terminal `lore-failed`
  issues; bounded retries cap the blast radius if a pod is genuinely broken.
- A failed drift task can recur after a short cooldown — intentional, so genuine
  drift is not buried, at the cost of a possible re-file once infra recovers.
- Deploy-window gating of the sweep is deliberately not added; the bounded
  infra-retry is the safety net. Follow-up if a deploy-in-progress signal exists.
