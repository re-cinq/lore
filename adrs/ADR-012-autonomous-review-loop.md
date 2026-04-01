---
adr_number: 12
title: Autonomous Review Loop via LoreTask CRD
status: accepted
date: 2026-04-01
domains: [agent, pipeline, review]
---

# ADR-012: Autonomous Review Loop via LoreTask CRD

## Context

Implementation tasks create PRs via the LoreTask CRD (ADR-011), but
PRs then sit waiting for human review. For many tasks (gap-fill,
runbooks, simple implementations), the agent should be able to
self-review and iterate without human involvement.

The review task type already existed but ran as an in-process LLM call,
inconsistent with the CRD-based architecture (see ADR-011). Per team
feedback, all agent tasks should run as ephemeral Job pods.

## Decision

Close the loop: after an implementation PR is created, automatically
create a review LoreTask CR that runs Claude Code in an ephemeral Job
to review the PR. The review Job posts comments via `gh` CLI and
outputs a structured result (APPROVED or CHANGES_REQUESTED).

On changes-requested, the watcher creates a new implementation LoreTask
on the same branch with the feedback as context (max 2 iterations).
On approval, the PR is marked ready for human merge.

### Alternatives Considered

1. **In-process LLM review** — faster but inconsistent with CRD
   architecture. User explicitly requested all tasks use CRD.
2. **GitHub Actions-based review** — would need a separate workflow
   per repo. LoreTask CRD is already deployed and universal.
3. **No auto-review** — status quo. Leaves PRs unreviewed until
   humans get to them.

## Consequences

**Positive:**
- PRs get immediate feedback — implementation quality improves
- Iteration happens autonomously (up to 2 rounds)
- Consistent architecture: all tasks are ephemeral Jobs
- Opt-in per repo via `auto_review` setting

**Negative:**
- More Job pods = more cluster resource usage
- Review quality depends on model capability
- Max 2 iterations may not be enough for complex changes
