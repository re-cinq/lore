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
  `issue_comment`, `issues`, `repository`, `check_suite` (completed), `push`
  to a branch (a tag push maps to nothing), and, for the Utopia mirror alone,
  `release` (published, edited) and `create` of a tag. Anything else, `check_run`
  included, maps to no event.
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
   or more `EventInsert`s, each keyed `github:<delivery id>` so a redelivery is a no-op at the store. An
   `issues` or `pull_request` delivery whose action is `opened`, `edited`, `closed`, `reopened`,
   `labeled` or `unlabeled` also yields `github.tracker.changed {repo}`, keyed
   `github:<delivery id>:utopia` so it does not collide with the delivery's first event; the stations
   answer it with the Utopia tracker walk (`specs/utopia-graph-mirror` FR14). A `release`
   delivery whose action is `published` or `edited`, and a `create` delivery of a tag, yield
   `github.release.changed {repo}` under the same `:utopia` key, answered with the release push
   (FR15). Inserted
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
length-mismatched signature is rejected without throwing. ([validated by accepts a signature computed with the same secret and body @acc83b52](libs/shared/src/transport/http/github-signature.test.ts#L13), [`github-signature.test.ts@e8ded4be`](libs/shared/src/transport/http/github-signature.test.ts#L17), [`github-signature.test.ts@c79a31c1`](libs/shared/src/transport/http/github-signature.test.ts#L23), [`github-signature.test.ts@e4a8102d`](libs/shared/src/transport/http/github-signature.test.ts#L29))

An unset secret returns 500 — 503 would tell GitHub to redeliver, and no number of redeliveries supplies a missing env var; a missing signature header returns 401; an invalid signature returns 401. Each refusal names what to go and change — the secret to set, the header GitHub must send, or the two secrets that disagree — because these are read in a delivery log, not with the source open. A delivery carrying no `x-github-event` header is a 400. ([validated by refuses a signature that does not match the secret with a 401 @5f8c1d3f](libs/shared/src/transport/http/github-delivery.test.ts#L69), [refuses with a 500 naming the lore-api deployment when the webhook secret is not configured @0d515f06](libs/shared/src/transport/http/github-delivery.test.ts#L84), [refuses a signed delivery with no x-github-event header with a 400 @1bda8720](libs/shared/src/transport/http/github-delivery.test.ts#L101))

A validly-signed delivery answers 202 and QUEUES the mapped events, each carrying the delivery id as its dedupe key — GitHub redelivers on any non-2xx, and without that key a retried delivery would run the whole reaction a second time. ([validated by answers 202 and writes github.pull_request.closed deduped on github:d-1 and github.tracker.changed deduped on github:d-1:utopia for signed delivery d-1 @f7f57fff](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L71))

The verification and the mapping are one shared function (`eventsFromGitHubDelivery`, `libs/shared/src/transport/http/github-delivery.ts`), so the door GitHub posts to trusts a delivery one way: a request is a GitHub delivery when it carries the signature header, a signed delivery maps to its events with the delivery id as dedupe key, a ping maps to none, and each refusal (unconfigured secret, mismatched signature, missing event header) names the deployment to fix. ([validated by returns sha256=abc for a request carrying that x-hub-signature-256 header @5762ba06](libs/shared/src/transport/http/github-delivery.test.ts#L16), [returns undefined for a request with no signature header @c9b13288](libs/shared/src/transport/http/github-delivery.test.ts#L22), [maps signed delivery d-1 of a closed pull request to github.pull_request.closed deduped on github:d-1 and github.tracker.changed deduped on github:d-1:utopia @95bcf18c](libs/shared/src/transport/http/github-delivery.test.ts#L28), [maps a signed ping to no events @0781117f](libs/shared/src/transport/http/github-delivery.test.ts#L56), [refuses a signature that does not match the secret with a 401 @5f8c1d3f](libs/shared/src/transport/http/github-delivery.test.ts#L69), [refuses with a 500 naming the lore-api deployment when the webhook secret is not configured @0d515f06](libs/shared/src/transport/http/github-delivery.test.ts#L84), [refuses a signed delivery with no x-github-event header with a 400 @1bda8720](libs/shared/src/transport/http/github-delivery.test.ts#L101))

lore-api serves the door at `POST /api/webhook/github` (`apps/lore-api/src/transport/routes/webhooks/webhook-github.ts`): a signed delivery answers 202 and writes its events to `pipeline.events` deduped on the delivery id; a request with no signature is refused 401 naming the missing header, never as a missing bearer token, and a mismatched signature writes nothing; the body may be larger than the 1 MB the other routes accept; the path is outside the rate limiter, because GitHub does not retry a refused delivery and a 429 would lose the event; and a signed body that is not JSON is a 400. ([validated by answers 202 and writes github.pull_request.closed deduped on github:d-1 and github.tracker.changed deduped on github:d-1:utopia for signed delivery d-1 @f7f57fff](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L71), [answers 401 naming the signature header for a delivery that carries no signature and no bearer token @6c7c0684](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L98), [answers 401 and writes nothing for a signature that does not match the secret @8b0b4f4c](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L109), [answers 202 for a signed delivery of 2 MB, over the 1 MB JSON limit of the other routes @63d17348](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L127), [answers 202 to the 31st delivery within a minute, past the 30 a minute of the other webhooks @8ea47f48](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L139), [answers 400 for a signed body that is not JSON @49ef6093](apps/lore-api/src/transport/routes/webhooks/webhook-github.test.ts#L155))

A merged spec PR parses tasks.md and syncs spec-tasks; a non-spec branch, an already-synced spec, and a missing tasks.md each skip with the matching reason; a null pool returns 503.

A `synchronize` pull_request triggers the review reactor; an unhandled action skips. ([validated by `github-map.test.ts@2406451a`](libs/shared/src/outbound/project/events/github-map.test.ts#L7), [validated by maps synchronize to github.pull_request.synchronize with repo + pr_number @2406451a](libs/shared/src/outbound/project/events/github-map.test.ts#L7))

A submitted review triggers both the review reactor and auto-merge; a non-submitted review skips; missing repo/pr returns 400. ([validated by `github-map.test.ts@697b80c0`](libs/shared/src/outbound/project/events/github-map.test.ts#L130), [`github-map.test.ts@e9f3ba10`](libs/shared/src/outbound/project/events/github-map.test.ts#L166))

A created PR comment triggers the review reactor; an edited comment and a non-PR comment skip. ([validated by `github-map.test.ts@11681bbe`](libs/shared/src/outbound/project/events/github-map.test.ts#L191), [`github-map.test.ts@12fd0dd9`](libs/shared/src/outbound/project/events/github-map.test.ts#L221))

A `repository` delivery with action `renamed` maps to `github.repository.renamed` carrying `from` (the owner login and the previous name) and `to` (the new full name); any other `repository` action maps to nothing. Its handler renames the `lore.repos` row in place, or, when onboarding already created a row under the new name, deletes the old row, all in one transaction; a rename whose old name has no row changes nothing (#2040). A merge keeps the new row's settings unless it has none, in which case it inherits the old row's, and in both a rename and a merge every other repo's `cross_repo_repos` list naming the old repo is pointed at the new one, since cross-repo links are stored on both sides; `lore.plans.repo`, a free-text column with no FK to `lore.repos`, is repointed the same way, since it would otherwise orphan every existing plan under the stale name. ([validated by maps a renamed re-cinq/HAL-engine to github.repository.renamed from re-cinq/HAL-engine to re-cinq/HALEngine @eb2c4bf0](libs/shared/src/outbound/project/events/github-map.test.ts#L432), [validated by returns nothing for an archived repository @61357993](libs/shared/src/outbound/project/events/github-map.test.ts#L452), [validated by renames re-cinq/HAL-engine to re-cinq/HALEngine in place when only the old row exists @f724c135](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L38), [validated by merges re-cinq/HAL-engine into re-cinq/HALEngine, keeping HALEngine's settings and dropping HAL-engine's row @997ed89a](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L56), [validated by returns absent and keeps re-cinq/lore when re-cinq/HAL-engine has no row @5658595d](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L155), [validated by updates owner, name and full_name of re-cinq/HAL-engine's row inside one transaction when re-cinq/HALEngine has none @62b93a3a](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L166), [validated by inherits empty settings and deletes re-cinq/HAL-engine's row inside one transaction when both rows exist @2312909c](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L196), [validated by returns absent without writing when re-cinq/HAL-engine has no row @83e5a917](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L231), [validated by rolls back and rethrows when deleting re-cinq/HAL-engine's row fails @d6f67501](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L249), [validated by renames the repository row from acme/gadgets to acme/widgets @8b15a1fc](apps/stations/src/events/repo-handlers.test.ts#L184), [validated by points re-cinq/the-expert-ui's cross-repo link at re-cinq/HALEngine when re-cinq/HAL-engine is renamed in place @8a0185c5](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L82), [validated by merges re-cinq/HAL-engine's cross-repo settings into a re-cinq/HALEngine row that has none, and repoints the link back to it @071e84da](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L102), [validated by keeps re-cinq/HALEngine's own settings when both rows carry some @bac2f9aa](libs/shared/src/outbound/project/settings/settings-rename.test.ts#L134))

A `lore`-labelled issue creates no task *(amended 2026-11-13; the task-creating dispatch was removed on 2026-10-02)*: the delivery is written to the event bus as `github.issues.labeled`, and the stations service queues the issue for the implementation loop with `priority:medium` when it carries no priority label and a comment. `specs/github-issue-dispatch` owns the rules. ([validated by queues issue 7 at priority:medium when it is labelled lore @114cb432](libs/shared/src/work/backlog/label-dispatch.test.ts#L33), [validated by labels issue 7 priority:medium and says the loop picks it up, when it carries no priority @b262cd00](libs/shared/src/work/backlog/queue-ticket.test.ts#L24), [validated by queues issue 7 of acme/widgets in the loop's backlog when it is labelled lore @6f7d3eae](apps/stations/src/events/repo-handlers.test.ts#L172))

Invalid JSON on any dispatched event returns 400.

### Webhook configuration (classify / ensure / management routes)

A repo hook is Lore's when its URL ends in one of `LORE_HOOK_PATHS` — the public `/api/events` URL or `/api/webhook/github` (`isLoreHook`). Both stay listed for as long as any repo may still carry the legacy URL: a legacy hook must classify as repointable and be updated in place, never mistaken for absent and duplicated. ([validated by lists /api/events and the legacy /api/webhook/github as Lore hook paths @7b9757e8](apps/lore-api/src/work/webhook/webhook-status.test.ts#L150), [`webhook-status.test.ts@249d7b25`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L157), [`webhook-status.test.ts@cbdf242d`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L161), [`webhook-status.test.ts@a5be7ec0`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L165))

The repo-webhook classifier (`classifyWebhook`) reports `configured` when a canonical-URL hook is active, covers the required events (or `['*']`), and last delivered 2xx or has never delivered; `missing` when no hook is at either Lore hook path; `wrong_url` when a hook at a Lore hook path differs from the canonical URL — which is how a pre-ADR-044 Floor hook, or one on another host, is reported until it is repointed — preferring the canonical hook when both are installed; `inactive` when the hook is disabled; `narrow_events` when it subscribes to only a subset (e.g. `issues`, or every pull-request and issue event without `push`, which the Utopia commit mirror and a protected branch's moving base need, or without `release` and `create`, which the Utopia release mirror needs); `delivery_failing` when the last delivery was non-2xx (e.g. a 401 secret mismatch); and `unknown` when the canonical URL is unset. ([validated by `webhook-status.test.ts@2c117bf4`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L25), [`webhook-status.test.ts@12a9da6d`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L32), [`webhook-status.test.ts@ead4988f`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L38), [`webhook-status.test.ts@8e07f2bd`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L50), [`webhook-status.test.ts@e0ceeda2`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L56), [`webhook-status.test.ts@f1d6e4ff`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L64), [`webhook-status.test.ts@224166e5`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L73), [`webhook-status.test.ts@3444d521`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L79), [validated by returns narrow_events for the hook re-cinq/lore had, which carries every pull-request and issue event but not push @537d298d](apps/lore-api/src/work/webhook/webhook-status.test.ts#L85), [validated by returns narrow_events for a hook that carries push but neither release nor create, which the Utopia release mirror needs @0a529b3d](apps/lore-api/src/work/webhook/webhook-status.test.ts#L100), [`webhook-status.test.ts@791b078b`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L116), [`webhook-status.test.ts@85300d24`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L128), [`webhook-status.test.ts@7a505678`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L137), [`webhook-status.test.ts@072f8af4`](apps/lore-api/src/work/webhook/webhook-status.test.ts#L144))

A hook without `check_suite` is `narrow_events` too *(added 2026-10-25)*: a finished build on a pull request's head is what the implementation loop's upkeep reads to repair a loop pull request whose CI went red after its run settled (`specs/external-floor` FR12.19), and no repo hook carried it, so `github.check_suite.completed` never reached the bus. ([validated by returns narrow_events for the hook re-cinq/Otto had, which carries push and release but not check_suite, the finished build the loop's upkeep fixes @43c36f5b](../../../apps/lore-api/src/work/webhook/webhook-status.test.ts#L174))

`ensureRepoWebhook` finds the repo's existing Lore hook by `isLoreHook` and PATCHes it in place — the whole config replaced, secret included, so a legacy or rotated hook comes out pointing at the canonical URL with the current secret — rather than creating a second hook; only when no Lore hook exists does it create one, active from the start. It pings the hook either way and returns it even when the ping rejects. ([validated by repoints a legacy hook at lore-webhook.gcp.re-cinq.com/api/webhook/github in place, replacing url, secret and events @6512965e](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L37), [`webhook-manage.test.ts@62f79082`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L55), [`webhook-manage.test.ts@a0619ab8`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L65), [`webhook-manage.test.ts@bbb0add2`](apps/lore-api/src/work/webhook/webhook-manage.test.ts#L89))

`ensureLoreWebhook` skips without touching GitHub when `LORE_WEBHOOK_URL` or `LORE_WEBHOOK_SECRET` is unset (`webhook_host_not_configured` / `secret_not_configured`); otherwise it ensures the repo hook with the secret and the required events (`repository` among them, so a rename reaches Lore, and `release` and `create`, so a published release or a new tag reaches the Utopia release mirror), reporting `app_no_webhook_permission` on a 403 and `ensure_failed` (with a detail) on any other error. ([validated by `webhook-ensure.test.ts@ed49813d`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L17), [`webhook-ensure.test.ts@5161264a`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L27), [`webhook-ensure.test.ts@574945f5`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L37), [`webhook-ensure.test.ts@8188fb8e`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L66), [`webhook-ensure.test.ts@cc13bf23`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L78), [`webhook-ensure.test.ts@beeca240`](apps/lore-api/src/work/webhook/webhook-ensure.test.ts#L89))

`GET /api/repos/:o/:r/webhook` returns the classified webhook state: `unknown` when the canonical URL is unset or the App lacks the webhook permission (403), and the `configured` classification otherwise. ([validated by `webhook-route.test.ts@6ba96209`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L55), [`webhook-route.test.ts@7dab0b94`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L66), [`webhook-route.test.ts@570e544f`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L79))

`POST /api/repos/:o/:r/webhook/ensure` ensures the hook and then returns the fresh status, mapping a `secret_not_configured` skip to 503, a `webhook_host_not_configured` skip to 503, an `app_no_webhook_permission` skip to 403, and any other skip reason to 500 (the skip's `detail`, or a generic message when absent); a post-ensure listing failure also returns 500, using `String(err)` when the thrown `Error` carries an empty message. ([validated by `webhook-route.test.ts@bc578809`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L103), [`webhook-route.test.ts@8a0c2f63`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L114), [`webhook-route.test.ts@c1baba36`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L125), [`maps a webhook_host_not_configured skip to 503` @d356fd57](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L139), [`maps an unmapped skip reason to 500 with its detail` @6b2e17e2](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L151), [`maps an unmapped skip reason with no detail to a generic 500 message` @6f2a9a1f](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L164), [`returns 500 when the post-ensure webhook listing throws` @8e86ea14](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L176), [`falls back to String(err) when the post-ensure listing throws an empty-message Error` @634e93eb](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L190))

`GET /api/repos/:o/:r/webhook/secret` returns the HMAC secret + canonical URL for an admin caller, or 503 when the secret is not configured. ([validated by `webhook-route.test.ts@7ff181ff`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L215), [`webhook-route.test.ts@c94f9bb4`](apps/lore-api/src/transport/routes/webhooks/webhook-route.test.ts#L224))

## Out of Scope

- The agent-side review-reactor / auto-merge engines (separate specs).
- `createTask` / `syncTasksToDb` pipeline internals.
- GitHub App installation.
- The event-router's bearer-token reporter branch, retired with the router (ADR-044 amendment).
