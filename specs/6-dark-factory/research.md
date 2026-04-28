# Research: Dark Factory Mode

Resolves the deferred items from `/speckit.clarify` (perf targets, GitHub failure modes, web-ui rendering, span schema) and the implementation choices flagged in plan.md.

## R1: Path-allowlist matching semantics

**Decision:** `minimatch` (glob syntax: `specs/**`, `*.md`, `.claude/**`).

**Rationale:** Already a transitive dep via several tools in the workspace; expressive enough for the planned defaults; well-known to operators editing `auto_merge.paths`. Prefix-only matching (`startsWith`) was rejected because `*.md` is a critical default and prefix matching can't express it without enumeration.

**Alternatives considered:** prefix match (rejected — too weak for `*.md`), regex (rejected — operator-hostile), CODEOWNERS-style match (rejected — overlaps confusingly with the AuthZ ceremony).

**Edge case:** A PR with mixed paths (one allowlisted, one not) → auto-merge denied. The rule is "all changed paths must match the allowlist."

## R2: DB lease implementation

**Decision:** Postgres row in `pipeline.task_leases` with `expires_at TIMESTAMPTZ`. Acquisition via `INSERT … ON CONFLICT (branch_name) DO UPDATE SET … WHERE task_leases.expires_at < now()`. Refresh = `UPDATE … WHERE branch_name AND holder`. Release = `DELETE`.

**Rationale:** Cheap, transactional, single source of truth, no new component, automatic recovery via `lease-reaper` job that deletes rows where `expires_at < now() - 5 min` (the grace window absorbs clock skew). Postgres advisory locks were considered but rejected: they don't survive connection drops, which means a supervisor whose connection blips loses the lease silently.

**Lease TTL:** 10 minutes default, refreshed before each graph node executes. Most nodes complete in <60s; the 10-minute window absorbs LLM-call worst case (gap-detect / spec-drift can run ~5 min) without forcing every node to refresh.

