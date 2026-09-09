# Feature Specification: GitHub webhook ingress (POST /api/events)

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | GitHub webhook receiver                                               |
| Status  | In Progress                                                          |
| Created | 2026-06-10                                                           |
| Owner   | Platform Engineering                                                 |
| Route   | `POST /api/events` on the event-router (GitHub branch); legacy `POST /api/webhook/github` on the Floor host, rewritten to it by the ingress |
| Auth    | HMAC SHA-256 (`X-Hub-Signature-256: sha256=…`, secret `LORE_WEBHOOK_SECRET`) |
| Module  | `apps/event-router/src/transport/routes/events.ts` (`eventsRoute`, `fromGitHub`) |

GitHub delivers every subscribed event to the event-router's one front door (ADR-044). The GitHub branch of `POST /api/events` verifies the HMAC over the raw body, maps the delivery to `github.*` events with `mapGitHubEvent`, and queues them on `pipeline.events` — fanning spec-PR merges into tasks, waking the review reactor, re-evaluating auto-merge, and creating tasks from labeled issues happen downstream, in the Floor's event handlers.

## Problem Statement

GitHub events (PR lifecycle, reviews, CI checks, issue comments, issue labels)
must drive the Lore pipeline: a merged spec PR fans out into spec-tasks, new
commits / reviews / comments wake the review reactor, completed CI checks
re-evaluate auto-merge, and a `lore`-labeled issue creates a pipeline task. The
ingress authenticates each delivery by HMAC signature (not a bearer token —
the presence of `X-Hub-Signature-256` is what selects the GitHub branch over
the bearer-authenticated reporter branch on the same path), maps it by the
`X-GitHub-Event` header, and answers 202 as soon as the rows are queued. The
reaction is the event loop's job; the HTTP response only reports what was
captured.

## Interface

