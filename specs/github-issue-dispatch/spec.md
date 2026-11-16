# Feature Specification: GitHub Issue Dispatch

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | GitHub Issue Dispatch                    |
| Branch         | feat/github-issue-dispatch               |
| Status         | In Progress                              |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 2-3 days                                 |

GitHub Issue Dispatch lets developers stay in GitHub: adding a `lore` label to an Issue of an onboarded repository puts it in that repository's backlog, where the implementation loop picks it up. Lore receives the label through its GitHub webhook, gives the Issue a priority when it has none, and comments on it.

## Problem Statement

Developers write GitHub Issues as part of their normal work.
Asking Lore to implement one should not need a second tool or a second
description of the same work.

## Background

Until 2026-10-02 a `lore` label created a pipeline task of type
`implementation` or `general`, with the issue body in its context bundle
and a comment on the Issue carrying the task id and the pull request link.
Those task types were removed (#2328, #2329) and no task is created from
an Issue any more. The `lore:review` and `lore:runbook` labels and the
repository's `dispatch_default_type` setting named task types too. The
labels are no longer seeded. The settings schema still accepts the
setting, and nothing reads it.

## Solution

Add a `lore` label to a GitHub Issue. Lore queues it for the
implementation loop.

### Flow

```
Developer labels an Issue with "lore"
  ↓
GitHub delivers the issues.labeled event to the public /api/events URL
  ↓
lore-api verifies the signature and writes github.issues.labeled to pipeline.events
  ↓
The stations service drains the event
  ↓
The Issue gets priority:medium (when it has no priority label) and a comment
  ↓
The implementation loop picks it up from the backlog (specs/implementation-loop)
```

### What Changes

**1. Webhook door** (`apps/lore-api/src/transport/routes/webhooks/webhook-github.ts`)

GitHub posts to the public `/api/events` URL, which the ingress rewrites onto lore-api's `POST /api/webhook/github` (ADR-044, amended 2026-10-02).

- The route takes no bearer token: a delivery with no `x-hub-signature-256` header is answered 401. ([validated by answers 401 naming the signature header for a delivery that carries no signature and no bearer token @6c7c0684](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L98))
- The signature is an HMAC SHA-256 of the raw body under `LORE_WEBHOOK_SECRET`. `verifyGitHubSignature` accepts one computed with the same secret over the same body, and rejects one computed with a different secret or over a body changed after signing. ([validated by accepts a signature computed with the same secret and body @acc83b52](libs/shared/src/transport/http/github-signature.test.ts#L13), [validated by rejects a signature computed with a different secret @e8ded4be](libs/shared/src/transport/http/github-signature.test.ts#L17), [validated by rejects when the body was tampered after signing @c79a31c1](libs/shared/src/transport/http/github-signature.test.ts#L23))
- A signature that does not match is answered 401, and nothing is written to `pipeline.events`. ([validated by refuses a signature that does not match the secret with a 401 @5f8c1d3f](libs/shared/src/transport/http/github-delivery.test.ts#L69), [validated by answers 401 and writes nothing for a signature that does not match the secret @8b0b4f4c](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L109))
- When `LORE_WEBHOOK_SECRET` is not set, the delivery is answered 500 with a message naming the lore-api deployment. ([validated by refuses with a 500 naming the lore-api deployment when the webhook secret is not configured @0d515f06](libs/shared/src/transport/http/github-delivery.test.ts#L84))
- A signed delivery with no `x-github-event` header is answered 400. ([validated by refuses a signed delivery with no x-github-event header with a 400 @1bda8720](libs/shared/src/transport/http/github-delivery.test.ts#L101))
- A signed body that is not JSON is answered 400. ([validated by answers 400 for a signed body that is not JSON @49ef6093](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L155))
- The 400 for a body that is not JSON comes from `parseJsonBody` (`libs/shared/src/transport/http/json-body.ts`), whose message names the webhook body and quotes the JSON parser's own error.
- A verified delivery is answered 202 with `{captured, events}`, and each event it maps to is written to `pipeline.events` with a dedupe key built from the delivery id. ([validated by answers 202 and writes github.pull_request.closed deduped on github:d-1 and github.tracker.changed deduped on github:d-1:utopia for signed delivery d-1 @f7f57fff](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L71))
- A signed delivery that maps to no work, such as a ping, maps to no events. ([validated by maps a signed ping to no events @0781117f](libs/shared/src/transport/http/github-delivery.test.ts#L56))
- The door accepts a body over the 1 MB JSON limit of the other routes and is not held to the 30 a minute rate limit of the other webhooks. ([validated by answers 202 for a signed delivery of 2 MB, over the 1 MB JSON limit of the other routes @63d17348](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L127), [validated by answers 202 to the 31st delivery within a minute, past the 30 a minute of the other webhooks @8ea47f48](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L139))
- `mapGitHubEvent` (`libs/shared/src/outbound/project/events/github-map.ts`) maps an `issues` delivery with action `labeled` to `github.issues.labeled`, carrying the repository, the label just applied and a trimmed issue snapshot: number, title, body, URL and label names. ([validated by `github-map.test.ts@6f7c5050`](libs/shared/src/outbound/project/events/github-map.test.ts#L314))
- The event mapper is a guard at the door: it returns nothing when the `repository` is missing or the event type is unhandled. ([validated by `github-map.test.ts@f3d3c37e`](libs/shared/src/outbound/project/events/github-map.test.ts#L515), [`github-map.test.ts@8c2ea347`](libs/shared/src/outbound/project/events/github-map.test.ts#L525))

**2. Label dispatch** (`apps/stations/src/events/repo-handlers.ts`, `libs/shared/src/work/backlog/label-dispatch.ts`, `libs/shared/src/work/backlog/queue-ticket.ts`)

- The stations service subscribes to `github.issues.labeled` whether or not a floor is configured. ([validated by claims the label and rename events whether or not a floor is configured @7ab2131b](apps/stations/src/events/subscriptions.test.ts#L95))
- An Issue labelled with the repository's dispatch label becomes no task: `queueTicket` gives it `priority:medium` when it carries no priority label, and comments that it is queued for the implementation loop at that priority. ([validated by queues issue 7 at priority:medium when it is labelled lore @114cb432](libs/shared/src/work/backlog/label-dispatch.test.ts#L33), [validated by labels issue 7 priority:medium and says the loop picks it up, when it carries no priority @b262cd00](libs/shared/src/work/backlog/queue-ticket.test.ts#L24), [validated by queues issue 7 of acme/widgets in the loop's backlog when it is labelled lore @6f7d3eae](apps/stations/src/events/repo-handlers.test.ts#L172))
- An Issue that already carries a priority label keeps it, and the comment names that priority. ([validated by leaves the priority:high of issue 7 as it is @f121c38e](libs/shared/src/work/backlog/queue-ticket.test.ts#L38))
- When the implementation loop is switched off for the repository (`implementation_loop.enabled`), the Issue is still queued, and the comment says nothing picks it up until the loop is switched on. ([validated by queues issue 7 and says nothing will pick it up while the loop is off for acme/widgets @bcca5535](libs/shared/src/work/backlog/queue-ticket.test.ts#L51))
- A label other than the dispatch label and `lore:implementation` does nothing. ([validated by does nothing for a label that is not the repository's dispatch label @911408e4](libs/shared/src/work/backlog/label-dispatch.test.ts#L62))
- The seeded `lore:implementation` label queues the Issue too, whatever the repository's dispatch label is: a label whose description says "implement this ticket" must not be one that does nothing. ([validated by queues issue 7 when it is labelled lore:implementation, the label onboarding seeds @33d97f35](libs/shared/src/work/backlog/label-dispatch.test.ts#L48))
- `DISPATCH_LABELS` (`libs/shared/src/domain/task-types/dispatch-labels.ts`), the `lore:*` dispatch labels onboarding seeds, holds only `lore:implementation`. ([validated by seeds only lore:implementation, the label that means the loop's backlog @531061bc](libs/shared/src/domain/task-types/dispatch-labels.test.ts#L5))
- When the label applied is `lore:triage` or `triage: needs-triage`, the `github.issues.labeled` handler in `apps/stations/src/events/repo-handlers.ts` calls `floorClient().lines.start('issue-triage', {repo, issue_url, issue_number})` via `libs/shared/src/outbound/floor/floor-client.ts`; subsequent state transitions are driven by the `triage:*` label taxonomy applied by the `triage_label` service station at each node outcome (see `specs/issue-triage`, which also owns the triage switch and the release of a run parked at `human-gate`). ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/3b3a67af-17b6-498b-b780-6738a0092603#p_eaf2b9b6-9ef7-4279-8f67-a27a29202e24), [validated by `lore:triage label starts an issue-triage floor run with repo, issue_number, and issue_url args` @c1fb6646](apps/stations/src/events/repo-handlers.test.ts#L225), [validated by `triage: needs-triage label also starts an issue-triage floor run` @8b043601](apps/stations/src/events/repo-handlers.test.ts#L242))

**3. Webhook registration** (`apps/lore-api/src/work/webhook/`)

- Onboarding a repository ensures its GitHub webhook: `onboardRepo` calls `ensureLoreWebhook` and returns its outcome. ([validated by ensures the Floor webhook for the onboarded repo and returns its outcome @9c3abe82](apps/lore-api/src/work/repo/repo-onboard.test.ts#L67))
- Onboarding completes when the webhook could not be ensured, and reports the reason. ([validated by still completes onboarding when the webhook ensure is skipped @47858ce4](apps/lore-api/src/work/repo/repo-onboard.test.ts#L84))
- The hook's URL is `LORE_WEBHOOK_URL` (the public `/api/events` URL), its secret is `LORE_WEBHOOK_SECRET`, and its events are `REQUIRED_EVENTS` in `apps/lore-api/src/work/webhook/webhook-status.ts`, `issues` among them. ([validated by ensures the hook with the secret and the required events, push, release and create among them @574945f5](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L37))
- When `LORE_WEBHOOK_URL` or `LORE_WEBHOOK_SECRET` is unset, the ensure is skipped without calling GitHub. ([validated by skips when LORE_WEBHOOK_URL is unset, without touching GitHub @ed49813d](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L17), [validated by skips when LORE_WEBHOOK_SECRET is unset, without touching GitHub @5161264a](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L27))
- `ensureRepoWebhook` (`apps/lore-api/src/work/webhook/webhook-manage.ts`) creates an active hook with content type `json` and pings it when the repository has no Lore hook. ([validated by creates an active hook and pings it when no Lore hook exists @a0619ab8](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L65))
- A Lore hook that already exists is updated in place, with its URL, secret and events replaced, and no second hook is created. ([validated by repoints a legacy hook at lore-webhook.gcp.re-cinq.com/api/webhook/github in place, replacing url, secret and events @6512965e](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L37), [validated by updates a hook already at /api/events in place instead of creating a second one @62f79082](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L55))
- A hook that subscribes only to `issues` is classified `narrow_events`. ([validated by returns narrow_events when the hook only subscribes to issues @3444d521](apps/lore-api/src/work/webhook/webhook-status.test.ts#L79))
- For an already-onboarded repository, `POST /api/repos/:o/:r/webhook/ensure` ensures the hook and returns its fresh status. ([validated by ensures the hook then returns the fresh status @c1baba36](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L125))
- The weekly `webhook-ensure-tick` sweep (`cron.webhook_ensure.tick`, Mondays 03:00 UTC) ensures the hook of every onboarded repository (`specs/external-floor` FR12.19c, 2026-10-26). ([validated by ensures re-cinq/lore then re-cinq/hal in order and reports both configured, each with its hook id @9ffe6456](apps/stations/src/work/webhook-ensure-tick/webhook-ensure-tick.test.ts#L38), [validated by schedules webhook_ensure weekly on Monday at 03:00 UTC @53052053](libs/shared/src/work/scheduler/cron-emitters.test.ts#L39))

**4. Duplicate prevention** (`libs/shared/src/work/backlog/ticket-holder.ts`)

- An Issue a task still holds is not queued: it gets the comment "Already being worked on: task `{id}`" and no label. ([validated by says issue 7 is already being worked on by task t-1 and queues nothing @8486b0a4](libs/shared/src/work/backlog/label-dispatch.test.ts#L90))
- The task looked at is the Issue's newest one in `pipeline.tasks` that is not `failed`, `cancelled` or `retried` (`activeTaskByIssue`). ([validated by PgTaskQueue SQL reads the newest task's id and status, leaving out failed, cancelled and retried ones @f97530fb](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L267), [validated by InMemory returns null for a retried task — retried is terminal and must not guard the issue @4b415279](libs/shared/src/outbound/project/tasks/task-queue.test.ts#L248))
- A task in flight holds the Issue. A settled task (`completed` or `merged`) holds it only while a pull request is open on the loop branch `lore/implementation-loop/issue-<number>`.
- A settled task with no open pull request, such as a parked run's, holds nothing, and the Issue is queued again *(amended 2026-10-19)*. ([validated by queues issue 263 when its only task is completed with no open pull request @d2bb90cd](libs/shared/src/work/backlog/label-dispatch.test.ts#L105))

**5. Label configuration**

Per-repo setting in `lore.repos.settings`:
```json
{
  "dispatch_label": "lore"
}
```

- The dispatch label is `lore` unless the repository's `dispatch_label` setting names another one. ([validated by answers to the label a repository configured as its dispatch label, here agent @9ca7bc98](libs/shared/src/work/backlog/label-dispatch.test.ts#L74))

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

1. **Issue assignment**: no auto-assignment to developers
2. **Work on a queued Issue**: picking it up, opening the pull request and closing the Issue belong to the implementation loop (`specs/implementation-loop`)
3. **Multiple labels**: one dispatch per issue, not per label
4. **Issue comments as follow-up**: Phase 2 (reply to agent PR with issue comment)
5. **Non-GitHub platforms**: GitHub only

## Acceptance Criteria

The sections of What Changes own the rules and their tests. This list names the outcomes and where each is specified.

1. Adding the `lore` label to an Issue queues it for the implementation loop: What Changes 2.
2. An Issue with no priority label gets `priority:medium`, and one with a priority keeps it: What Changes 2.
3. The Issue gets a comment saying it is queued, or that the loop is switched off for the repository: What Changes 2.
4. An Issue a task still holds is not queued a second time: What Changes 4.
5. It works on any onboarded repository whose webhook is configured: What Changes 3.
6. The GitHub webhook door is signed: What Changes 1.
