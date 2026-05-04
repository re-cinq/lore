# Data Model: Dark Factory Mode

## New tables

### `pipeline.task_leases`

Single source of truth for "who's currently working on this task's branch."

```sql
CREATE TABLE pipeline.task_leases (
  branch_name   TEXT        PRIMARY KEY,
  task_id       UUID        NOT NULL,
  holder        TEXT        NOT NULL,            -- pod name or local hostname
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  phase         TEXT,                            -- last advertised graph node
  CONSTRAINT task_leases_task_fk FOREIGN KEY (task_id)
    REFERENCES pipeline.tasks(id) ON DELETE CASCADE
);

CREATE INDEX task_leases_expires_idx ON pipeline.task_leases(expires_at);
```

**Lifecycle:**

- `INSERT … ON CONFLICT (branch_name) DO UPDATE SET … WHERE task_leases.expires_at < now()` → atomic acquire-or-takeover.
- `UPDATE … SET expires_at = now() + interval '10 min', phase = $phase WHERE branch_name = $1 AND holder = $2` → refresh (only the current holder can refresh).
- `DELETE WHERE branch_name = $1 AND holder = $2` → release on graceful exit.
- `lease-reaper` job: `DELETE WHERE expires_at < now() - interval '5 min'` (grace window for clock skew).

**Backends:**

Two implementations share the `LeaseBackend` interface (`agent/src/supervisor/lease.ts`):

- `DbLeaseBackend` — Postgres CTE-based atomic acquire with takeover detection. Used by cluster supervisors when `LORE_DB_HOST` is set.
- `FileLeaseBackend` — JSON file per branch under `~/.lore/leases/` (filenames are URL-encoded branch names to avoid path issues with `/`). Used by the local runner when no DB is configured.

The `tookOverFrom` field on `AcquireResult` is set when the acquire succeeds by taking over an expired prior holder's row. The supervisor uses this to emit a `lease_expired` audit entry (T027). It is `undefined` when the acquire was a fresh insert with no prior row.

### `pipeline.dark_factory_baseline`

Per-repo snapshot of pre-feature counters used to measure SC1, SC4, SC6 deltas after the pilot. Captured once at T011b execution (Phase 2); re-captured on demand if the pre-pilot environment changes materially.

```sql
CREATE TABLE pipeline.dark_factory_baseline (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  repo          TEXT         NOT NULL,
  captured_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  window_start  TIMESTAMPTZ  NOT NULL,
  window_end    TIMESTAMPTZ  NOT NULL,
  counters      JSONB        NOT NULL
);
CREATE INDEX dark_factory_baseline_repo_idx
  ON pipeline.dark_factory_baseline(repo, captured_at DESC);
```

`counters` shape:

```json
{
  "job_pods_per_impl_task_p50": 4,
  "issues_per_week": 11,
  "bot_pr_no_human_review_share": 0.0,
  "median_time_to_merge_hours": 72,
  "_job_pods_source": "static_baseline"
}
```

`_job_pods_source` tracks data provenance: `"static_baseline"` means the value was filled from the architectural constant (4 pods per impl task) because OTEL-side capture isn't wired yet; `"otel"` means it was measured from production spans. T060 compares the 30-day post-pilot window against the most recent baseline row per repo to produce SC1/SC4/SC6 deltas.

## Modified tables

### `pipeline.tasks`

Add columns:

```sql
ALTER TABLE pipeline.tasks
  ADD COLUMN IF NOT EXISTS dark_factory_overrides JSONB DEFAULT NULL;

ALTER TABLE pipeline.tasks
  ADD COLUMN IF NOT EXISTS context_refs JSONB DEFAULT NULL;
```

`dark_factory_overrides` shape (all optional):

```json
{
  "human_review": "required",
  "with_issue": true,
  "notify_on_completion": true
}
```

Per-task overrides merge over per-repo settings at supervisor start (per-task wins).

`context_refs` records which memory/fact keys contributed to the task's assembled context. Used by the PR outcome feedback loop to boost (`+5 half_life_days`) or penalize (`-3`, min 7) contributing memories on merge or rejection.

### `lore.repos.settings.dark_factory`

The existing `lore.repos.settings` JSONB column gets a documented `dark_factory` sub-shape (no schema change — JSONB):

```json
{
  "dark_factory": {
    "enabled": false,
    "create_issue": "on_gate",
    "auto_merge": {
      "paths": ["specs/**", "adrs/**", "*.md", "CLAUDE.md", ".claude/**"],
      "min_trust": "docs",
      "require_green_ci": true,
      "require_bot_approval": true
    },
    "review": "trust_based",
    "notify": []
  }
}
```

**Validation rules** (enforced by `mcp-server/src/dark-factory-settings.ts` Zod schema):

