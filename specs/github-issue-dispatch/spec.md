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

**1. Webhook endpoint** (`apps/stations/src/events/repo-handlers.ts`)

HTTP ingress: lore-api's `POST /api/webhook/github`, which the public `/api/events` URL is rewritten onto (ADR-044, amended 2026-10-02)
- Validates GitHub webhook signature (HMAC SHA-256)
- Handles `issues` event with action `labeled` ([validated by `github-map.test.ts:298`](libs/shared/src/outbound/project/events/github-map.test.ts#L269))
- The event mapper is a guard at the door: it returns nothing when the `repository` is missing or the
  event type is unhandled. ([validated by `github-map.test.ts:362`](libs/shared/src/outbound/project/events/github-map.test.ts#L333), [`github-map.test.ts:372`](libs/shared/src/outbound/project/events/github-map.test.ts#L343))
- If label name is `lore` (configurable through the repository's `dispatch_label` setting):
  - *(Since 2026-10-02.)* The Issue becomes no task: it joins the repository's backlog, where the implementation loop picks it up. It gets `priority:medium` when it carries no priority label, and a comment saying it is queued, or that the loop is switched off for the repository and nothing picks it up until it is switched on. A label other than the dispatch label does nothing, and an Issue a task still holds is answered with that task's id instead of being queued. The handler runs in the stations service (`apps/stations/src/events/repo-handlers.ts`, `libs/shared/src/work/backlog/label-dispatch.ts`). ([validated by queues issue 7 at priority:medium when it is labelled lore](libs/shared/src/work/backlog/label-dispatch.test.ts#L32), [validated by does nothing for a label that is not the repository's dispatch label](libs/shared/src/work/backlog/label-dispatch.test.ts#L61), [validated by answers to the label a repository configured as its dispatch label, here agent](libs/shared/src/work/backlog/label-dispatch.test.ts#L73), [validated by says issue 7 is already being worked on by task t-1 and queues nothing](libs/shared/src/work/backlog/label-dispatch.test.ts#L89), [validated by labels issue 7 priority:medium and says the loop picks it up, when it carries no priority](libs/shared/src/work/backlog/queue-ticket.test.ts#L24), [validated by leaves the priority:high of issue 7 as it is](libs/shared/src/work/backlog/queue-ticket.test.ts#L38), [validated by queues issue 7 and says nothing will pick it up while the loop is off for acme/widgets](libs/shared/src/work/backlog/queue-ticket.test.ts#L51), [validated by queues issue 7 of acme/widgets in the loop's backlog when it is labelled lore](apps/stations/src/events/repo-handlers.test.ts#L57))
  - *(Since 2026-10-02.)* The seeded `lore:implementation` label asks for the same thing by itself, whatever the repository's dispatch label is: a label whose description says "implement this ticket" must not be one that does nothing. ([validated by queues issue 7 when it is labelled lore:implementation, the label onboarding seeds](libs/shared/src/work/backlog/label-dispatch.test.ts#L47))
  - The label used to name a task type (`lore:implementation`, `lore:review`, `lore:runbook`, and the repository's `dispatch_default_type` for a bare `lore`). Those task types are gone, so the labels name nothing: onboarding seeds only `lore:implementation`, kept as the label that says "implement this". ([validated by seeds only lore:implementation, the label that means the loop's backlog](libs/shared/src/domain/task-types/dispatch-labels.test.ts#L5))
  - When the label applied is `lore:triage` or `triage: needs-triage`, the `github.issues.labeled` handler in `apps/stations/src/events/repo-handlers.ts` calls `floorClient().lines.start('issue-triage', {repo, issue_url, issue_number})` via `libs/shared/src/outbound/floor/floor-client.ts`; subsequent state transitions are driven by the `triage:*` label taxonomy applied by the `triage_label` service station at each node outcome (see `specs/issue-triage`). ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_eaf2b9b6-9ef7-4279-8f67-a27a29202e24))

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
- URL: `https://LORE_EVENTS_DOMAIN/api/events` (the public URL the ingress rewrites onto lore-api's `POST /api/webhook/github`)
- Events: `issues`
- Secret: from `LORE_WEBHOOK_SECRET` env var
- Content type: `json` (GitHub webhook API `content_type` value; set by `ensureRepoWebhook` in `apps/lore-api/src/work/webhook/webhook-manage.ts`)

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
  "dispatch_label": "lore"
}
```

Default: label=`lore`. The seeded `lore:implementation` label asks for the same thing whatever the setting says. There is no dispatch type any more: the Issue joins the implementation loop's backlog.

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

1. Adding `lore` label to a GitHub Issue creates a pipeline task ([validated by `webhook.test.ts:32`](apps/lore-api/src/integration-tests/webhook.test.ts#L31))

2. Task type determined from `lore:*` label variants
3. Agent works on the task, creates PR linked to the issue
4. Issue gets comment with task ID and PR link; `loreTaskRef` links the task uuid to its deployed
   assembly-line page and trims a trailing slash on the UI url.

5. Duplicate issues (same issue, active task) are skipped ([validated by `webhook.test.ts:43`](apps/lore-api/src/integration-tests/webhook.test.ts#L42))

6. Works on any onboarded repo with webhook configured

7. The GitHub webhook door (`POST /api/webhook/github` on lore-api) is signed: `verifyGitHubSignature` rejects a
   signature computed with a different secret (accepting only one over the same secret + raw body),
   and the route returns 202 capturing `{captured:0, events:[]}` for a validly-signed event that maps
   to no work; `parseJsonBody` returns the typed object and throws a 400 on a
   malformed body, naming the ingress that was parsing it and quoting the parser's own
   objection — five routes parse bodies this way, and a bare "invalid JSON" said a body
   was rejected without saying which ingress rejected it or where the body went wrong. ([validated by refuses a signature that does not match the secret with a 401](libs/shared/src/transport/http/github-delivery.test.ts#L64), [maps a signed ping to no events](libs/shared/src/transport/http/github-delivery.test.ts#L51), [answers 400 for a signed body that is not JSON](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L151))
