# Feature Specification: GitHub Issue Dispatch

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | GitHub Issue Dispatch                    |
| Branch         | feat/github-issue-dispatch               |
| Status         | In Progress                              |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 2-3 days                                 |

GitHub Issue Dispatch lets developers stay in their natural workflow: adding a `lore` label to any GitHub Issue makes Lore pick it up via webhook and automatically create a pipeline task from the issue title and body, avoiding a re-describe-in-Lore context switch.

## Problem Statement

Developers create GitHub Issues as part of their natural workflow.
Today, to get Lore to work on something, they must use the Lore UI
or MCP tool to create a pipeline task. This is a context switch —
they write the issue in GitHub, then re-describe it in Lore.

## Solution

Add a `lore` label to any GitHub Issue → Lore picks it up and creates
a pipeline task automatically.

### Flow

```
Developer creates/labels Issue with "lore"
  ↓
GitHub webhook fires (issue.labeled event)
  ↓
Lore MCP server receives webhook
  ↓
Creates pipeline task from issue title + body
  ↓
Agent picks up task → creates LoreTask CR → Job runs
  ↓
PR created → linked back to the original Issue
  ↓
Issue gets comment: "Working on this → PR #N"
```

### What Changes

**1. Webhook endpoint** (`mcp-server/src/index.ts`)

New HTTP handler: `POST /api/webhook/github`
- Validates GitHub webhook signature (HMAC SHA-256)
- Handles `issues` event with action `labeled` ([validated by `github-map.test.ts:298`](libs/shared/src/project/events/github-map.test.ts#L298))
- The event mapper is a guard at the door: it returns nothing when the `repository` is missing or the
  event type is unhandled. ([validated by `github-map.test.ts:334`](libs/shared/src/project/events/github-map.test.ts#L334), [`github-map.test.ts:344`](libs/shared/src/project/events/github-map.test.ts#L344))
- If label name is `lore` (configurable):
  - Extract: issue title, body, repo full_name, issue number
  - Determine task type from issue labels:
    - `lore:implementation` → implementation
    - `lore:review` → review
    - `lore:runbook` → runbook
    - `lore` (alone) → general
  - Create pipeline task with issue context
  - Comment on issue: "Lore agent is working on this. Task: `{id}`"
  - Add `lore-managed` label to the issue

**2. Task context enrichment**

The pipeline task gets `context_bundle` with:
```json
{
  "github_issue_number": 42,
  "github_issue_url": "https://github.com/org/repo/issues/42",
  "github_issue_body": "full issue body text"
}
```

The worker already stores `issue_number` and `issue_url` on the task.
For webhook-dispatched tasks, the originating issue IS the task's issue
(no need to create a new one).

**3. Webhook registration**

During `lore_onboard_repo`, configure the GitHub webhook on the target repo:
- URL: `https://LORE_API_DOMAIN/api/webhook/github`
- Events: `issues`
- Secret: from `LORE_WEBHOOK_SECRET` env var
- Content type: `application/json`

For already-onboarded repos, add webhook via the settings UI or
`gh` CLI manually.

**4. Duplicate prevention**

Before creating a task, check if one already exists for this issue:
```sql
SELECT id FROM pipeline.tasks
WHERE issue_number = $1 AND target_repo = $2
  AND status NOT IN ('failed', 'cancelled')
```
If exists, skip and comment "Already being worked on: task `{id}`"

**5. Label configuration**

Per-repo setting in `lore.repos.settings`:
```json
{
  "dispatch_label": "lore",
  "dispatch_default_type": "implementation"
}
```

Defaults: label=`lore`, type=`general`.

### Webhook Payload (issues.labeled)

```json
{
  "action": "labeled",
  "label": { "name": "lore" },
  "issue": {
    "number": 42,
    "title": "Add rate limiting to API",
    "body": "We need rate limiting on...",
    "labels": [{"name": "lore"}, {"name": "lore:implementation"}],
    "html_url": "https://github.com/org/repo/issues/42"
  },
  "repository": {
    "full_name": "org/repo"
  }
}
```

## Out of Scope

1. **Issue assignment** — no auto-assignment to developers
2. **Issue closing** — handled by existing watcher (close on PR creation)
3. **Multiple labels** — one dispatch per issue, not per label
4. **Issue comments as follow-up** — Phase 2 (reply to agent PR with issue comment)
5. **Non-GitHub platforms** — GitHub only

## Acceptance Criteria

1. Adding `lore` label to a GitHub Issue creates a pipeline task ([validated by `webhook.test.ts:32`](apps/lore-api/src/integration-tests/webhook.test.ts#L32))

2. Task type determined from `lore:*` label variants
3. Agent works on the task, creates PR linked to the issue
4. Issue gets comment with task ID and PR link; `loreTaskRef` links the task uuid to its deployed
   assembly-line page and trims a trailing slash on the UI url. ([validated by `issue-body.test.ts:11`](apps/floor/src/jobs/task/issue-body.test.ts#L11))

5. Duplicate issues (same issue, active task) are skipped ([validated by `webhook.test.ts:43`](apps/lore-api/src/integration-tests/webhook.test.ts#L43))

6. Works on any onboarded repo with webhook configured

7. The `POST /api/webhook/github` endpoint is a signed door: `verifyGitHubSignature` rejects a
   signature computed with a different secret (accepting only one over the same secret + raw body),
   and the route returns 202 capturing `{captured:0, events:[]}` for a validly-signed event that maps
   to no work; `parseJsonBody` returns the typed object and throws a 400 on a
   malformed body, naming the ingress that was parsing it and quoting the parser's own
   objection — five routes parse bodies this way, and a bare "invalid JSON" said a body
   was rejected without saying which ingress rejected it or where the body went wrong. ([validated by `github-webhook.test.ts:26`](apps/floor/src/delivery/http/routes/github-webhook.test.ts#L26), [`github-webhook.test.ts:108`](apps/floor/src/delivery/http/routes/github-webhook.test.ts#L108), [`raw-body.test.ts:6`](apps/floor/src/delivery/http/raw-body.test.ts#L6), [`raw-body.test.ts:12`](apps/floor/src/delivery/http/raw-body.test.ts#L12))
