---
adr_number: 12
title: Autonomous Review Loop via LoreTask CRD
status: accepted
date: 2026-04-01
domains: [agent, pipeline, review]
---

# ADR-012: Autonomous Review Loop via LoreTask CRD

> **Mechanism update ([ADR-031](./ADR-031-agent-station-crds.md)).** The review-loop
> decision stands, but it no longer runs on `LoreTask` CRs: the review is a `github_action`
> + agent node in the Floor-side workflow graph (the `review` Agent posts the verdict; the
> graph follows the `changes_requested` edge). The substrate is the ai-agent-subsystem.

> **Widening: the `code-review` assembly line.** The loop above reviews only Lore's
> **own** implementation PRs (the watcher fires it after `pr-created`). The `code-review`
> assembly line ([`libs/assembly-lines/src/assembly-lines/code-review.yaml`](../libs/assembly-lines/src/assembly-lines/code-review.yaml),
> `review → refine → done`) widens this to **any open PR on a repo with `auto_review`
> enabled — including human-authored PRs** — driven by PR-lifecycle webhooks on the event
> bus ([ADR-015](./ADR-015-webhook-driven-review-reactor.md)) rather than the `pr-created`
> hook. Because an assembly line runs **once to completion** (no park-until-webhook), the
> PR-long engagement is an **event choreography**, not one long-lived line: `pull_request.
> opened/reopened/ready_for_review` starts a review pass (and posts a "review has started"
> PR comment linking the Lore assembly-line page); each human reply (`issue_comment.created`
> / `pull_request_review_comment.created`) starts a fresh `mode: reply` pass whose `review`
> node decides **per reply** to answer in-thread or commit a fix; `pull_request.closed`
> finishes any open line for the PR. Loop-prevention is load-bearing: bot-authored PRs and
> bot comments (`…[bot]`) are skipped so the review never re-triggers on its own output.
> Wiring lives in [`apps/floor/src/jobs/review/code-review.ts`](../apps/floor/src/jobs/review/code-review.ts)
> + the registry combinator; the reused `auto_review` gate is `shouldAutoReview()`.

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

**Positive (code-review widening):**
- Human-authored PRs get the same convention/quality feedback, not just Lore's own
- Engagement lasts the PR's whole open life via the event bus, with per-reply follow-up
- Reuses the `auto_review` opt-in and the assembly-line substrate — no new enablement knob

**Negative:**
- More Job pods = more cluster resource usage
- Review quality depends on model capability
- Max 2 iterations may not be enough for complex changes
- Code-review fires one review pass per PR-open and per human reply; the `…[bot]` loop
  guard is the only thing preventing a self-triggering storm — treat it as load-bearing
