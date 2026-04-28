---
adr_number: 16
title: "Dark Factory mode — opt-out human gates, branch-as-state, declarative workflow graphs"
status: accepted
date: 2026-04-28
domains: [agent, pipeline, ux, governance, cost]
supersedes: ADR-009
---

# ADR-016: Dark Factory mode

## Context

Lore today defaults to maximum chatter. Every pipeline task produces
a parallel ledger of artifacts that humans must look at: a GitHub
Issue with status comments, a LoreTask custom resource with status
fields, a `pipeline.tasks` row, Slack messages on every PR open, bot
review comments on every PR, and N stage transitions across CR
controller → Job pod → watcher → review CR → review Job → review
reactor.

For a single implementation task this produces ~14 distinct
artifacts of which only three are durable a year later: the branch,
the merged PR, and the curated episode. Everything else is "watch me
work" theater that the team has stopped reading — evidenced by
routine auto-generated PRs sitting open for 8+ days with green CI
before being manually triaged or closed.

The pain compounds across flow types: implementation tasks run four
ephemeral Job pods minimum; doc-only flows produce the same Issue +
PR + bot-review chatter; feature requests yield a spec PR followed
by N implementation PRs (every one needing a human review touch);
onboarding gates value on a human merging the bot's onboarding PR.
The local runner — one process from intent to PR with state in the
worktree and the branch — demonstrates the inverse, and works.

This is the system that BCG describes as the inverse of a "dark
software factory": humans participating in every artifact rather
than only at intent + stage-gate. The cost shows up in stale PRs,
human review fatigue, and pod-death fragility (state lives in three
places: CR / DB / Issue / PR / branch).

The full problem statement, vision, and acceptance criteria are in
[`specs/6-dark-factory/spec.md`](../specs/6-dark-factory/spec.md).

## Decision

Introduce **per-repo dark-factory mode** as a single coordinated
change with three sub-decisions:

### 1. Branch as durable state (FR1)

Every workflow phase ends with a git commit carrying structured
trailers: `Lore-Stage:`, `Lore-Iteration:`, `Lore-Task:`, plus
optional `Lore-Outcome:` and `Lore-Cost-Tokens:` extras. The branch
is the audit trail. A supervisor pod that dies resumes by reading
`git log` on the branch — no database checkpoints, no CR status
sync, no parallel ledger. Trailers are emitted **unconditionally**
for both dark-mode and opt-out repos (Q5 clarification): they are
the audit substrate for both modes.

Concurrency is enforced by a Postgres `pipeline.task_leases` row
keyed on branch name with a TTL (default 10 minutes, 5-minute grace
window for the reaper). A second supervisor that finds the branch
held exits cleanly. A supervisor that takes over an expired prior
lease writes a `lease_expired` audit entry naming the previous
holder.

### 2. Workflow as declarative YAML graph (FR2)

The implicit chain `implement → validate → push → review → address`
hardcoded across `loretask-watcher`, `review-reactor`, and
`local-runner` is externalized into YAML files at
`agent/src/workflows/<task-type>.yaml`. Schema:

- Four node types: `agent` (LLM call + edits), `validate` (lint /
  typecheck), `gate` (named conditions), `retrospective` (episode +
  curated memory).
- Four edge conditions: `success | changes_requested | failed | always`.
  No scripting. Cycles require `iteration_max` on the back-edge.
- The same definition file drives both the local runner and the GKE
  supervisor.

The graph executor walks from `entry`, dispatches each node to the
caller-provided handler, commits a stage commit (allow-empty for
non-file-changing nodes per FR1.3), and refreshes the lease before
each node. Resume semantics: on entry, the executor reads the last
`Lore-Stage:` trailer on the branch and follows the
outcome-matching outgoing edge.

### 3. Opt-out human gates (FR3)

Per-repo `lore.repos.settings.dark_factory` block:

```yaml
enabled: false  # default for existing repos
create_issue: on_gate  # never | on_gate | always
auto_merge:
  paths: ["specs/**", "adrs/**", "*.md", "CLAUDE.md", ".claude/**"]
  min_trust: docs
  require_green_ci: true
  require_bot_approval: true
review: trust_based  # trust_based | always | never
notify: [escalation]  # escalation | watched | all
```

GitHub Issues become an **exception surface**: created only when an
approval gate is required, when escalation to a human is needed
(`needs-human-help`), or when a per-repo / per-task override forces
it. The PR remains the canonical artifact for code-producing tasks.

Cross-reference happens via `Lore-Task: <uuid>` in the PR body and
on every stage commit's trailer (FR1.5). Web-ui resolves both
directions.

Auto-merge for path-allowlisted PRs runs after the retrospective
stage: green CI + bot APPROVED + path matches every changed file +
trust ≥ `min_trust` → merge. Otherwise a typed deferral
(`deferred:human_review`, `deferred:ci_failed`,
`deferred:bot_changes_requested`,
`deferred:path_outside_allowlist`, `deferred:trust_too_low`,
`deferred:dark_mode_off`, `deferred:api_failure`) is recorded in
`pipeline.audit_log` and the PR sits open for human merge.

### 4. Two-key authorization (FR3.9, R9)

