# Contract: Dark Factory settings API

Endpoints for reading and mutating the per-repo `settings.dark_factory` block. Tiered authorization per FR3.9.

## Endpoints

### `GET /api/repos/:owner/:repo/settings/dark-factory`

Read current settings. Requires `read` scope. Always returns the **resolved** form (all fields populated with defaults).

**Response 200 — repo with `enabled: false` (default):**

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

**Response 200 — repo with `enabled: true` (dark mode on):**

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

Note: `notify: []` in dark mode is correct (FR3.5 specified `[escalation]` as the initial default, but that was revised — `decideNotify` always fires escalations regardless of the list, so listing `escalation` explicitly is redundant). The `notify` list controls non-escalation channels only.

**Response 404:** repo not onboarded.
**Response 503:** database unavailable.

### `PUT /api/repos/:owner/:repo/settings/dark-factory`

Mutate settings. Body MUST be a partial patch (only fields to change).

Requires `admin` scope. If the patch touches a **two-key field** (see below):

- Header `X-Lore-Approval-PR: <owner>/<repo>#<number>` MUST be present.
- The referenced PR MUST be open (`state: "open"`), have label `dark-factory-approval`, and the label MUST have been applied by a member listed in the affected repo's `CLAUDE.md` CODEOWNERS scope.
- The approval PR MUST target the same `owner/repo` as the settings being mutated.
- Validation occurs server-side; failure returns 403.

**Request body:**

```json
{
  "enabled": true,
  "auto_merge": {
    "paths": ["specs/**", "*.md", "runbooks/**"]
  }
}
```

**Response 200:**

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

`applied` is the **full merged settings** after the patch is applied (not a diff). For admin-only patches that do not touch two-key fields, `ceremony` is `{ "tier": "admin" }` with no other keys.

**Response 400:** Zod validation error (returns `issues` array).

**Response 403:**
- `error: "two_key_required"` with `field_paths: [...]` indicating which fields triggered, and a `detail` string. Returned when two-key fields are present but the `X-Lore-Approval-PR` header is missing or empty.
- `error: "codeowners_check_failed"` with `code` (see table below) and `detail` describing the failure.

**Response 401:** missing or invalid scope.

**Response 404:** repo not onboarded.

**Response 405:** method other than GET or PUT.

**Response 503:** GitHub API unavailable during two-key verification (`{ "error": "github_api_unavailable" }`), or database unavailable (`{ "error": "database unavailable" }`).

## Two-key fields

| Field path | Condition |
|---|---|
| `enabled` | Any change to the toggle |
| `auto_merge.paths` | Any change to the allowlist |
| `auto_merge.require_green_ci` | Only when set to `false` (downgrade) |
| `auto_merge.require_bot_approval` | Only when set to `false` (downgrade) |

All other sub-fields require admin scope only.

The `auto_merge.paths` array is capped at **32 entries** maximum; exceeding this returns a 400 Zod validation error.

## Audit log entry

Every successful PUT writes a `dark_factory_setting_changed` audit_log entry (schema in data-model.md). The entry payload includes:

```json
{
  "field_paths_changed": ["enabled", "auto_merge"],
  "two_key_fields": ["enabled", "auto_merge.paths"],
  "prev": { ... },
  "next": { ... },
  "ceremony": { "tier": "two_key", "pr_ref": "...", "approver": "alice", "pr_url": "..." }
}
```

`ceremony.tier` is `"admin"` for patches that do not touch two-key fields.

## CODEOWNERS approval ceremony

The "approval PR" referenced by `X-Lore-Approval-PR` must satisfy:

1. Targets the same `owner/repo` as the settings being mutated.
2. Is currently open (`state: "open"`).
3. Has label `dark-factory-approval`.
4. The label was applied by a user who appears as a direct `@user` owner in the repo's CODEOWNERS file.

**CODEOWNERS lookup order:** `.github/CODEOWNERS` → `CODEOWNERS` → `docs/CODEOWNERS` (GitHub's canonical resolution order). First file found wins. Returns empty set if none exist.

**v1 limitation — no per-path check:** The approver only needs to be a CODEOWNERS member *anywhere* in the file. Per-path CODEOWNERS matching (e.g., only owners of `CLAUDE.md`'s path) is a follow-up.

**v1 limitation — team handles not supported:** CODEOWNERS entries of the form `@org/team` are not resolved via the GitHub team membership API in v1. If the CODEOWNERS file contains only team handles, the server returns `code: "team_membership_unresolved"`. Fix: add an explicit `@user` handle for the approver alongside the team entry, or wait for the team-resolution follow-up.

### `codeowners_check_failed` error codes

| `code` | Meaning |
|---|---|
| `missing_header` | `X-Lore-Approval-PR` header absent (internal; normally returns `two_key_required` instead) |
| `invalid_pr_ref` | Header value does not match `owner/repo#N` format |
| `pr_not_found` | PR does not exist (404 from GitHub) |
| `pr_state` | PR is merged or closed; ceremony requires an open PR |
| `wrong_repo` | The approval PR targets a different repo than the settings being mutated |
| `label_missing` | Label `dark-factory-approval` is not present on the PR |
| `approver_not_codeowner` | Label applicator is not in the repo's CODEOWNERS |
| `team_membership_unresolved` | CODEOWNERS contains only team handles; cannot verify without team-membership API |
| `codeowners_unparseable` | CODEOWNERS file exists but could not be read (GitHub API error) |
| `github_api` | Unexpected GitHub API error during lookup |

## Failure modes

| Failure | Behavior |
|---|---|
| GitHub API down at validation time | `503 { "error": "github_api_unavailable" }` |
| CODEOWNERS file unparseable | `403 { "error": "codeowners_check_failed", "code": "codeowners_unparseable" }` |
| CODEOWNERS file absent | Treated as empty CODEOWNERS; approver check fails with `approver_not_codeowner` |
| Database unavailable | `503 { "error": "database unavailable" }` |
| Concurrent two-key changes (race) | Serialized by `SELECT FOR UPDATE`; second write patches on top of first write's committed state. Both succeed; both audit entries present. |

## Per-task overrides

Per-task `dark_factory_overrides` are set at task creation via the existing `POST /api/tasks` endpoint:

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

No special AuthZ — per-task overrides only *strengthen* gates (force human review, force Issue creation). They cannot weaken repo-level gates.

## Defaults summary

`resolveSettings()` / `resolveDarkFactorySettings()` in `shared/src/dark-factory-settings.ts` apply these defaults. Callers always receive the resolved form.

| Field | `enabled: false` default | `enabled: true` default |
|---|---|---|
| `create_issue` | `"always"` | `"on_gate"` |
| `auto_merge.paths` | `["specs/**","adrs/**","*.md","CLAUDE.md",".claude/**"]` | same |
| `auto_merge.min_trust` | `"docs"` | same |
| `auto_merge.require_green_ci` | `true` | same |
| `auto_merge.require_bot_approval` | `true` | same |
| `review` | `"always"` | `"trust_based"` |
| `notify` | `["all"]` | `[]` |