- `enabled`: boolean, default `false`.
- `create_issue`: enum `never | on_gate | always`, default `on_gate` when `enabled = true`, `always` otherwise.
- `auto_merge.paths`: array of minimatch globs, max 32 entries.
- `auto_merge.min_trust`: enum `docs | tests | implementation | full`, default `docs`.
- `auto_merge.require_green_ci`: boolean, default `true`. Setting to `false` rejected unless `dark-factory-approval` PR justifies.
- `auto_merge.require_bot_approval`: boolean, default `true`. Same rejection rule.
- `review`: enum `trust_based | always | never`, default `trust_based` when `enabled = true`, `always` otherwise.
- `notify`: array of enum `escalation | watched | all`. Default `[]` when `enabled = true`, `["all"]` otherwise. An empty notify list in dark mode is intentional: `decideNotify` always fires the `escalation` channel regardless of this field (escalations are never silenced), so listing it explicitly was redundant noise.

**Canonical types and resolver:**

`ResolvedDarkFactorySettings`, `DarkFactorySettings`, `resolveDarkFactorySettings()`, and `trustMeets()` are exported from `@re-cinq/lore-shared` (`shared/src/dark-factory-settings.ts`) so agent, mcp-server, and GKE Job pod runner share one source. The Zod input-validation schema stays in `mcp-server/src/dark-factory-settings.ts` (the only edge accepting raw user input).

**AuthZ tiers** (per FR3.9):

| Field path | AuthZ tier |
|---|---|
| `dark_factory.enabled` | Two-key (admin + CODEOWNERS PR) |
| `dark_factory.auto_merge.paths` | Two-key |
| `dark_factory.auto_merge.require_green_ci` (if set to false) | Two-key |
| `dark_factory.auto_merge.require_bot_approval` (if set to false) | Two-key |
| All other sub-fields | Admin scope only |

`twoKeyFieldsTouched(patch: DarkFactorySettings): string[]` in `mcp-server/src/dark-factory-settings.ts` returns the list of privileged field names touched by a patch. It operates on the `dark_factory` sub-document (already extracted), so returned names are relative (e.g. `"enabled"`, `"auto_merge.paths"`) not fully qualified.

## Audit log event types

`pipeline.audit_log` is a **new** table created by the dark-factory migration (the existing `memory.audit_log` is memory-scoped and lacks `task_id` / `repo` fields). Schema:

```sql
CREATE TABLE pipeline.audit_log (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT         NOT NULL,
  task_id      UUID,
  repo         TEXT,
  actor        TEXT,
  payload      JSONB        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_task_idx  ON pipeline.audit_log(task_id, created_at DESC);
CREATE INDEX audit_log_event_idx ON pipeline.audit_log(event_type, created_at DESC);
CREATE INDEX audit_log_repo_idx  ON pipeline.audit_log(repo, created_at DESC);
```

`event_type`, `task_id`, `repo`, and `actor` are top-level table columns. `payload` contains event-specific data. The examples below show the `payload` JSONB value; `task_id` and `repo` are NOT duplicated inside `payload` — they live as table columns only.

### `auto_merge_decision`

`payload` shape:

```json
{
  "pr_number": 1234,
  "outcome": "merged | deferred:human_review | deferred:ci_failed | deferred:bot_changes_requested | deferred:path_outside_allowlist | deferred:trust_too_low | deferred:dark_mode_off | deferred:no_changes | deferred:api_failure",
  "rule": {
    "path_match_count": 3,
    "trust_level": "docs",
    "ci_status": "success | failed | pending",
    "bot_review_state": "APPROVED | CHANGES_REQUESTED | PENDING",
    "human_changes_requested": false
  },
  "decided_at": "2026-04-28T12:34:56Z"
}
```

`deferred:no_changes` fires when `changedPaths` is empty — a zero-file PR passes the path-allowlist check via vacuous truth but GitHub's merge call would 422. Surfacing the real reason in the audit log makes the deferral diagnosable.

`ci_status` can be `"pending"` when the status check query returns a non-conclusive result (e.g. checks still in progress at decision time).

### `dark_factory_setting_changed`

`payload` shape:

```json
{
  "field_path": "dark_factory.enabled",
  "prev_value": false,
  "new_value": true,
  "ceremony": {
    "tier": "two_key",
    "admin_token_id": "tok_abc",
    "codeowners_pr": "owner/repo#42",
    "approver": "alice@re-cinq.com"
  },
  "changed_at": "2026-04-28T12:34:56Z"
}
```

`actor` (table column) = `michael@re-cinq.com` (the token holder making the PUT request). `ceremony.approver` = the GitHub login who applied the `dark-factory-approval` label on the approval PR.

### `lease_expired`

`payload` shape:

```json
{
  "branch_name": "lore/feature/...",
  "previous_holder": "pod-abc-123",
  "expired_at": "..."
}
```

`task_id` (table column) identifies the task whose branch was taken over.

### `escalation_issued`

`payload` shape:

```json
{
  "branch_name": "...",
  "reason": "validation_failed_twice | bot_review_failed_parse | supervisor_panic",
  "issue_number": 99,
  "issue_url": "https://github.com/...",
  "outcome": "issue_created | audit_only",
  "issued_at": "..."
}
```

## Two-key ceremony

`verifyApproval()` in `mcp-server/src/dark-factory-authz.ts` performs the ceremony check. Caller has already validated bearer token + admin scope; `verifyApproval` adds the CODEOWNERS check.

**v1 limitations:**

- CODEOWNERS lookup is repo-wide (any matching `@user` handle anywhere in the file), not scoped to the `CLAUDE.md` path specifically. Tightening to per-path ownership is a follow-up.
- Team handles (e.g. `@org/team`) cannot be resolved in v1 — the GitHub team membership API requires `read:org` scope and per-team caching. If CODEOWNERS contains only team handles, `verifyApproval` throws `TwoKeyError` with code `"team_membership_unresolved"`. Add direct `@user` owner entries for the approver as a workaround.
- The approval PR must be in the same repo as the settings being changed (`"wrong_repo"` error if not). A centralized `lore-settings` repo is not supported in v1.

**Error codes** (`TwoKeyError.code`):

| Code | Meaning |
|---|---|
| `missing_header` | `X-Lore-Approval-PR` header absent |
| `invalid_pr_ref` | Header value doesn't match `owner/repo#N` |
| `pr_not_found` | PR doesn't exist (GitHub 404) |
| `pr_state` | PR is closed or merged (must be open) |
| `label_missing` | `dark-factory-approval` label not on the PR |
| `approver_not_codeowner` | Label applier is not in CODEOWNERS |
| `team_membership_unresolved` | CODEOWNERS only lists team handles (v1 limitation) |
| `codeowners_unparseable` | GitHub API error reading CODEOWNERS |
| `github_api` | Other Octokit error |
| `wrong_repo` | Approval PR is against a different repo |

## Workflow graph (new entity)

Files at `agent/src/workflows/<name>.yaml` define the graph for a task type. Loaded at supervisor start via `agent/src/workflow/loader.ts`. Schema in `contracts/workflow-yaml-schema.md`.

The YAML schema enforces at parse time:
- All node and edge references resolve.
- Every non-exit node has at least one outgoing edge.
- Every non-exit node is reachable from `entry` (BFS).
- Back-edges (cycles, detected by DFS coloring) require `iteration_max` on the edge. Back-edges without `iteration_max` are a load-time error.

Per-repo overrides in `settings.workflows[]` array can replace the default for any task type; that field is planned but not yet implemented — `settings.workflows` has no effect in v1.

## Stage Commit (entity)

A git commit emitted at the end of each graph node. Identified by:

- The branch (a feature branch keyed to one task).
- The trailer block, parsed by `@re-cinq/lore-shared` `parseTrailers`.
- Mandatory trailers: `Lore-Stage`, `Lore-Iteration`, `Lore-Task`. Optional extras merged via `formatTrailers`: `Lore-Outcome`, `Lore-Cost-Tokens`, `Lore-Validation-Status`.

Trailer format (RFC 5322-style, last paragraph of the commit message body):

```
[stage:implement] iter=1

Lore-Stage: implement
Lore-Iteration: 1
Lore-Task: 7f3c4a01-8b2e-4c1d-a9f6-1234567890ab
Lore-Outcome: success
```

`Lore-Task: <uuid>` MUST also appear in the final PR body (FR1.5).

Stage commits are `--allow-empty` for non-file-changing nodes (validate, gate, retrospective) per FR1.3. The commit subject is `[stage:<id>] iter=<N>`.

## Relationships

```
lore.repos
  └─ settings (JSONB)
       └─ dark_factory (sub-doc)

pipeline.tasks
  ├─ dark_factory_overrides (JSONB)
  ├─ context_refs (JSONB)
  ├─ task_leases (1:0..1, by branch_name)
  └─ audit_log (1:N, by task_id)

agent/src/workflows/*.yaml  (file-system entities, loaded at runtime)
  └─ referenced by task.task_type

@re-cinq/lore-shared (shared/src/dark-factory-settings.ts)
  └─ canonical types: DarkFactorySettings, ResolvedDarkFactorySettings,
     resolveDarkFactorySettings(), trustMeets()
  └─ consumed by: agent, mcp-server, GKE Job pod runner
```

## Validation rule summary

- `auto_merge.paths` MUST contain at least one entry when `enabled = true`. Default applied if omitted.
- `min_trust` MUST be ≤ repo's current trust level for any auto-merge to fire.
- A task cannot have both `dark_factory_overrides.with_issue = false` and `task_type` requiring approval; the latter wins (P6 distributed ownership: a CODEOWNER asking for approval cannot be silently overridden).
- `task_leases` rows are unique by `branch_name`; a single branch is owned by at most one supervisor at a time.
- `deferred:no_changes` fires before path-allowlist evaluation; an empty-diff PR never reaches the merge call.