**Alternatives considered:** Postgres advisory locks (rejected — connection-bound), Kubernetes `coordination.k8s.io/Lease` (rejected — couples local runner to k8s API), file-based lease in worktree (rejected — local-only, doesn't help GKE supervisors).

## R3: GitHub API failure modes

**Decision:** Three distinct failure classes, each handled differently.

| Failure | Behavior |
|---|---|
| **Auto-merge call fails (5xx, rate limit, mergeability check)** | Retry 3x with exponential backoff (1s, 4s, 16s); on final failure, write `auto_merge_decision` audit entry with `outcome: "deferred:api_failure"` and let PR sit open for human merge. Do not block the workflow. |
| **Issue creation fails on escalation** | Retry 3x; on final failure, write `escalation_issued` audit entry with `outcome: "audit_only"` and fire `escalation` notification with full context inline (Slack message carries what the Issue would have). Supervisor still marks task `needs-human-help`. |
| **Comment / review-post fails** | Single retry; on failure, log and continue. The verdict is in the commit trailer and audit log; the PR comment is convenience, not source of truth. |

**Rationale:** GitHub API is a soft dependency for surfaces but a hard dependency for nothing. The audit log + commit trailers + Slack carry the truth, so transient API failures degrade UX rather than corrupt state.

**Rate limit budget:** Today's bot uses ~200 GitHub API calls per task. Auto-merge adds ~3 calls (mergeability, merge, post-merge status). At 50 dark-mode tasks/day, ~150 extra calls/day — well under the 5000 calls/hour App-installation limit.

## R4: Web-ui stage timeline rendering

**Decision:** Vertical timeline using existing TailwindUI/shadcn primitives. Each row = one stage commit with: stage name, node type icon, duration, outcome badge, commit SHA link, attempt count.

**Rationale:** Matches existing styling in `web-ui/src/app/pipeline/[id]/`. No new chart library. SHA links open the GitHub commit in a new tab. A "live" mode (auto-refresh every 10s) covers in-flight tasks; once `Lore-Stage: retrospective` lands, polling stops.

**Alternatives considered:** Mermaid diagram rendering (rejected — overkill for linear/small graphs; reconsider for graph editor in a follow-up spec), force-directed graph (rejected — same).

**Failure cases:**
- Branch deleted: timeline shows last cached state with "branch deleted" banner.
- Trailer parse failure on a commit: row shows "unstructured" label; non-fatal.

## R5: OTEL span schema

**Decision:** Three new span types under existing `lore.*` namespace.

```text
lore.stage                    # one per workflow node executed
  attrs: stage_name, node_type, iteration, commit_sha, outcome,
         task_id, repo, workflow_name
  parent: lore.task

lore.lease.{acquire|refresh|release|expired}
  attrs: branch_name, task_id, holder, ttl_sec
  parent: lore.stage  (for refresh) or lore.supervisor (for acquire/release)

lore.auto_merge.decision
  attrs: pr_number, repo, decision, rule, trust_level,
         path_match_count, ci_status, bot_review_state
  parent: lore.task
```

**Rationale:** Inherits existing `lore.task` parent; trace IDs propagate from task creation through merge for end-to-end correlation in Cloud Monitoring. Span names use snake_case to match existing convention.

**Cardinality budget:** Each implementation task emits ~5 stage spans + ~5 lease spans + 1 decision span = ~11 spans per task. At 100 tasks/day = 1100 spans/day, negligible.

## R6: Performance targets

**Decision:**

- Supervisor startup (lease acquire + load graph + parse `git log`) ≤ 5s (FR1.6 implies this for pod-death recovery).
- Stage commit → next-stage start ≤ 2s for non-LLM nodes (validate, gate, retrospective).
- Auto-merge engine end-to-end (PR open → merged) ≤ 60s assuming green CI.
- Lease reaper tick: 60s.
- Timeline API: ≤ 500ms p95 for ≤ 50-commit branches.

**Rationale:** Targets are loose enough to be achievable on first iteration without optimization theatre but tight enough to keep the dark-factory feel ("it just merges") credible. Anything slower starts to look like "watch me work" again.

## R7: Bot-review-disagreement handling (was deferred)

**Decision:** Out of scope for v1. Today's flow has a single Haiku reviewer, so there's no disagreement to handle. When parallel red-team agents land in a follow-up spec, that spec will define consensus rules. The current single-verdict path (`APPROVED | CHANGES_REQUESTED`) is preserved.

## R8: Workflow YAML schema details

**Decision:** Three node types (`agent | validate | gate | retrospective`), edge condition language is a small enum (`success | changes_requested | failed | always`), no scripting.

**Rationale:** A scriptable edge language (e.g. CEL, expr) tempts complexity creep — workflow authors writing arbitrary expressions inside YAML. The four-condition enum is sufficient for every existing flow we'll port (Phase 2 Task 2.3) and forces complex branching to be modeled as nodes rather than expressions. If we need more, add a fifth condition later — additive change.

**Iteration caps:** Loops are expressed as named back-edges with an `iteration_max` attribute on the back-edge, not as arbitrary cycles. Graph executor refuses cyclic graphs without an explicit cap.

## R9: CODEOWNERS approval ceremony

**Decision:** Settings change is a PR against a centralized `lore-settings/<repo>.yaml` file (or a settings-editor PR generated by the web-ui), labeled `dark-factory-approval`. The MCP server validates: PR exists, has the label, label was applied by a CODEOWNERS member of the affected repo's `CLAUDE.md`. Validated at the moment the settings PUT lands.

**Rationale:** Reuses GitHub's existing review machinery; no new approval system. A PR is auditable, revertable, and CODEOWNERS already protects sensitive paths.

**Alternatives considered:** Two-person rule via approval API endpoint (rejected — new approval surface to maintain), Slack-button approval (rejected — no audit trail).

## R10: Migration sequence

**Decision:** Schema migration first (Task 1.1), then code deploys default `dark_factory.enabled = false`. Existing repos behave identically until explicitly opted in via the settings ceremony. Pilot rollout (Task 5.3) on three trust-tiered repos for 14 days each before any default change.

**Rationale:** Backwards-compatible by construction. SC8 (adoption gate) prevents accidental wide rollout.