Privileged settings changes — `dark_factory.enabled` toggle,
`auto_merge.paths` modification, downgrade of
`require_green_ci`/`require_bot_approval` to false — require both
admin-scope token AND a CODEOWNERS-approval PR ceremony. The
ceremony is an open PR labeled `dark-factory-approval` whose label
was applied by a CODEOWNERS member of the repo's `CLAUDE.md`. The
mcp-server validates the PR + label + applier via Octokit. All
mutations write a `dark_factory_setting_changed` audit entry with
ceremony evidence.

## Alternatives Rejected

### Keep GitHub Issues mandatory for every task

Today's posture. Rejected because the team is demonstrably ignoring
auto-generated Issues (8+ day staleness on green-CI PRs), so the
"audit value" claim is theoretical. Issues would still be created
for approval-gated and escalation cases — the actual surfaces where
humans need to act — without bombarding maintainers with routine
chatter.

### Remove GitHub Issues entirely

Considered. Rejected because (a) external stakeholders (PMs,
non-engineers) use GitHub UI as their canonical surface and the
web-ui rollout for them isn't done; (b) some repos genuinely want
the Issue layer for compliance / audit reasons. Per-repo opt-in to
"keep Issues" is the right granularity — accomplished via
`create_issue: always` on the affected repos.

### Auto-merge everywhere on green CI

Considered. Rejected as too aggressive for v1: a misconfigured PR
template or a transient bot-review parsing failure could merge
unintended changes. The path-allowlist + trust-tier gate confines
auto-merge to low-blast-radius outputs (specs, ADRs, runbooks,
CLAUDE.md), where a bad merge is reversible by another PR and the
trust ramp lets repos opt up over time.

### Multi-provider model routing (Fabro-style "stylesheets")

Considered after evaluating gascity and fabro. Rejected because
Lore is purpose-built around Claude's prompt-caching semantics
(ADR-015), and abstracting over providers would either lose those
savings or proliferate per-provider implementations. Revisit if a
genuine second-provider requirement appears.

### Global rather than per-repo dark mode

Considered for simplicity. Rejected because progressive trust is
the right shape for a platform serving heterogeneous repos: a
public docs repo can ship dark mode on day one; a sensitive
infra repo never should. The per-repo opt-in respects existing
governance.

## Consequences

### Positive

- **Stale-PR graveyard goes away.** Path-allowlisted PRs auto-merge
  on green CI within minutes, not 8 days.
- **Pod-death survivability.** The branch IS the durable state; a
  replacement supervisor resumes from `git log` after lease
  expiry. SC2 is achievable and testable.
- **Reviewer focus.** Humans see only PRs that genuinely need human
  judgment — code changes outside `auto_merge.paths`. SC6 target:
  ≤30% of bot PRs need human review on dark-mode repos.
- **Issue noise drops 80%+.** Approval-gated and escalation-only —
  Issues mean "a human needs to do something."
- **Workflow extensibility.** New flow = new YAML + new agent
  prompt; no code path forks.
- **Two-codepath problem solved.** Local runner and GKE supervisor
  interpret the same graph definitions (FR2.3).

### Negative

- **Larger blast radius if dark-factory settings are
  misconfigured.** Mitigations: two-key authorization, path
  allowlist, trust ramp, default-off for existing repos, every
  mutation audited.
- **Branch-as-state requires no history rewriting** of
  agent-authored branches. Agents enforce this by construction
  (no `--amend`, no force-push); humans rebasing such a branch
  before a task closes invalidates the audit trail.
- **Operational complexity adds.** New tables (`task_leases`,
  `dark_factory_baseline`, `audit_log`), new helm values, new
  routes. Mitigated by the migration being strictly additive
  (`IF NOT EXISTS` everywhere) and the dark-factory.enabled flag
  defaulting to false at migration time.
- **GitHub API budget grows slightly.** Auto-merge adds ~3 calls
  per task (mergeability + merge + post-status). Estimated +150
  calls/day at 50 dark-mode tasks; well under the 5000/hour
  installation limit.

### Constitutional Impact

This ADR supersedes the row "Task tracking | Pipeline tasks via
Lore MCP + GH Issues" in **Constitution Principle 7**. The
principle itself ("Architecture Decisions Are Final") is unchanged
— this ADR is the prescribed amendment path. The constitution
patches to v2.1.0 (MINOR — materially expanded guidance via a
revised decision row), updating the row to "Task tracking |
Pipeline tasks via Lore MCP; GH Issues for exception surfaces
(opt-out)". Sync impact recorded in the constitution header.

ADR-009 (Pipeline tasks replace Beads) established Issues as a
parallel ledger; this ADR keeps that decision but narrows when the
ledger is created.

## Implementation Notes

Spec, plan, contracts, data-model, and quickstart live under
[`specs/6-dark-factory/`](../specs/6-dark-factory/). Implementation
landed across 8 commits on branch `6-dark-factory`:

- Foundation (lease, commit trailers, schema): `336d7b0`
- Workflow graph executor + loader: `b8f6372`
- Settings AuthZ + auto-merge engine: `47df50f`
- Pod-death takeover detection: `01abc8f`
- General + implementation workflows + review-mode resolver: `863ae10`
- Approval gate + escalation + opt-out audit: `84ab5d7`
- (further commits land in this branch)

T024/T029/T035/T038/T043/T046/T053 (live verification scenarios)
deferred until pilot rollout (T059). Pilot is gated on three
trust-tiered repos passing SC1–SC7 thresholds across 14 days each
(SC8). After pilot, the legacy local-runner code paths (T058) are
deleted as a follow-up.