Registered on the event-router ([registration](../../../apps/event-router/src/transport/routes/events.ts#L36)).

- **Method + path**: `POST /api/events`. The pre-ADR-044 hook URL,
  `https://<lore_webhook_hostname>/api/webhook/github`, is still served: an
  Exact-match Ingress on the Floor host rewrites it to `/api/events` on the
  router (`infra/terraform/lore-floor.tf`), so a repo onboarded before the
  cutover keeps delivering until `ensureLoreWebhook` repoints it.
- **Auth**: HMAC SHA-256. The branch reads `LORE_WEBHOOK_SECRET` and the
  `X-Hub-Signature-256` header; `verifyGitHubSignature(secret, sig, rawBody)`
  recomputes `sha256=hex(hmac(secret, rawBody))` and constant-time compares.
  No hapi auth strategy runs on the path (the two branches authenticate
  differently). The router bounds bodies at GitHub's 25 MB delivery cap
  ([body cap](../../../apps/event-router/src/transport/server.ts#L21)), and
  both ingresses carry the matching `proxy-body-size`.
- **Request body** (raw, signed): a GitHub webhook JSON payload. Mapped by
  `X-GitHub-Event` (`libs/shared/src/outbound/project/events/github-map.ts`):
  `pull_request`, `pull_request_review`, `pull_request_review_comment`,
  `check_run` / `check_suite`, `issue_comment`, `issues`. Anything else maps to
  no event.
- **Response**: always JSON. `202 {captured, events[]}` for a verified
  delivery (including one that maps to nothing), `400` missing
  `x-github-event` or unparseable JSON, `401` bad signature (a delivery with no
  signature header falls to the bearer branch and is refused there, also 401),
  `500` secret unset.

## Behavior

1. **Branch select** — `X-Hub-Signature-256` present → the GitHub branch;
   absent → the bearer-token reporter branch (a different spec).
2. **Secret gate** — `LORE_WEBHOOK_SECRET` unset → `500`, naming the env var
   and the deployment to set it on. Not `503`: a 503 tells GitHub to
   redeliver, and no number of redeliveries supplies a missing env var.
3. **Signature gate** — `verifyGitHubSignature` false → `401`, naming the two
   secrets that disagree.
4. **Event gate** — no `X-GitHub-Event` → `400`.
5. **Map + queue** — `mapGitHubEvent(eventType, body, deliveryId)` yields zero
   or more `EventInsert`s, each keyed `github:<delivery id>` (`:<pr>` for a
   check fan-out) so a redelivery is a no-op at the store. Inserted
   sequentially so a partial failure surfaces as a 5xx and GitHub retries the
   whole delivery. `202 {captured, events: [eventName…]}`.

**Env vars**: `LORE_WEBHOOK_SECRET` (required for the GitHub branch).

## Output

| Branch | Status | Body |
|--------|--------|------|
| Secret unset | 500 | `{"error":"webhook secret not configured — set LORE_WEBHOOK_SECRET on the event-router deployment"}` |
| No signature header | 401 | the bearer branch's refusal |
| Invalid signature | 401 | `{"error":"signature verification failed — …"}` |
| No `x-github-event` | 400 | `{"error":"missing x-github-event header"}` |
| Invalid JSON | 400 | `{"error":"invalid JSON in webhook body …"}` |
| Verified delivery | 202 | `{"captured":N,"events":["github.pull_request.opened",…]}` |

## Dependencies & side effects

- `verifyGitHubSignature` (pure HMAC compare) and `mapGitHubEvent` (pure),
  both from `@re-cinq/lore-shared`.
- `pipeline.events` insert via the router's own `eventQueue` — the router is
  the table's one writer (ADR-044).
- Env: `LORE_WEBHOOK_SECRET`.

## Acceptance Criteria

A valid `sha256=` signature over the raw body verifies; a tampered body or a
length-mismatched signature is rejected without throwing. ([validated by accepts a signature computed with the same secret and body](libs/shared/src/transport/http/github-signature.test.ts#L13), [`github-signature.test.ts:17`](libs/shared/src/transport/http/github-signature.test.ts#L17), [`github-signature.test.ts:23`](libs/shared/src/transport/http/github-signature.test.ts#L23), [`github-signature.test.ts:29`](libs/shared/src/transport/http/github-signature.test.ts#L29))

An unset secret returns 500 — 503 would tell GitHub to redeliver, and no number of redeliveries supplies a missing env var; a missing signature header returns 401; an invalid signature returns 401. Each refusal names what to go and change — the secret to set, the header GitHub must send, or the two secrets that disagree — because these are read in a delivery log, not with the source open. A delivery carrying no `x-github-event` header is a 400. ([validated by returns 400 when a signed delivery carries no x-github-event header](apps/event-router/src/transport/routes/events.test.ts#L67), [`events.test.ts:84`](apps/event-router/src/transport/routes/events.test.ts#L84), [`events.test.ts:118`](apps/event-router/src/transport/routes/events.test.ts#L118), [`events.test.ts:156`](apps/event-router/src/transport/routes/events.test.ts#L156))

A validly-signed delivery answers 202 and QUEUES the mapped events, each carrying the delivery id as its dedupe key — GitHub redelivers on any non-2xx, and without that key a retried delivery would run the whole reaction a second time. ([validated by captures a signed webhook without any bearer token](apps/event-router/src/transport/routes/events.test.ts#L39), [`events.test.ts:99`](apps/event-router/src/transport/routes/events.test.ts#L99), [`events.test.ts:194`](apps/event-router/src/transport/routes/events.test.ts#L194))

A merged spec PR parses tasks.md and syncs spec-tasks; a non-spec branch, an already-synced spec, and a missing tasks.md each skip with the matching reason; a null pool returns 503.

A `synchronize` pull_request triggers the review reactor; an unhandled action skips. ([validated by `github-map.test.ts:7`](libs/shared/src/outbound/project/events/github-map.test.ts#L7), [`github-map.test.ts:83`](libs/shared/src/outbound/project/events/github-map.test.ts#L83))

A submitted review triggers both the review reactor and auto-merge; a non-submitted review skips; missing repo/pr returns 400. ([validated by `github-map.test.ts:95`](libs/shared/src/outbound/project/events/github-map.test.ts#L95), [`github-map.test.ts:129`](libs/shared/src/outbound/project/events/github-map.test.ts#L129))

A completed `check_run` / `check_suite` fans out auto-merge to every PR; a non-completed check and an empty PR list each skip. ([validated by `github-map.test.ts:263`](libs/shared/src/outbound/project/events/github-map.test.ts#L263), [`github-map.test.ts:286`](libs/shared/src/outbound/project/events/github-map.test.ts#L286))

A created PR comment triggers the review reactor; an edited comment and a non-PR comment skip. ([validated by `github-map.test.ts:153`](libs/shared/src/outbound/project/events/github-map.test.ts#L153), [`github-map.test.ts:177`](libs/shared/src/outbound/project/events/github-map.test.ts#L177))

A `lore`-labeled issue creates a task (type from issue labels) and labels the issue; a mismatched label, a duplicate, missing fields, a null pool, and a createTask failure each return their documented status. The duplicate guard excludes `failed`/`cancelled` tasks (a new task is allowed after the previous one failed), the dispatch decision reads `dispatch_label`/`auto_review` from `lore.repos.settings`, and the created task is linked to its issue via `issue_number`/`issue_url`. ([validated by `webhook.test.ts:61`](apps/lore-api/src/integration-tests/webhook.test.ts#L58), [`webhook.test.ts:74`](apps/lore-api/src/integration-tests/webhook.test.ts#L74), [`webhook.test.ts:86`](apps/lore-api/src/integration-tests/webhook.test.ts#L86))

Invalid JSON on any dispatched event returns 400.

### Webhook configuration (classify / ensure / management routes)

A repo hook is Lore's when its URL ends in one of `LORE_HOOK_PATHS` — the event-router's `/api/events` or the legacy Floor `/api/webhook/github` (`isLoreHook`). Both stay listed for as long as any repo may still carry the legacy URL: a legacy hook must classify as repointable and be updated in place, never mistaken for absent and duplicated. ([validated by lists /api/events and the legacy /api/webhook/github as Lore hook paths](apps/lore-api/src/work/webhook/webhook-status.test.ts#L119), [`webhook-status.test.ts:126`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L126), [`webhook-status.test.ts:130`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L130), [`webhook-status.test.ts:134`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L134))

The repo-webhook classifier (`classifyWebhook`) reports `configured` when a canonical-URL hook is active, covers the required events (or `['*']`), and last delivered 2xx or has never delivered; `missing` when no hook is at either Lore hook path; `wrong_url` when a hook at a Lore hook path differs from the canonical URL — which is how a pre-ADR-044 Floor hook, or one on another host, is reported until it is repointed — preferring the canonical hook when both are installed; `inactive` when the hook is disabled; `narrow_events` when it subscribes to only a subset (e.g. `issues`); `delivery_failing` when the last delivery was non-2xx (e.g. a 401 secret mismatch); and `unknown` when the canonical URL is unset. ([validated by `webhook-status.test.ts:25`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L25), [`webhook-status.test.ts:32`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L32), [`webhook-status.test.ts:38`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L38), [`webhook-status.test.ts:50`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L50), [`webhook-status.test.ts:56`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L56), [`webhook-status.test.ts:64`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L64), [`webhook-status.test.ts:73`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L73), [`webhook-status.test.ts:79`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L79), [`webhook-status.test.ts:85`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L85), [`webhook-status.test.ts:97`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L97), [`webhook-status.test.ts:106`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L106), [`webhook-status.test.ts:113`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L113))

`ensureRepoWebhook` finds the repo's existing Lore hook by `isLoreHook` and PATCHes it in place — the whole config replaced, secret included, so a legacy or rotated hook comes out pointing at the canonical URL with the current secret — rather than creating a second hook; only when no Lore hook exists does it create one, active from the start. It pings the hook either way and returns it even when the ping rejects. ([validated by repoints a legacy hook at lore-webhook.gcp.re-cinq.com/api/webhook/github in place, replacing url, secret and events](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L37), [`webhook-manage.test.ts:55`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L55), [`webhook-manage.test.ts:65`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L65), [`webhook-manage.test.ts:89`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L89))

`ensureLoreWebhook` skips without touching GitHub when `LORE_WEBHOOK_URL` or `LORE_WEBHOOK_SECRET` is unset (`webhook_host_not_configured` / `secret_not_configured`); otherwise it ensures the repo hook with the secret and the required events, reporting `app_no_webhook_permission` on a 403 and `ensure_failed` (with a detail) on any other error. ([validated by `webhook-ensure.test.ts:17`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L17), [`webhook-ensure.test.ts:27`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L27), [`webhook-ensure.test.ts:37`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L37), [`webhook-ensure.test.ts:62`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L62), [`webhook-ensure.test.ts:74`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L74), [`webhook-ensure.test.ts:85`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L85))

`GET /api/repos/:o/:r/webhook` returns the classified webhook state: `unknown` when the canonical URL is unset or the App lacks the webhook permission (403), and the `configured` classification otherwise. ([validated by `webhook-route.test.ts:52`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L52), [`webhook-route.test.ts:63`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L63), [`webhook-route.test.ts:76`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L76))

`POST /api/repos/:o/:r/webhook/ensure` ensures the hook and then returns the fresh status, mapping a `secret_not_configured` skip to 503, a `webhook_host_not_configured` skip to 503, an `app_no_webhook_permission` skip to 403, and any other skip reason to 500 (the skip's `detail`, or a generic message when absent); a post-ensure listing failure also returns 500, using `String(err)` when the thrown `Error` carries an empty message. ([validated by `webhook-route.test.ts:100`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L100), [`webhook-route.test.ts:111`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L111), [`webhook-route.test.ts:122`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L122), [`maps a webhook_host_not_configured skip to 503`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L136), [`maps an unmapped skip reason to 500 with its detail`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L148), [`maps an unmapped skip reason with no detail to a generic 500 message`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L161), [`returns 500 when the post-ensure webhook listing throws`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L173), [`falls back to String(err) when the post-ensure listing throws an empty-message Error`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L187))

`GET /api/repos/:o/:r/webhook/secret` returns the HMAC secret + canonical URL for an admin caller, or 503 when the secret is not configured. ([validated by `webhook-route.test.ts:147`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L212), [`webhook-route.test.ts:156`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L221))

## Out of Scope

- The agent-side review-reactor / auto-merge engines (separate specs).
- `createTask` / `syncTasksToDb` pipeline internals.
- GitHub App installation.
- The bearer-token reporter branch of `POST /api/events` (ADR-044).
