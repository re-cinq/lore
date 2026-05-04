# Research: Dark Factory Mode

Resolves the deferred items from `/speckit.clarify` (perf targets, GitHub failure modes, web-ui rendering, span schema) and the implementation choices flagged in plan.md. Updated after implementation to record where the built system diverged from the original research decisions.

## R1: Path-allowlist matching semantics

**Decision:** `minimatch` (glob syntax: `specs/**`, `*.md`, `.claude/**`).

**Rationale:** Already a transitive dep via several tools in the workspace; expressive enough for the planned defaults; well-known to operators editing `auto_merge.paths`. Prefix-only matching (`startsWith`) was rejected because `*.md` is a critical default and prefix matching can't express it without enumeration.

**Alternatives considered:** prefix match (rejected — too weak for `*.md`), regex (rejected — operator-hostile), CODEOWNERS-style match (rejected — overlaps confusingly with the AuthZ ceremony).

**Edge case:** A PR with mixed paths (one allowlisted, one not) → auto-merge denied. The rule is "all changed paths must match the allowlist." Implemented in `agent/src/lib/path-match.ts` as `allPathsMatch()` with `dot: true, matchBase: false, nocase: false` options.

## R2: DB lease implementation

**Decision:** Two backends behind a shared `LeaseBackend` interface (`agent/src/supervisor/lease.ts`):

- **`DbLeaseBackend`** — canonical for cluster Job pods when `LORE_DB_HOST` is set. Postgres row in `pipeline.task_leases` with `expires_at TIMESTAMPTZ`. Acquisition via a CTE-based upsert that captures the previous holder for takeover detection. Refresh = `UPDATE … WHERE branch_name AND holder`. Release = `DELETE`.
- **`FileLeaseBackend`** — fallback for the local runner when no `LORE_DB_HOST` is configured. Files under `~/.lore/leases/`, one JSON file per branch (URL-encoded filename). Same interface; OTEL spans share the same `lore.lease.*` names with a `backend: file` attribute.

**Rationale for dual backends:** The original research rejected file-based leases as "local-only, doesn't help GKE supervisors." This was correct for GKE supervisors. However, requiring a Postgres connection for _local_ runner development created friction — the local runner already operates without DB access. The interface abstraction allows both paths to share the same `LeaseBackend` contract while selecting the appropriate storage at startup.

**Lease TTL:** 10 minutes default, refreshed before each graph node executes. Lease reaper (60s tick) deletes rows/files older than 5 minutes past expiry; takeovers emit a `lease_expired` audit entry naming the prior holder (`tookOverFrom` field on `AcquireResult`).

**Postgres acquire CTE:** Captures the `previous_holder` so a successor pod knows whether it took over from an expired peer (T027). The CTE reads the current row before the conditional upsert, then `RETURNING (SELECT prev_holder FROM prev)` surfaces it in the result set.

**Alternatives considered:** Postgres advisory locks (rejected — connection-bound), Kubernetes `coordination.k8s.io/Lease` (rejected — couples local runner to k8s API).

## R3: GitHub API failure modes

**Decision:** Three distinct failure classes, each handled differently.

| Failure | Behavior |
|---|---|
| **Auto-merge call fails (5xx, rate limit, mergeability check)** | Retry up to 3 attempts with exponential backoff; on final failure, write `auto_merge_decision` audit entry with `outcome: "deferred:api_failure"` and let PR sit open for human merge. Do not block the workflow. |
| **Issue creation fails on escalation** | Same 3-attempt pattern; on final failure, write `escalation_issued` audit entry with `outcome: "audit_only"` and fire `escalation` notification with full context inline (Slack message carries what the Issue would have). Supervisor still marks task `needs-human-help`. |
| **Comment / review-post fails** | Single retry; on failure, log and continue. The verdict is in the commit trailer and audit log; the PR comment is convenience, not source of truth. |

**Backoff implementation note:** Both `mergeWithBackoff` and `createIssueWithBackoff` use `delays = [1000, 4000]` (milliseconds). The loop iterates over `delays.length` attempts — 2 total, with a 1s wait after the first failure. The original research spec'd `[1s, 4s, 16s]` across 3 retries; this was scaled back during implementation to reduce supervisor lease hold time. The comment in `escalation.ts` notes: "burning 21s on retries doesn't buy reliability proportional to the lease-hold cost."

