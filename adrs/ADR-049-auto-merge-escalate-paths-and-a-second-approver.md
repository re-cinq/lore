---
adr_number: 49
title: "Auto-merge escalates sensitive paths, and a second identity approves what it merges"
status: draft
date: 2026-09-28
deciders: []
domains: [dark-factory, auto-merge, security, github]
---

# ADR-049: Auto-merge escalates sensitive paths, and a second identity approves what it merges

This ADR records three decisions about auto-merge:

- which changes always go to a human, whatever a repo's allowlist says
- why agent-instruction files left the default allowlist
- how an auto-merged PR gets an approval that a protected branch accepts

The evidence comes from a pilot repo's history (issue 2205).

## Context

Auto-merge (ADR-016) merges a Lore task's PR when every guard in `apps/floor/src/work/merge/auto-merge.ts` passes. The only path rule was an **allowlist**, `dark_factory.auto_merge.paths`. It defaulted to `specs/**`, `adrs/**`, `*.md`, `CLAUDE.md` and `.claude/**`.

Three problems showed up when a pilot repo was lined up for code auto-merge.

**A repo couldn't name what must always go to a human.**

- The pilot is a customer-facing AI service. Its merged PRs since 2026-08-01 touched auth, the system prompt, the AI disclosure, human-oversight code, customer-language copy, compliance docs, and deploy config.
- A useful allowlist for it has to include `apps/**`, and that also admits every one of those files.
- An allowlist can say what may merge. It can't say "this path always stops the merge".

**Agent instructions were auto-mergeable by default.**

- `CLAUDE.md`, `AGENTS.md` and `.claude/rules/**` are read by every later agent run. `.claude/settings.json` holds hooks, which are shell commands run on every developer machine and in every agent pod that opens the repo.
- An injected edit that auto-merges there stays active for every run after it.
- Removing the two entries from the default wasn't enough, because the default `*.md` also matches a root `CLAUDE.md` and `AGENTS.md`.

**GitHub won't count an approval from the PR's author.**

- Lore opens its PRs through its own App. `pr-policy.ts` already reads the review verdict off the `lore/code-review` check for that reason: GitHub refuses an APPROVE from the account that opened the PR.
- On a branch that requires an approving review, `require_bot_approval` passes in Lore but satisfies nothing on GitHub, so the merge call is refused.
- The pilot's default branch had no protection at all, so the problem was hidden there. The fix is to add protection, which is exactly when the problem appears.

## Decision

Decision: a match against `auto_merge.escalate_paths`, or against the agent-instruction floor that every repo has, ends the evaluation with `deferred:sensitive_path`. The PR is labelled `needs-human-review` and gets one comment naming the matching paths. Allowlisted PRs that touch no escalate path are approved by a second GitHub App, not the author App. Escalated PRs merge through GitHub's native auto-merge after a person approves.

The pieces:

- **`auto_merge.escalate_paths`:**
  - A per-repo list of globs, default `[]`, capped at 32 like `paths`.
  - The guard runs after `review_in_flight` (#1641) and before CI and the allowlist. So a match always wins over `paths`, and a PR with red CI is still routed to a human.
  - The matching paths are written to the `auto_merge_decision` audit row (`rule.escalated_paths`) and counted on the `lore.auto_merge.decision` span.
- **The agent-instruction floor:**
  - `**/CLAUDE.md`, `**/AGENTS.md`, `**/GEMINI.md`, `**/.claude/**` and `**/.gemini/**` escalate on every repo, and no setting turns this off.
  - `CLAUDE.md` and `.claude/**` left `DEFAULT_AUTO_MERGE_PATHS`.
- **`auto_merge.enabled`:**
  - Auto-merge now has its own switch. When it's unset it follows `dark_factory.enabled`, so a repo already in dark mode keeps merging.
  - `true` turns auto-merge on without the rest of dark mode. `false` turns it off inside dark mode.
  - The outcome `deferred:dark_mode_off` became `deferred:auto_merge_off`.
- **Two-key:**
  - Turning `auto_merge.enabled` on, and any change to `escalate_paths`, go through the CODEOWNERS approval ceremony, the same as `paths`.
  - Turning auto-merge off doesn't, so an operator can switch it off quickly.
- **Routing to people:**
  - Lore doesn't request reviewers. GitHub already requests code owners when a PR opens that touches their paths, so a repo gets reviewer routing by having a CODEOWNERS file that covers its escalate paths.
  - The label is the idempotency key. Every check run re-evaluates the PR, and a PR that already has the label gets no second comment.
- **The approver:**
  - A second App, installed per repo, submits the APPROVE for allowlisted PRs, so the approver isn't the author.
  - Escalated PRs are never approved by Lore. Lore arms native auto-merge, and GitHub merges once a person approves and the required checks pass. Only the merge click is removed, not the review.
  - Native auto-merge is armed only where the branch rule requires an approval. On an unprotected branch it would merge with nobody approving.
  - This half is a follow-up. It needs the App to exist and its credentials in Secret Manager (ADR-046) before any chart references them.

## Consequences

- Once the pilot's list is in place, it escalates 40 of the 44 PRs merged into it since August and would auto-merge the other 4, all of them spec or test-only. On a regulated repo, escalation is the normal case. Auto-merge there takes spec, test and UI-mechanics PRs, not feature work.
- A repo already in dark mode that auto-merged edits to its agent instructions now escalates them. That's intended.
- Escalation is advisory until the repo protects its default branch. Anyone with write access can still click merge. The pilot needs these before it's switched on:
  - a ruleset requiring one approval and the CI check
  - a CODEOWNERS file
  - "Allow auto-merge"
- The two-key ceremony needs the approver to be a CODEOWNER of the repo's `CLAUDE.md`. A repo with no CODEOWNERS file can't change these settings through the settings route.
- A glob can't tell a new dependency from a script edit in `package.json`, or a stricter CI change from a weaker one. The pilot accepts that noise: 1 of its 17 supply-chain hits was script-only. Its week of `auto_merge_decision` rows decides whether a content matcher is worth building.

## Alternatives

- **Add the Lore App to the ruleset's bypass list.** Rejected. The bypass applies to every Lore PR, escalated ones included, which leaves the Floor's guards as the only line of defence on the branch.
- **A human approves everything, and Lore only arms native auto-merge.** Rejected for allowlisted PRs, because it gives up the point of auto-merge. It's kept for escalated PRs.
- **Escalate paths as a default list rather than a floor.** Rejected for agent instructions. A repo could set the list to `[]` and remove the one protection that guards every later agent run.
- **Lore requests CODEOWNERS as reviewers itself.** Rejected. GitHub already does this when the PR opens, and doing it again adds a CODEOWNERS parser to the Floor for no gain.
- **Keep auto-merge tied to `dark_factory.enabled`.** Rejected. A repo couldn't try auto-merge without also changing how Issues, reviews and notifications behave.
