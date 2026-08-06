---
adr_number: 12
title: Autonomous Review Loop via LoreTask CRD
status: draft
date: 2026-04-01
domains: [agent, pipeline, review]
---

# ADR-012: Autonomous Review Loop via LoreTask CRD

Closes the review loop by automatically running an agent review after an implementation PR is opened, so it posts an APPROVED or CHANGES_REQUESTED verdict and iterates on the branch (up to two rounds) without waiting for a human.

> **Mechanism update ([ADR-031](./ADR-031-agent-station-crds.md)).** The review-loop
> decision stands, but it no longer runs on `LoreTask` CRs: the review is a `github_action`
> + agent node in the Floor-side workflow graph (the `review` Agent posts the verdict; the
> graph follows the `changes_requested` edge). The substrate is the ai-agent-subsystem.

> **Widening: the `code-review` assembly line (2026-07 amendment).** The loop above
> reviewed only Lore's **own** implementation PRs. The `code-review` assembly line
> ([`code-review.yaml`](../libs/assembly-lines/src/assembly-lines/code-review.yaml)) widens
> this to **any open PR on a repo with `auto_review` enabled** — driven by PR-lifecycle
> webhooks on the event bus ([ADR-015](./ADR-015-webhook-driven-review-reactor.md)). It is
> the **sole reviewer** (the legacy `review-reactor` was retired). The engagement is an
> **event choreography** (wiring in [`code-review.ts`](../apps/floor/src/jobs/review/code-review.ts)):
>
> - **Triggers.** A **first, deep** review runs on `opened` / `reopened` /
>   `ready_for_review` / the first `synchronize` (`hasReviewedPr`). Every **later push**
>   starts the fast `code-review-recheck` line instead (2026-08 amendment below), so the
>   verdict tracks the fix; an explicit `@lore review` still forces a full re-review. The
>   first review posts a how-to "review started" comment; the re-check posts none.
> - **Reviews submit a formal verdict** (2026-08 amendment). The `review` node emits
>   **structured findings** (`REVIEW_FINDINGS`) + a verdict; the Floor renders them as
>   **Conventional Comments** (with ` ```suggestion ` blocks) and posts ONE review whose
>   GitHub event **is** the verdict — `APPROVE` or `REQUEST_CHANGES`, no longer a neutral
>   `COMMENT`. It still never commits.
> - **Comments are triaged.** Every non-keyword human comment starts the `comment-triage`
>   line — a cheap Haiku station classifies it (review / address / answer / ignore) and the
>   Floor routes it: `address` → a `code-review-reply` line commits the approved fix,
>   `answer` → replies in-thread, `ignore` → nothing (no action pod).
> - **Fixes are human-gated.** A fix only happens when a human approves it via a reply.
> - **State + merge gate.** Each PR-linked line publishes a `lore/<definition>` **check
>   run** (in_progress while running; `neutral` on changes-suggested); required in branch
>   protection it blocks merge only while the review runs. Lore's own auto-merge defers
>   with `review_in_flight` while a review line is open.
>
> Loop-prevention stays load-bearing: bot-authored PRs and bot comments (`…[bot]`) are
> skipped so the review never re-triggers on its own output. The reused gate is
> `shouldAutoReview()`.

> **Formal verdict + two-phase review (2026-08 amendment).** Two coupled changes close the
> merge loop:
>
> 1. **Formal `APPROVE` / `REQUEST_CHANGES`, always on.** The single posted review now
>    carries the verdict as its GitHub review event for **every** repo (not the
>    suggestion-only `COMMENT` of the original design), so it satisfies branch-protection
>    "require approvals" and the dark-factory `require_bot_approval` gate
>    ([ADR-016](./ADR-016-dark-factory-mode.md)). Derived in
>    [`post-review.ts`](../apps/floor/src/jobs/review/post-review.ts) from the
>    already-parsed `output.verdict`; the inline findings ride the same review.
> 2. **A fast re-check on every push.** After the deep review, each new push starts the
>    cheap Haiku `code-review-recheck` line
>    ([`code-review-recheck.yaml`](../libs/assembly-lines/src/assembly-lines/code-review-recheck.yaml)),
>    which re-decides the verdict on the updated diff and re-submits it. Auto-merge reads
>    the bot's **latest** decision, so a later `REQUEST_CHANGES` overrides an earlier
>    `APPROVE` and vice-versa
>    ([`pr-policy.ts`](../apps/floor/src/jobs/platform/pr-policy.ts)).
>
> **Self-approval limit.** GitHub 422s when the review author is the PR author, so the bot
> cannot `APPROVE` its **own** PR; that post degrades to a plain comment and auto-merge
> stays deferred. Fully autonomous self-approval on Lore-authored PRs requires the reviewer
> to run as a **distinct GitHub App identity** from the author (`LORE_REVIEW_BOT_LOGIN`) —
> deployment config, not code.

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