**Additional deferral: `deferred:no_changes`:** The auto-merge engine has an 8th deferral outcome beyond the original 7. A PR with zero changed files passes the path-allowlist check vacuously (empty set) but would cause GitHub's merge API to 422. The engine now surfaces the real reason — `deferred:no_changes` — rather than attempting and failing the merge call.

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

lore.lease.{acquire|refresh|release}
  attrs: branch_name, task_id, holder, ttl_sec, backend, outcome
  parent: lore.stage  (for refresh) or lore.supervisor (for acquire/release)
  note: backend attr = "db" | "file" distinguishes the two backends (R2)

lore.auto_merge.decision
  attrs: pr_number, repo, decision, rule, trust_level,
         path_match_count, ci_status, bot_review_state
  parent: lore.task
```

**Note:** The original research listed `lore.lease.expired` as a fourth lease span. Pod-death expiry is audited via `writeAuditLog` (event_type `lease_expired`) rather than a span — the expired holder's pod is dead and cannot emit spans. The takeover is recorded on the successor pod's `lore.lease.acquire` span via the `took_over_from` attribute.

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

**Decision:** Four node types (`agent | validate | gate | retrospective`), edge condition language is a small enum (`success | changes_requested | failed | always`), no scripting. Schema enforced by Zod at load time in `agent/src/workflow/loader.ts`.

**Required workflow document fields:** `name`, `description`, `version: 1`, `entry`, `exit`, `nodes`, `edges`. Node `id` must match `/^[a-z][a-z0-9_-]*$/`. `version: 1` literal is required and will be incremented if the schema gets a breaking change.

**Rationale:** A scriptable edge language (e.g. CEL, expr) tempts complexity creep — workflow authors writing arbitrary expressions inside YAML. The four-condition enum is sufficient for every existing flow we've ported and forces complex branching to be modeled as nodes rather than expressions. If we need more, add a fifth condition later — additive change.

**Iteration caps:** Loops are expressed as named back-edges with an `iteration_max` attribute on the back-edge, not as arbitrary cycles. Graph executor refuses cyclic graphs without an explicit cap (enforced by iterative DFS coloring at parse time — avoids stack overflow on deeply nested hand-authored YAML).

**Validation checks enforced by `parseWorkflow`:** dangling node references, unreachable nodes (BFS from entry), non-exit terminal nodes (every non-exit node must have at least one outgoing edge), back-edges without `iteration_max`, duplicate workflow names within a directory.

## R9: CODEOWNERS approval ceremony

**Decision:** The settings PUT must include an `X-Lore-Approval-PR` header carrying an `owner/repo#N` reference. The MCP server validates: PR is open, carries the `dark-factory-approval` label, and the label was applied by a direct `@user` CODEOWNERS member of the affected repo. Validated at the moment the settings PUT lands by `verifyApproval()` in `mcp-server/src/dark-factory-authz.ts`.

**v1 limitations (both are documented follow-ups):**

1. **Same-repo requirement only.** The original research proposed a centralized `lore-settings/<repo>.yaml` PR path. This was deferred; v1 requires the approval PR to be against the same repo whose settings are being changed (`owner/repo` must match `targetRepo`). A centralized settings-PR approach requires resolving which CODEOWNERS file governs which settings and is left for a later iteration.

2. **No team handle resolution.** CODEOWNERS entries using `@org/team` form cause a `team_membership_unresolved` error with an actionable message. Individual `@user` entries work. Team-membership lookup via the GitHub team API requires `read:org` scope and per-team caching — tracked as a follow-up. Operators with team-only CODEOWNERS entries should add an explicit individual `@user` entry for the approver until this lands.

**Two-key fields:** Beyond the original spec's `enabled` and `auto_merge.paths`, the implementation also gates on downgrade-only changes to `require_green_ci = false` and `require_bot_approval = false` — setting either safety flag to `false` is treated as a privileged change. Upgrading (setting to `true`) does not require the ceremony. All other sub-settings (`notify`, `create_issue`, `review`, `auto_merge.min_trust`) require admin scope only.

