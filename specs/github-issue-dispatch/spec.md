# Feature Specification: GitHub Issue Dispatch

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | GitHub Issue Dispatch                    |
| Branch         | feat/github-issue-dispatch               |
| Status         | Shipped                                  |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 2-3 days                                 |

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
- Handles `issues` event with action `labeled`
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

During `onboard_repo`, configure the GitHub webhook on the target repo:
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

1. Adding `lore` label to a GitHub Issue creates a pipeline task
2. Task type determined from `lore:*` label variants
3. Agent works on the task, creates PR linked to the issue
4. Issue gets comment with task ID and PR link
5. Duplicate issues (same issue, active task) are skipped
6. Works on any onboarded repo with webhook configured
