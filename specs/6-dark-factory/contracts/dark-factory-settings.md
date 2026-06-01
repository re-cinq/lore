# Contract: Dark Factory settings API

Endpoints for reading and mutating the per-repo `settings.dark_factory` block.
Tiered authorization per FR3.9.

> **Canonical types** (`ResolvedDarkFactorySettings`, `resolveDarkFactorySettings`,
> `trustMeets`) live in `@re-cinq/lore-shared` (`shared/src/dark-factory-settings.ts`).
> The Zod validation schema lives in `mcp-server/src/dark-factory-settings.ts`.
> Two-key authorization is in `mcp-server/src/dark-factory-authz.ts`.

## Endpoints

### `GET /api/repos/:owner/:repo/settings/dark-factory`

Return the fully-resolved (defaults applied) settings for the repo.

**Authorization:** `admin` scope (same as PUT — the URL-level scope override in
`routes.ts` applies to all methods on this path).

**Response 200** — fully resolved with defaults applied.
For a repo with `enabled: false` and no stored overrides the defaults are:

```json
{
  "enabled": false,
  "create_issue": "always",
  "auto_merge": {
    "paths": ["specs/**", "adrs/**", "*.md", "CLAUDE.md", ".claude/**"],
    "min_trust": "docs",
    "require_green_ci": true,
    "require_bot_approval": true
  },
  "review": "always",
  "notify": ["all"]
}
```

For a repo with `enabled: true` and no stored overrides:

```json
{
  "enabled": true,
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
```

> **Note on `notify` default in dark mode:** `decideNotify` always fires
> `escalation` unconditionally regardless of the `notify` list, so listing
> `"escalation"` explicitly would be redundant noise. An empty list is correct
> when `enabled: true`.

**Response 404:** repo not onboarded.

---

### `PUT /api/repos/:owner/:repo/settings/dark-factory`

Mutate settings. Body MUST be a partial patch (only fields to change).

**Authorization:** `admin` scope. If the patch touches a **two-key field** (see
below), the request MUST also carry a valid `X-Lore-Approval-PR` header.

**Request body** (partial patch — only fields to change):

```json
{
  "enabled": true,
  "auto_merge": {
    "paths": ["specs/**", "*.md", "runbooks/**"]
  }
}
```

**Response 200** — the full resolved settings after the patch is applied, plus
a `ceremony` record describing which authorization tier was used:

```json
{
  "ok": true,
  "applied": {
    "enabled": true,
    "create_issue": "on_gate",
    "auto_merge": {
      "paths": ["specs/**", "*.md", "runbooks/**"],
      "min_trust": "docs",
      "require_green_ci": true,
      "require_bot_approval": true
    },
    "review": "trust_based",
    "notify": []
  },
  "ceremony": {
    "tier": "two_key",
    "pr_ref": "owner/repo#42",
    "approver": "alice",
    "pr_url": "https://github.com/owner/repo/pull/42"
  }
}
```

For admin-only changes (no two-key field touched) `ceremony` is:

```json
{ "tier": "admin" }
```

> No `audit_log_id` is returned in the response. The audit entry is written to
> `pipeline.audit_log` with `event_type = 'dark_factory_setting_changed'` but
> its ID is not surfaced to the caller.

**Response 400:** Zod validation error — body contains a `issues` array.

**Response 403 — two-key fields not covered:**

```json
{
  "error": "two_key_required",
  "field_paths": ["enabled", "auto_merge.paths"],
  "detail": "Privileged fields require an X-Lore-Approval-PR header. Reference an open PR labeled `dark-factory-approval` by a CODEOWNER."
}
```

**Response 403 — CODEOWNERS/ceremony check failed:**

```json
{
  "error": "codeowners_check_failed",
  "code": "<TwoKeyError.code>",
  "detail": "<human-readable message>"
}
```

`code` values (from `TwoKeyError`):