**CODEOWNERS lookup order:** `.github/CODEOWNERS` → `CODEOWNERS` → `docs/CODEOWNERS` (GitHub's canonical order). Approver need only appear anywhere in the file for v1; per-path CODEOWNERS gating is a follow-up.

**Rationale:** Reuses GitHub's existing review machinery; no new approval system. A PR is auditable, revertable, and CODEOWNERS already protects sensitive paths.

**Alternatives considered:** Two-person rule via approval API endpoint (rejected — new approval surface to maintain), Slack-button approval (rejected — no audit trail).

## R10: Migration sequence

**Decision:** Schema migration first (Task 1.1), then code deploys default `dark_factory.enabled = false`. Existing repos behave identically until explicitly opted in via the settings ceremony. Pilot rollout (Task 5.3) on three trust-tiered repos for 14 days each before any default change.

**Rationale:** Backwards-compatible by construction. SC8 (adoption gate) prevents accidental wide rollout.

## R11: Runner-cli exit code matrix

**Decision:** The `runner-cli.ts` pod entry point exits with a structured code matrix consumed by `entrypoint.sh` and the loretask-watcher failure-reason field. Callers must not treat all non-zero exits identically.

| Code | Reason | Watcher response |
|------|--------|-----------------|
| 0 | `completed` | Create PR |
| 2 | `not_a_git_workdir` | Mark `needs-human-help` (config error) |
| 3 | `workflow_load_failed` | Mark `needs-human-help` (config error) |
| 4 | `workflow_not_found` | Mark `needs-human-help` (config error) |
| 5 | `lease_held` | Exit cleanly; another pod owns the branch |
| 6 | `iteration_max_exceeded` | Escalate via `escalate()` (graph aborted on back-edge) |
| 7 | `executor_error` | Mark `needs-human-help` (runtime error mid-run) |
| 8 | `executor_pending` | Mark `needs-human-help` (workflow + handlers not configured — should not occur in production) |
| 9 | `env_missing` | Mark `needs-human-help` (controller misconfiguration) |
| 1 | Node uncaught exception | Treat same as `executor_error` |

**Rationale:** A coarse "non-zero = failure" distinction cannot distinguish a clean lease-yield (exit 5, no action needed) from a runtime crash (exit 7, needs escalation) from a config bug (exits 3/4/9, needs operator). The typed matrix lets the watcher apply the correct response without inspecting log content.

## R12: IterationMaxExceededError and escalation hook

**Decision:** The graph executor throws a typed `IterationMaxExceededError` (not a generic `Error`) when a back-edge's `iteration_max` counter is exceeded. The `ExecuteOptions.onIterationMaxExceeded` hook is called before the throw so the supervisor can fire `escalate()` with full context before the process unwinds.

**Rationale:** Loop overflow is an expected exception path (not a bug), and the supervisor needs to produce a `needs-human-help` Issue with the failing branch link and diagnostic before the error propagates up to the runner-cli error handler. Separating the hook from the throw allows the hook to be unit-tested independently and means hook failures (e.g. GitHub API down during escalation) are caught and logged without suppressing the original error.

**Usage:** `runner-cli.ts` wires `onIterationMaxExceeded` to call `escalate()` on the supervisor's Octokit instance. If the hook throws, the executor logs a warning and proceeds to throw `IterationMaxExceededError` — the runner-cli then exits with code 6, which the watcher maps to `iteration_max_exceeded`.

## R13: notify default and escalation guarantee

**Decision:** `resolveSettings()` returns `notify: []` (empty array) when `enabled = true`, not `["escalation"]` as the original spec described. `decideNotify()` in `agent/src/lib/notify.ts` unconditionally fires for `escalation`-level messages regardless of the configured channel list: the first branch of the function is `if (level === "escalation") return { fire: true, … }`, which runs before the channel-list check.

**Rationale:** Listing `escalation` in the repo's `notify` array was redundant noise — the guarantee that escalations always reach a human is provided by the `decideNotify` implementation, not by the config. An empty notify list in dark mode correctly suppresses routine `pr_open` and `completion` notifications while preserving the unconditional escalation signal. This makes the default cleaner for operator inspection (an empty list is semantically "silent except for escalations") without weakening the safety guarantee.

**Effective channel behavior for dark-mode repos (notify: []):**
- `escalation` → always fires (hardcoded in `decideNotify`)
- `watched` / `completion` → fires only when the task creator opted in via `notify_on_completion: true` at creation time (unaffected by repo-level setting)
- `pr_open` → suppressed (dark-mode intent: no per-PR Slack noise)
- `all` → suppressed (dark-mode intent; `all` only fires on opt-out repos)
