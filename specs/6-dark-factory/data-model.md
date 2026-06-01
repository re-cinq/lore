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

**Backend abstraction (`LeaseBackend` interface):**

Two implementations share a common `LeaseBackend` interface
(`agent/src/supervisor/lease.ts`):

- `DbLeaseBackend` — canonical Postgres-backed lease used by cluster supervisors
  (FR1.6, Q4 clarification). Uses the CTE-based atomic acquire above; captures
  `tookOverFrom` on takeover for the `lease_expired` audit entry.
- `FileLeaseBackend` — file-system fallback for the local runner when no
  `LORE_DB_HOST` is configured. Leases live as JSON files under
  `~/.lore/leases/<encoded-branch>.json`. Same interface; no DB dependency.

The supervisor selects a backend at startup; downstream code never needs to know
which is in use.

### `pipeline.dark_factory_baseline`

Per-repo snapshot of pre-feature counters used to measure SC1, SC4, SC6 deltas
after the pilot. Captured once at T011b execution (Phase 2); re-captured on
demand if the pre-pilot environment changes materially.

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

`_job_pods_source` is a diagnostic annotation (`"static_baseline" | "otel"`).
Until OTEL-side capture is wired, the pod count is always recorded as the
architectural baseline of 4 so SC1 deltas remain measurable. T060 compares
the 30-day post-pilot window against the most recent baseline row per repo to
produce SC1/SC4/SC6 deltas.

## Modified tables

### `pipeline.tasks`

Add column:

