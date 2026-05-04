# API Contract: Dark Factory Settings

## Overview

The Dark Factory settings API manages per-repo configuration for auto-merge behavior, notification channels, and approval ceremonies. All endpoints require authentication via GitHub App installation.

## GET /repos/{owner}/{repo}/dark-factory/settings

Read current settings. Requires `admin` scope.

**Parameters:**
- `owner` (string, required) — GitHub organization or user
- `repo` (string, required) — Repository name

**Response 200:**

```json
{
  "enabled": false,
  "auto_merge": {
    "paths": ["src/**", "*.md"],
    "min_trust": "high",
    "require_green_ci": true,
    "require_bot_approval": false
  },
  "create_issue": "always",
  "notify": ["all"],
  "review": {
    "dismiss_stale": true,
    "request_changes_blocks": false
  }
}
```

**Field defaults when `enabled: false`:**
- `create_issue: "always"` (not `"on_gate"`)
- `notify: ["all"]` (not `["escalation"]` — escalation is unconditional in code)
- `auto_merge.paths: []`
- `auto_merge.min_trust: "low"`
- `auto_merge.require_green_ci: true`
- `auto_merge.require_bot_approval: false`
- `review.dismiss_stale: false`
- `review.request_changes_blocks: true`

**Field defaults when `enabled: true`:**
- `create_issue: "on_gate"`
- `notify: []` (empty — escalations always fire regardless of this setting; see R13)
- `auto_merge.paths: []`
- `auto_merge.min_trust: "high"`
- `auto_merge.require_green_ci: true`
- `auto_merge.require_bot_approval: false`
- `review.dismiss_stale: true`
- `review.request_changes_blocks: false`

---

## PUT /repos/{owner}/{repo}/dark-factory/settings

Update settings. Requires `admin` scope and (for privileged fields) a valid approval ceremony.

**Headers:**
- `X-Lore-Approval-PR` (string, optional) — Approval PR reference in format `owner/repo#N`. Required if updating any two-key field (see R9).

**Request body:**

```json
{
  "enabled": true,
  "auto_merge": {
    "paths": ["src/**", "*.md"],
    "min_trust": "high",
    "require_green_ci": true,
    "require_bot_approval": false
  },
  "create_issue": "on_gate",
  "notify": [],
  "review": {
    "dismiss_stale": true,
    "request_changes_blocks": false
  }
}
```

All fields are optional; unspecified fields retain their current value.

**Response 200:**

```json
{
  "ok": true,
  "ceremony": {
    "tier": "two_key",
    "pr_ref": "owner/repo#N",
    "approver": "username",
    "pr_url": "https://github.com/owner/repo/pull/N"
  },
  "applied": {
    "enabled": true,
    "auto_merge": {
      "paths": ["src/**", "*.md"],
      "min_trust": "high",
      "require_green_ci": true,
      "require_bot_approval": false
    },
    "create_issue": "on_gate",
    "notify": [],
    "review": {
      "dismiss_stale": true,
      "request_changes_blocks": false
    }
  }
}
```

The `ceremony` object is only present if a two-key field was updated. The `applied` object contains the full merged settings after the update.

**Response 403 (Forbidden):**

```json
{
  "ok": false,
  "error": "two_key_required",
  "field_paths": ["auto_merge.require_green_ci", "require_bot_approval"],
  "message": "Downgrading safety flags requires approval ceremony. Supply X-Lore-Approval-PR header."
}
```

`field_paths` is an array of the specific fields that triggered the two-key requirement.

```json
{
  "ok": false,
  "error": "approval_invalid",
  "message": "PR #N is not open or label dark-factory-approval not applied by a CODEOWNERS member."
}
```

---

## Two-Key Fields (R9)

Changes to the following fields require the approval ceremony:

- `enabled` (toggling dark mode on or off)
- `auto_merge.paths` (expanding the auto-merge surface)
- `require_green_ci = false` (disabling green CI check — downgrade only)
- `require_bot_approval = false` (disabling bot approval check — downgrade only)

Upgrading safety flags (`require_green_ci: true`, `require_bot_approval: true`) requires `admin` scope only. Other fields (`notify`, `create_issue`, `review.*`, `auto_merge.min_trust`) require `admin` scope only, never the ceremony.

---

## CODEOWNERS Approval Ceremony (R9)

The `X-Lore-Approval-PR` header must point to a PR in the **same repository** as the settings being changed. The PR must:

1. Be open (not merged or closed)
2. Carry the `dark-factory-approval` label
3. Have the label applied by a CODEOWNERS member (direct `@user` entry, not `@org/team`)

**CODEOWNERS file lookup order:** `.github/CODEOWNERS` → `CODEOWNERS` → `docs/CODEOWNERS` (GitHub's canonical order).

**Approval validation** happens at PUT time via `verifyApproval()` in `mcp-server/src/dark-factory-authz.ts`.

**v1 limitations:**

- Only `@user` CODEOWNERS entries are recognized; `@org/team` entries trigger `team_membership_unresolved` error (team-membership lookup is a follow-up).
- Per-path CODEOWNERS gating is not implemented; the entire CODEOWNERS file is treated as one set (also a follow-up).
- Centralized settings PR approach (e.g., `lore-settings/<repo>.yaml`) is deferred.

---

## Error Responses

**Response 400 (Bad Request):**

```json
{
  "ok": false,
  "error": "invalid_request",
  "message": "Field 'auto_merge.min_trust' must be one of: low, medium, high"
}
```

**Response 401 (Unauthorized):**

```json
{
  "ok": false,
  "error": "auth_failed",
  "message": "Invalid or missing GitHub App credentials"
}
```

**Response 404 (Not Found):**

```json
{
  "ok": false,
  "error": "repo_not_found",
  "message": "Repository owner/repo not found or not installed with Lore App"
}
```

**Response 500 (Server Error):**

```json
{
  "ok": false,
  "error": "internal_error",
  "message": "An internal server error occurred. Contact support with trace ID: ..."
}
```
