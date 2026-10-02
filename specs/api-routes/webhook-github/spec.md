# Feature Specification: GitHub webhook ingress (POST /api/webhook/github)

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | GitHub webhook receiver                                               |
| Status  | In Progress                                                          |
| Created | 2026-06-10                                                           |
| Owner   | Platform Engineering                                                 |
| Route   | `POST /api/webhook/github` on lore-api; the public `POST /api/events` URL is rewritten onto it by the ingresses |
| Auth    | HMAC SHA-256 (`X-Hub-Signature-256: sha256=…`, secret `LORE_WEBHOOK_SECRET`) |
| Module  | `libs/shared/src/transport/http/github-delivery.ts` (`eventsFromGitHubDelivery`), called by `apps/lore-api/src/transport/routes/webhooks/webhook-github.ts` (`githubWebhookRoute`) |

lore-api's `POST /api/webhook/github` is the one door GitHub delivers every subscribed event to (ADR-044, amended 2026-10-02); the public `/api/events` URL is rewritten onto it by the ingresses, and the event-router no longer exists. The route verifies the HMAC over the raw body, maps the delivery to `github.*` events with `mapGitHubEvent`, and queues them on `pipeline.events` — fanning spec-PR merges into tasks, waking the review reactor, re-evaluating auto-merge, and creating tasks from labeled issues happen downstream, in the Floor's event handlers.

## Problem Statement

GitHub events (PR lifecycle, reviews, issue comments, issue labels)
must drive the Lore pipeline: a merged spec PR fans out into spec-tasks, new
commits / reviews / comments wake the review reactor, and a `lore`-labeled issue creates a pipeline task. The
ingress authenticates each delivery by HMAC signature (not a bearer token), maps it by the
`X-GitHub-Event` header, and answers 202 as soon as the rows are queued. The
reaction is the event loop's job; the HTTP response only reports what was
captured.

## Interface

Registered on lore-api (`apps/lore-api/src/transport/routes/webhooks/webhook-github.ts`).

- **Method + path**: `POST /api/webhook/github`. The public hook URL,
  `https://<lore_event_router_hostname>/api/events`, is rewritten onto it by the
  ingresses (`infra/terraform/event-router.tf`), as is the older
  `https://<lore_webhook_hostname>/api/webhook/github`, so no repository hook
  had to change when the event-router was deleted.
- **Auth**: HMAC SHA-256. The route reads `LORE_WEBHOOK_SECRET` and the
  `X-Hub-Signature-256` header; `verifyGitHubSignature(secret, sig, rawBody)`
  recomputes `sha256=hex(hmac(secret, rawBody))` and constant-time compares.
  No hapi auth strategy runs on the path. The route bounds bodies at GitHub's
  25 MB delivery cap, and both ingresses carry the matching `proxy-body-size`.
- **Request body** (raw, signed): a GitHub webhook JSON payload. Mapped by
  `X-GitHub-Event` (`libs/shared/src/outbound/project/events/github-map.ts`):
  `pull_request`, `pull_request_review`, `pull_request_review_comment`,
  `issue_comment`, `issues`, `repository`. Anything else, `check_run` and
  `check_suite` included, maps to no event.
- **Response**: always JSON. `202 {captured, events[]}` for a verified
  delivery (including one that maps to nothing), `400` missing
  `x-github-event` or unparseable JSON, `401` bad or missing signature,
  `500` secret unset.

## Behavior

1. **Secret gate** — `LORE_WEBHOOK_SECRET` unset → `500`, naming the env var
   and the deployment to set it on. Not `503`: a 503 tells GitHub to
   redeliver, and no number of redeliveries supplies a missing env var.
2. **Signature gate** — `verifyGitHubSignature` false → `401`, naming the two
   secrets that disagree.
3. **Event gate** — no `X-GitHub-Event` → `400`.
4. **Map + queue** — `mapGitHubEvent(eventType, body, deliveryId)` yields zero
   or more `EventInsert`s, each keyed `github:<delivery id>` so a redelivery is a no-op at the store. Inserted
   sequentially so a partial failure surfaces as a 5xx and GitHub retries the
   whole delivery. `202 {captured, events: [eventName…]}`.

**Env vars**: `LORE_WEBHOOK_SECRET` (required).

## Output

| Branch | Status | Body |
|--------|--------|------|
| Secret unset | 500 | `{"error":"webhook secret not configured — set LORE_WEBHOOK_SECRET on the lore-api deployment"}` |
| No signature header | 401 | `{"error":"missing x-hub-signature-256 header — …"}` |
| Invalid signature | 401 | `{"error":"signature verification failed — …"}` |
| No `x-github-event` | 400 | `{"error":"missing x-github-event header"}` |
| Invalid JSON | 400 | `{"error":"invalid JSON in webhook body …"}` |
| Verified delivery | 202 | `{"captured":N,"events":["github.pull_request.opened",…]}` |