```sql
ALTER TABLE pipeline.tasks
  ADD COLUMN IF NOT EXISTS dark_factory_overrides JSONB DEFAULT NULL;
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

### `lore.repos.settings.dark_factory`

The existing `lore.repos.settings` JSONB column gets a documented `dark_factory`
sub-shape (no schema change — JSONB):

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

**Canonical types + resolver** live in `@re-cinq/lore-shared`
(`shared/src/dark-factory-settings.ts`) so agent, mcp-server, and GKE Job pod
runner share one source. The Zod input-validation schema lives in
`mcp-server/src/dark-factory-settings.ts` (the only edge accepting raw user
input). The resolver is `resolveDarkFactorySettings()` exported from the shared
package.

**Validation rules** (enforced by `mcp-server/src/dark-factory-settings.ts`
Zod schema):

- `enabled`: boolean, default `false`.
- `create_issue`: enum `never | on_gate | always`, default `on_gate` when `enabled = true`.
- `auto_merge.paths`: array of minimatch globs, max 32 entries.
- `auto_merge.min_trust`: enum `docs | tests | implementation | full`, default `docs`.
- `auto_merge.require_green_ci`: boolean, default `true`. Setting to `false` requires the two-key ceremony.
- `auto_merge.require_bot_approval`: boolean, default `true`. Same requirement.
- `review`: enum `trust_based | always | never`, default `trust_based` when `enabled = true`.
- `notify`: array of `NotifyChannel` (`escalation | watched | all`), default `[]`
  when `enabled = true`. **Note:** an empty list in dark mode is correct —
  `decideNotify` (`agent/src/lib/notify.ts`) always fires `escalation`-level
  notifications regardless of the stored list, so listing `"escalation"`
  explicitly is redundant.

**`notify` vs. `NotifyLevel`:** The `notify` field stores `NotifyChannel`
values. The code distinguishes channels (`escalation | watched | all`) from
notification levels (`escalation | watched | completion | pr_open`):

| Level | Fires when |
|---|---|
| `escalation` | Always, even with an empty channels list |
| `watched` / `completion` | Only when `"watched"` is in channels |
| `pr_open` | Only when `"all"` is in channels (legacy behavior) |

Dark-mode repos with `notify: []` suppress per-PR Slack noise while still
receiving escalations.

**AuthZ tiers** (per FR3.9):

| Field path | AuthZ tier |
|---|---|
| `dark_factory.enabled` | Two-key (admin + CODEOWNERS PR) |
| `dark_factory.auto_merge.paths` | Two-key |
| `dark_factory.auto_merge.require_green_ci` (downgrade to `false`) | Two-key |
| `dark_factory.auto_merge.require_bot_approval` (downgrade to `false`) | Two-key |
| All other sub-fields | Admin scope only |

Two-key gating is enforced by `twoKeyFieldsTouched()` in
`mcp-server/src/dark-factory-settings.ts`, which triggers only when
`require_green_ci` or `require_bot_approval` is explicitly set to `false`
(a downgrade), not for any change to those fields.

## Audit log event types

`pipeline.audit_log` is a **new** table created by the dark-factory migration
(the existing `memory.audit_log` is memory-scoped and lacks `task_id` / `repo`
fields). Schema:

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

The four dark-factory `event_type` values populate the `payload` JSONB:

### `auto_merge_decision`

```json
{
  "event_type": "auto_merge_decision",
  "task_id": "uuid",
  "pr_number": 1234,
  "repo": "owner/repo",
  "outcome": "merged | deferred:human_review | deferred:ci_failed | deferred:bot_changes_requested | deferred:path_outside_allowlist | deferred:trust_too_low | deferred:dark_mode_off | deferred:no_changes | deferred:api_failure",
  "rule": {
    "path_match_count": 3,
    "trust_level": "docs",
    "ci_status": "success",
    "bot_review_state": "APPROVED",
    "human_changes_requested": false
  },
  "decided_at": "2026-04-28T12:34:56Z"
}
```

Full `AutoMergeOutcome` enum (nine values):

| Outcome | Meaning |
|---|---|
| `merged` | Squash-merged successfully |
| `deferred:human_review` | A human requested changes |
| `deferred:ci_failed` | `require_green_ci` true and CI not green |
| `deferred:bot_changes_requested` | `require_bot_approval` true and bot not APPROVED |
| `deferred:path_outside_allowlist` | At least one changed path missed every `auto_merge.paths` glob |
| `deferred:trust_too_low` | Repo trust level < `min_trust` |
| `deferred:dark_mode_off` | `dark_factory.enabled` is false — short-circuit before any path/CI check |
| `deferred:no_changes` | Zero changed files; vacuous path match would still 422 on GitHub merge |
| `deferred:api_failure` | GitHub merge API call failed after backoff |

### `dark_factory_setting_changed`

```json
{
  "event_type": "dark_factory_setting_changed",
  "repo": "owner/repo",
  "actor": "michael@re-cinq.com",
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

### `lease_expired`

```json
{
  "event_type": "lease_expired",
  "task_id": "uuid",
  "branch_name": "lore/feature/...",
  "previous_holder": "pod-abc-123",
  "expired_at": "..."
}
```

### `escalation_issued`

```json
{
  "event_type": "escalation_issued",
  "task_id": "uuid",
  "branch_name": "...",
  "reason": "validation_failed_twice | bot_review_failed_parse | supervisor_panic",
  "issue_number": 99,
  "issue_url": "https://github.com/...",
  "outcome": "issue_created | audit_only",
  "issued_at": "..."
}
```

## Workflow graph (new entity)

Files at `agent/src/workflows/<name>.yaml` define the graph for a task type.
Loaded at supervisor start. Schema in `contracts/workflow-yaml-schema.md`.

Per-repo overrides in `settings.workflows[]` array can replace the default for
any task type, validated against the same schema.

## Stage Commit (entity)

A git commit emitted at the end of each graph node. Identified by:

- The branch (a feature branch keyed to one task).
- The trailer block, parsed by `@re-cinq/lore-shared` `parseTrailers`.
- Mandatory trailers: `Lore-Stage`, `Lore-Iteration`, `Lore-Task`. Optional extras
  in `Trailers.extras` (e.g., `Lore-Outcome`, `Lore-Cost-Tokens`,
  `Lore-Validation-Status`).

Trailer format: `formatTrailers()` emits a `Key: Value` block as the last
paragraph of the commit message body. No `[stage:...]` prefix line is written
by the library; human-readable annotations in the subject line are at the
author's discretion.

```
[stage:implement] iter=1                       ← optional human summary in subject

Implements the /api/dark-factory route per FR3.x.

Lore-Stage: implement
Lore-Iteration: 1
Lore-Task: 7f3c4a01-8b2e-4c1d-a9f6-1234567890ab
Lore-Outcome: success
```

`parseTrailers()` extracts the last paragraph, validates all lines are
`Key: Value` shaped, and requires the three mandatory keys. Any additional
`Key: Value` lines land in `extras`. Returns `null` on any parse failure so
the supervisor treats it as "no recoverable stage."

`Lore-Task: <uuid>` MUST also appear in the final PR body (FR1.5).

## Relationships

```
lore.repos
  └─ settings (JSONB)
       └─ dark_factory (sub-doc)
            ├─ resolved by resolveDarkFactorySettings() in @re-cinq/lore-shared
            └─ validated by DarkFactorySettingsSchema (Zod) in mcp-server

pipeline.tasks
  ├─ dark_factory_overrides (JSONB)
  ├─ task_leases (1:0..1, by branch_name)
  │    ├─ DbLeaseBackend  — cluster path (Postgres CTE acquire)
  │    └─ FileLeaseBackend — local path (~/.lore/leases/<branch>.json)
  └─ audit_log (1:N, by task_id)

agent/src/workflows/*.yaml  (file-system entities, loaded at runtime)
  └─ referenced by task.task_type
```

## Validation rule summary

- `auto_merge.paths` MUST contain at least one entry when `enabled = true`. Default applied if omitted.
- `min_trust` MUST be ≤ repo's current trust level for any auto-merge to fire.
- A task cannot have both `dark_factory_overrides.with_issue = false` and `task_type` requiring approval; the latter wins (P6 distributed ownership: a CODEOWNER asking for approval cannot be silently overridden).
- `task_leases` rows are unique by `branch_name`; a single branch is owned by at most one supervisor at a time.
- `deferred:dark_mode_off` fires before any path/CI check — the full outcome decision tree is skipped when `enabled = false`, so the audit log entry still records the gate condition.
- `deferred:no_changes` fires when `changedPaths.length === 0` to avoid a vacuous path-match that would 422 on the GitHub merge call.