| `code` | Meaning |
|---|---|
| `missing_header` | `X-Lore-Approval-PR` header absent |
| `invalid_pr_ref` | Header value not in `owner/repo#N` format |
| `pr_not_found` | Referenced PR does not exist |
| `pr_state` | PR is merged or closed (ceremony requires open PR) |
| `label_missing` | `dark-factory-approval` label not found on PR |
| `approver_not_codeowner` | The user who applied the label is not in CODEOWNERS |
| `team_membership_unresolved` | CODEOWNERS contains only team handles (`@org/team`); team-membership lookup not implemented in v1 |
| `codeowners_unparseable` | CODEOWNERS file fetch or parse failed |
| `github_api` | Unexpected GitHub API error |
| `wrong_repo` | Approval PR is against a different repo (v1 requires same repo) |

**Response 401:** missing or invalid bearer token.

**Response 503:** GitHub API unavailable during two-key validation:

```json
{ "error": "github_api_unavailable" }
```

> No `Retry-After` header is set in the current implementation.

---

## Two-key fields

| Field path | Why two-key |
|---|---|
| `enabled` | Master switch — any change requires ceremony |
| `auto_merge.paths` | Any change to the allowlist |
| `auto_merge.require_green_ci` | Only when set to `false` (downgrade) |
| `auto_merge.require_bot_approval` | Only when set to `false` (downgrade) |

All other sub-fields require `admin` scope only (no ceremony).

---

## Audit log entry

Every successful PUT writes a `dark_factory_setting_changed` entry to
`pipeline.audit_log`. The `payload` JSONB contains:

```json
{
  "field_paths_changed": ["enabled", "auto_merge"],
  "two_key_fields": ["enabled", "auto_merge.paths"],
  "prev": { "<previous resolved settings>" },
  "next": { "<new resolved settings>" },
  "ceremony": { "tier": "two_key", "pr_ref": "...", "approver": "...", "pr_url": "..." }
}
```

---

## CODEOWNERS approval ceremony

The `X-Lore-Approval-PR` header value must be in `owner/repo#N` format and
reference a PR **on the same repo** whose settings are being mutated (v1
enforces same-repo via `wrong_repo` check).

The referenced PR must:

1. Be currently **open** (not merged or closed).
2. Have the `dark-factory-approval` label applied by a CODEOWNERS member of the
   repo.

CODEOWNERS is looked up in this order: `.github/CODEOWNERS` → `CODEOWNERS` →
`docs/CODEOWNERS` (GitHub's canonical resolution order).

**v1 limitation:** Only direct `@user` handles are resolved. Team handles
(`@org/team`) produce a `team_membership_unresolved` 403. Add explicit `@user`
entries for approvers until per-path team-membership resolution ships.

The approval PR is the ceremony record — it can be merged or closed after the
settings PUT succeeds. The web-ui settings editor can automate creating and
labeling the PR when the actor has both `admin` scope and CODEOWNERS membership;
otherwise it is a manual `gh` step.

---

## Failure modes

| Failure | Behavior |
|---|---|
| GitHub API down at two-key validation time | `503 { "error": "github_api_unavailable" }` — no `Retry-After` header |
| CODEOWNERS file missing | Empty CODEOWNERS treated as no entries; any approver fails `approver_not_codeowner` |
| CODEOWNERS file unparseable (non-404 API error) | `codeowners_unparseable` TwoKeyError → 403 `codeowners_check_failed`; settings unchanged |
| Concurrent two-key changes (race) | Last-writer-wins; both get 200; both audit entries written |
| Approval PR against wrong repo | `wrong_repo` TwoKeyError → 403 `codeowners_check_failed` |

---

## Per-task overrides

Per-task `dark_factory_overrides` are stored in `pipeline.tasks.dark_factory_overrides`
(JSONB, default null) and accepted at task creation via `POST /api/tasks`:

```json
{
  "task_type": "general",
  "description": "...",
  "target_repo": "owner/repo",
  "dark_factory_overrides": {
    "human_review": "required",
    "with_issue": true,
    "notify_on_completion": true
  }
}
```

The `DarkFactoryTaskOverrides` type (from `agent/src/lib/dark-factory.ts`):

```ts
interface DarkFactoryTaskOverrides {
  human_review?: "required";
  with_issue?: boolean;
  notify_on_completion?: boolean;
}
```

**Authorization:** No special scope needed — per-task overrides only *strengthen*
gates (force human review, force Issue creation). They cannot weaken them. If
`with_issue: false` conflicts with a task type that requires approval, approval
wins.