## Dependencies & side effects

- `verifyGitHubSignature` (pure HMAC compare) and `mapGitHubEvent` (pure),
  both from `@re-cinq/lore-shared`.
- `pipeline.events` insert through lore-api's own pool (`eventReporterFor`).
- Env: `LORE_WEBHOOK_SECRET`.

## Acceptance Criteria

A valid `sha256=` signature over the raw body verifies; a tampered body or a
length-mismatched signature is rejected without throwing. ([validated by accepts a signature computed with the same secret and body](libs/shared/src/transport/http/github-signature.test.ts#L13), [`github-signature.test.ts:17`](libs/shared/src/transport/http/github-signature.test.ts#L17), [`github-signature.test.ts:23`](libs/shared/src/transport/http/github-signature.test.ts#L23), [`github-signature.test.ts:29`](libs/shared/src/transport/http/github-signature.test.ts#L29))

An unset secret returns 500 — 503 would tell GitHub to redeliver, and no number of redeliveries supplies a missing env var; a missing signature header returns 401; an invalid signature returns 401. Each refusal names what to go and change — the secret to set, the header GitHub must send, or the two secrets that disagree — because these are read in a delivery log, not with the source open. A delivery carrying no `x-github-event` header is a 400. ([validated by refuses a signature that does not match the secret with a 401](libs/shared/src/transport/http/github-delivery.test.ts#L64), [refuses with a 500 naming the lore-api deployment when the webhook secret is not configured](libs/shared/src/transport/http/github-delivery.test.ts#L79), [refuses a signed delivery with no x-github-event header with a 400](libs/shared/src/transport/http/github-delivery.test.ts#L96))

A validly-signed delivery answers 202 and QUEUES the mapped events, each carrying the delivery id as its dedupe key — GitHub redelivers on any non-2xx, and without that key a retried delivery would run the whole reaction a second time. ([validated by answers 202 and writes github.pull_request.closed deduped on github:d-1 for signed delivery d-1](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L71))

The verification and the mapping are one shared function (`eventsFromGitHubDelivery`, `libs/shared/src/transport/http/github-delivery.ts`), so the door GitHub posts to trusts a delivery one way: a request is a GitHub delivery when it carries the signature header, a signed delivery maps to its events with the delivery id as dedupe key, a ping maps to none, and each refusal (unconfigured secret, mismatched signature, missing event header) names the deployment to fix. ([validated by returns sha256=abc for a request carrying that x-hub-signature-256 header](libs/shared/src/transport/http/github-delivery.test.ts#L16), [returns undefined for a request with no signature header](libs/shared/src/transport/http/github-delivery.test.ts#L22), [maps signed delivery d-1 of a closed pull request to github.pull_request.closed deduped on github:d-1](libs/shared/src/transport/http/github-delivery.test.ts#L28), [maps a signed ping to no events](libs/shared/src/transport/http/github-delivery.test.ts#L51), [refuses a signature that does not match the secret with a 401](libs/shared/src/transport/http/github-delivery.test.ts#L64), [refuses with a 500 naming the lore-api deployment when the webhook secret is not configured](libs/shared/src/transport/http/github-delivery.test.ts#L79), [refuses a signed delivery with no x-github-event header with a 400](libs/shared/src/transport/http/github-delivery.test.ts#L96))

lore-api serves the door at `POST /api/webhook/github` (`apps/lore-api/src/transport/routes/webhooks/webhook-github.ts`): a signed delivery answers 202 and writes its events to `pipeline.events` deduped on the delivery id; a request with no signature is refused 401 naming the missing header, never as a missing bearer token, and a mismatched signature writes nothing; the body may be larger than the 1 MB the other routes accept; the path is outside the rate limiter, because GitHub does not retry a refused delivery and a 429 would lose the event; and a signed body that is not JSON is a 400. ([validated by answers 202 and writes github.pull_request.closed deduped on github:d-1 for signed delivery d-1](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L71), [answers 401 naming the signature header for a delivery that carries no signature and no bearer token](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L94), [answers 401 and writes nothing for a signature that does not match the secret](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L105), [answers 202 for a signed delivery of 2 MB, over the 1 MB JSON limit of the other routes](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L123), [answers 202 to the 31st delivery within a minute, past the 30 a minute of the other webhooks](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L135), [answers 400 for a signed body that is not JSON](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L151))

A merged spec PR parses tasks.md and syncs spec-tasks; a non-spec branch, an already-synced spec, and a missing tasks.md each skip with the matching reason; a null pool returns 503.

A `synchronize` pull_request triggers the review reactor; an unhandled action skips. ([validated by `github-map.test.ts:7`](libs/shared/src/outbound/project/events/github-map.test.ts#L7), [`github-map.test.ts:83`](libs/shared/src/outbound/project/events/github-map.test.ts#L86))

A submitted review triggers both the review reactor and auto-merge; a non-submitted review skips; missing repo/pr returns 400. ([validated by `github-map.test.ts:95`](libs/shared/src/outbound/project/events/github-map.test.ts#L98), [`github-map.test.ts:129`](libs/shared/src/outbound/project/events/github-map.test.ts#L134))

A created PR comment triggers the review reactor; an edited comment and a non-PR comment skip. ([validated by `github-map.test.ts:153`](libs/shared/src/outbound/project/events/github-map.test.ts#L159), [`github-map.test.ts:177`](libs/shared/src/outbound/project/events/github-map.test.ts#L183))

A `repository` delivery with action `renamed` maps to `github.repository.renamed` carrying `from` (the owner login and the previous name) and `to` (the new full name); any other `repository` action maps to nothing. Its handler renames the `lore.repos` row in place, or, when onboarding already created a row under the new name, moves the old row's agent definitions the new row lacks and deletes the old row, all in one transaction; a rename whose old name has no row changes nothing (#2040). A merge keeps the new row's settings unless it has none, in which case it inherits the old row's, and in both a rename and a merge every other repo's `cross_repo_repos` list naming the old repo is pointed at the new one, since cross-repo links are stored on both sides. ([validated by maps a renamed re-cinq/HAL-engine to github.repository.renamed from re-cinq/HAL-engine to re-cinq/HALEngine](libs/shared/src/outbound/project/events/github-map.test.ts#L305), [validated by returns nothing for an archived repository](libs/shared/src/outbound/project/events/github-map.test.ts#L325), [validated by renames re-cinq/HAL-engine to re-cinq/HALEngine in place when only the old row exists](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L38), [validated by merges re-cinq/HAL-engine into re-cinq/HALEngine, moving its reviewer definition and dropping its conflicting implementation definition](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L56), [validated by returns absent and keeps re-cinq/lore when re-cinq/HAL-engine has no row](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L155), [validated by updates owner, name and full_name of re-cinq/HAL-engine's row inside one transaction when re-cinq/HALEngine has none](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L166), [validated by moves non-conflicting agent definitions to re-cinq/HALEngine's id and deletes re-cinq/HAL-engine's row inside one transaction when both rows exist](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L192), [validated by returns absent without writing when re-cinq/HAL-engine has no row](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L227), [validated by rolls back and rethrows when deleting re-cinq/HAL-engine's row fails](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L245), [validated by renames the repository row from acme/gadgets to acme/widgets](apps/stations/src/events/repo-handlers.test.ts#L69), [validated by points re-cinq/the-expert-ui's cross-repo link at re-cinq/HALEngine when re-cinq/HAL-engine is renamed in place](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L82), [validated by merges re-cinq/HAL-engine's cross-repo settings into a re-cinq/HALEngine row that has none, and repoints the link back to it](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L102), [validated by keeps re-cinq/HALEngine's own settings when both rows carry some](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L134))

A `lore`-labeled issue creates a task (type from issue labels) and labels the issue; a mismatched label, a duplicate, missing fields, a null pool, and a createTask failure each return their documented status. The duplicate guard excludes `failed`/`cancelled` tasks (a new task is allowed after the previous one failed), the dispatch decision reads `dispatch_label`/`auto_review` from `lore.repos.settings`, and the created task is linked to its issue via `issue_number`/`issue_url`. ([validated by `webhook.test.ts:61`](apps/lore-api/src/integration-tests/webhook.test.ts#L58), [`webhook.test.ts:74`](apps/lore-api/src/integration-tests/webhook.test.ts#L74), [`webhook.test.ts:86`](apps/lore-api/src/integration-tests/webhook.test.ts#L86))

Invalid JSON on any dispatched event returns 400.

### Webhook configuration (classify / ensure / management routes)

A repo hook is Lore's when its URL ends in one of `LORE_HOOK_PATHS` — the public `/api/events` URL or `/api/webhook/github` (`isLoreHook`). Both stay listed for as long as any repo may still carry the legacy URL: a legacy hook must classify as repointable and be updated in place, never mistaken for absent and duplicated. ([validated by lists /api/events and the legacy /api/webhook/github as Lore hook paths](apps/lore-api/src/work/webhook/webhook-status.test.ts#L119), [`webhook-status.test.ts:126`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L126), [`webhook-status.test.ts:130`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L130), [`webhook-status.test.ts:134`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L134))

The repo-webhook classifier (`classifyWebhook`) reports `configured` when a canonical-URL hook is active, covers the required events (or `['*']`), and last delivered 2xx or has never delivered; `missing` when no hook is at either Lore hook path; `wrong_url` when a hook at a Lore hook path differs from the canonical URL — which is how a pre-ADR-044 Floor hook, or one on another host, is reported until it is repointed — preferring the canonical hook when both are installed; `inactive` when the hook is disabled; `narrow_events` when it subscribes to only a subset (e.g. `issues`); `delivery_failing` when the last delivery was non-2xx (e.g. a 401 secret mismatch); and `unknown` when the canonical URL is unset. ([validated by `webhook-status.test.ts:25`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L25), [`webhook-status.test.ts:32`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L32), [`webhook-status.test.ts:38`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L38), [`webhook-status.test.ts:50`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L50), [`webhook-status.test.ts:56`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L56), [`webhook-status.test.ts:64`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L64), [`webhook-status.test.ts:73`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L73), [`webhook-status.test.ts:79`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L79), [`webhook-status.test.ts:85`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L85), [`webhook-status.test.ts:97`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L97), [`webhook-status.test.ts:106`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L106), [`webhook-status.test.ts:113`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L113))

`ensureRepoWebhook` finds the repo's existing Lore hook by `isLoreHook` and PATCHes it in place — the whole config replaced, secret included, so a legacy or rotated hook comes out pointing at the canonical URL with the current secret — rather than creating a second hook; only when no Lore hook exists does it create one, active from the start. It pings the hook either way and returns it even when the ping rejects. ([validated by repoints a legacy hook at lore-webhook.gcp.re-cinq.com/api/webhook/github in place, replacing url, secret and events](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L37), [`webhook-manage.test.ts:55`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L55), [`webhook-manage.test.ts:65`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L65), [`webhook-manage.test.ts:89`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L89))

`ensureLoreWebhook` skips without touching GitHub when `LORE_WEBHOOK_URL` or `LORE_WEBHOOK_SECRET` is unset (`webhook_host_not_configured` / `secret_not_configured`); otherwise it ensures the repo hook with the secret and the required events (`repository` among them, so a rename reaches Lore), reporting `app_no_webhook_permission` on a 403 and `ensure_failed` (with a detail) on any other error. ([validated by `webhook-ensure.test.ts:17`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L17), [`webhook-ensure.test.ts:27`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L27), [`webhook-ensure.test.ts:37`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L37), [`webhook-ensure.test.ts:63`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L63), [`webhook-ensure.test.ts:75`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L75), [`webhook-ensure.test.ts:86`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L86))

`GET /api/repos/:o/:r/webhook` returns the classified webhook state: `unknown` when the canonical URL is unset or the App lacks the webhook permission (403), and the `configured` classification otherwise. ([validated by `webhook-route.test.ts:51`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L51), [`webhook-route.test.ts:62`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L62), [`webhook-route.test.ts:75`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L75))

`POST /api/repos/:o/:r/webhook/ensure` ensures the hook and then returns the fresh status, mapping a `secret_not_configured` skip to 503, a `webhook_host_not_configured` skip to 503, an `app_no_webhook_permission` skip to 403, and any other skip reason to 500 (the skip's `detail`, or a generic message when absent); a post-ensure listing failure also returns 500, using `String(err)` when the thrown `Error` carries an empty message. ([validated by `webhook-route.test.ts:99`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L99), [`webhook-route.test.ts:110`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L110), [`webhook-route.test.ts:121`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L121), [`maps a webhook_host_not_configured skip to 503`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L135), [`maps an unmapped skip reason to 500 with its detail`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L147), [`maps an unmapped skip reason with no detail to a generic 500 message`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L160), [`returns 500 when the post-ensure webhook listing throws`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L172), [`falls back to String(err) when the post-ensure listing throws an empty-message Error`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L186))

`GET /api/repos/:o/:r/webhook/secret` returns the HMAC secret + canonical URL for an admin caller, or 503 when the secret is not configured. ([validated by `webhook-route.test.ts:211`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L211), [`webhook-route.test.ts:220`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L220))

## Out of Scope

- The agent-side review-reactor / auto-merge engines (separate specs).
- `createTask` / `syncTasksToDb` pipeline internals.
- GitHub App installation.
- The event-router's bearer-token reporter branch, retired with the router (ADR-044 amendment).
