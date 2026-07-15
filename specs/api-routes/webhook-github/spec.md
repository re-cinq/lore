# Feature Specification: POST /api/webhook/github

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | GitHub webhook receiver                                               |
| Status  | **Draft**                                                            |
| Created | 2026-06-10                                                           |
| Owner   | Platform Engineering                                                 |
| Route   | `POST /api/webhook/github`                                           |
| Auth    | HMAC SHA-256 (`X-Hub-Signature-256: sha256=…`, secret `LORE_WEBHOOK_SECRET`) |
| Module  | `mcp-server/src/api/routes/webhooks.ts` (`handleGitHubWebhook`)      |

## Problem Statement

GitHub events (PR lifecycle, reviews, CI checks, issue comments, issue labels)
must drive the Lore pipeline: a merged spec PR fans out into spec-tasks, new
commits / reviews / comments wake the review reactor, completed CI checks
re-evaluate auto-merge, and a `lore`-labeled issue creates a pipeline task. The
endpoint authenticates each delivery by HMAC signature (not a bearer token —
the router exempts `/api/webhook/*` from scoped-token auth), then dispatches on
the `X-GitHub-Event` header. Most fan-out is fire-and-forget to the agent; the
HTTP response only reports what was dispatched or skipped.

## Interface

Registered in the route table ([registration](../../../apps/mcp-server/src/api/routes/index.ts#L64)).

- **Method + path**: `POST /api/webhook/github`
- **Auth**: HMAC SHA-256. Handler reads `LORE_WEBHOOK_SECRET` and the
  `X-Hub-Signature-256` header; `verifyGitHubSignature(secret, sig, rawBody)`
  recomputes `sha256=hex(hmac(secret, rawBody))` and constant-time compares.
  The router does **not** apply bearer-scope auth to `/api/webhook/*`
  ([auth exemption](../../../apps/mcp-server/src/api/routes/index.ts#L100)). Rate
  limiting uses the `webhook` bucket ([bucket](../../../apps/mcp-server/src/api/routes/index.ts#L89)).
- **Request body** (raw, signed): a GitHub webhook JSON payload. Dispatched by
  `X-GitHub-Event`:
  - `pull_request` — `{action, repository.full_name, pull_request:{number, merged, merge_commit_sha, head.ref, labels[]}}`.
  - `pull_request_review` — `{action, repository.full_name, pull_request.number}`.
  - `check_run` / `check_suite` — `{action, repository.full_name, check_run|check_suite:{pull_requests:[{number}]}}`.
  - `issue_comment` — `{action, repository.full_name, issue:{number, pull_request}}`.
  - `issues` — `{action, repository.full_name, label.name, issue:{number, title, body, html_url, labels[]}}`.
- **Response**: always JSON. `200` on dispatch/skip, `400` invalid JSON / missing
  fields, `401` missing/invalid signature, `500` task creation failure, `503`
  secret unset / pool unavailable.

## Behavior

1. **Read** `LORE_WEBHOOK_SECRET`, the `X-Hub-Signature-256` and `X-GitHub-Event`
   headers, and the raw request body.
2. **Secret gate** — if `LORE_WEBHOOK_SECRET` is unset, `503 {error:"webhook secret not configured"}`.
3. **Signature gate** — missing header → `401 {error:"missing signature"}`;
   `verifyGitHubSignature` false → `401 {error:"invalid signature"}`.
4. **Dispatch on `X-GitHub-Event`** (each branch re-parses the raw body and
   returns `400 {error:"invalid JSON"}` on a parse failure):
   - **`pull_request`**: if `action === "closed" && pull_request.merged`, run the
     spec-PR-merge path (step 5). Otherwise try the review trigger (step 6); if
     neither fires, `200 {skipped:true, reason:"no handler for pull_request action"}`.
   - **`pull_request_review`**: `action !== "submitted"` →
     `200 {skipped:true, reason:"not a submitted review"}`; missing repo/pr →
     `400`. Else fire `triggerAgentReviewReactor` **and** `triggerAgentAutoMerge`
     (a submitted APPROVED review can flip the auto-merge gate),
     `200 {triggered:"review-reactor", via:"pull_request_review"}`.
   - **`check_run` / `check_suite`**: `action !== "completed"` →
     `200 {skipped, reason:"not a completed action"}`; no `pull_requests[]` →
     `200 {skipped, reason:"no pull_requests in payload"}`. Else fan
     `triggerAgentAutoMerge(repo, pr.number)` over every PR,
     `200 {triggered:"auto-merge", pr_numbers, via}`.
   - **`issue_comment`**: `action === "created" && issue.pull_request` with
     repo+number → `triggerAgentReviewReactor`,
     `200 {triggered:"review-reactor", via:"issue_comment"}`; else
     `200 {skipped, reason:"not a PR issue_comment created event"}`.
   - any other event → `200 {skipped:true, reason:"not an issues event"}` unless
     the event is `issues` (step 7).
5. **Spec-PR merge** (`handleSpecPRMerge`): pool-null → `503`. Skip unless
   `head.ref` starts `lore/feature-request/` and labels include `spec`. Extract
   the slug (`branchSuffix.replace(/-[a-f0-9]{8}$/,"")`); empty → skip. Idempotency:
   if a `spec-task` row already exists for `(repo, spec_slug)` → skip. Read
   `specs/{slug}/tasks.md` from the merge commit via `readFileFromGitHub`; absent
   → skip. Else `parseTasks` → `inferPhaseDependencies` → `syncTasksToDb` under a
   new `task_group_id`, mark the parent `feature-request` task `merged`
   (failure swallowed), `200 {ok:true, spec_slug, task_group_id, tasks_synced, tasks_created}`.
6. **Review trigger** (`handlePullRequestReviewTrigger`): only for
   `synchronize|opened|reopened|ready_for_review` with repo+pr; fires
   `triggerAgentReviewReactor`, `200 {triggered:"review-reactor", via:"pull_request"}`.
7. **Issues dispatch**: `action !== "labeled"` → skip. Missing
   `repository.full_name`/`issue`/`label.name` → `400 {error:"missing required fields"}`.
   Load `dispatch_label` (default `lore`) and `dispatch_default_type` (default
   `general`) from `lore.repos.settings` (string or object; query error → defaults).
   Added label ≠ `dispatch_label` → skip. Pool-null → `503`. Pick `taskType` from
   issue labels (`lore:implementation|review|runbook`, else default). Duplicate
   guard: an existing non-failed/cancelled task on `(issue_number, repo)` →
   comment + `200 {skipped, reason:"duplicate"}` (query error logged, continues).
   Else `createTask(description, taskType, repo, "github-webhook", contextBundle)`
   (failure → `500`), persist `issue_number`/`issue_url`, then `ghIssueComment` +
   `ghAddLabel("lore-managed")` via `Promise.allSettled`,
   `200 {task_id, status}`.

**Env vars**: `LORE_WEBHOOK_SECRET` (required); `LORE_AGENT_URL` +
`LORE_AGENT_INTERNAL_TOKEN` (agent fan-out — when unset the trigger logs a
warning and is skipped, the webhook still returns success).

## Output

| Branch | Status | Body |
|--------|--------|------|
| Secret unset | 503 | `{"error":"webhook secret not configured"}` |
| Missing signature | 401 | `{"error":"missing signature"}` |
| Invalid signature | 401 | `{"error":"invalid signature"}` |
| Invalid JSON (any event branch) | 400 | `{"error":"invalid JSON"}` |
| Spec PR merged | 200 | `{"ok":true,"spec_slug":…,"task_group_id":…,"tasks_synced":…,"tasks_created":…}` |
| Not a spec PR | 200 | `{"skipped":true,"reason":"not a spec PR"}` |
| Spec-tasks already synced | 200 | `{"skipped":true,"reason":"spec-tasks already synced","spec_slug":…}` |
| No tasks.md | 200 | `{"skipped":true,"reason":"no tasks.md found","path":…}` |
| Review triggered (pull_request) | 200 | `{"triggered":"review-reactor","repo":…,"pr_number":…,"via":"pull_request"}` |
| Unhandled pull_request action | 200 | `{"skipped":true,"reason":"no handler for pull_request action","action":…}` |
| Review submitted | 200 | `{"triggered":"review-reactor",…,"via":"pull_request_review"}` |
| Non-submitted review | 200 | `{"skipped":true,"reason":"not a submitted review"}` |
| Review missing repo/pr | 400 | `{"error":"missing repo or pr_number"}` |
| Check completed | 200 | `{"triggered":"auto-merge","repo":…,"pr_numbers":[…],"via":"check_run"\|"check_suite"}` |
| Non-completed check | 200 | `{"skipped":true,"reason":"not a completed action","action":…}` |
| No PRs in check | 200 | `{"skipped":true,"reason":"no pull_requests in payload"}` |
| issue_comment on PR | 200 | `{"triggered":"review-reactor",…,"via":"issue_comment"}` |
| issue_comment non-PR/non-created | 200 | `{"skipped":true,"reason":"not a PR issue_comment created event"}` |
| Non-issues event | 200 | `{"skipped":true,"reason":"not an issues event"}` |
| Non-labeled issues action | 200 | `{"skipped":true,"reason":"not a labeled action"}` |
| Missing issue fields | 400 | `{"error":"missing required fields"}` |
| Label ≠ dispatch_label | 200 | `{"skipped":true,"reason":"label does not match dispatch_label"}` |
| Pool null after label match | 503 | `{"error":"database not available"}` |
| Duplicate task | 200 | `{"skipped":true,"reason":"duplicate","task_id":…}` |
| createTask failed | 500 | `{"error":…}` |
| Task created | 200 | `{"task_id":…,"status":…}` |

## Dependencies & side effects

- `verifyGitHubSignature` (pure HMAC compare).
- `readFileFromGitHub` (GitHub raw fetch via App/token); `ghIssueComment` /
  `ghAddLabel` (GitHub API).
- `triggerAgentReviewReactor` / `triggerAgentAutoMerge` — fire-and-forget
  `POST {LORE_AGENT_URL}/api/trigger/{review-reactor|auto-merge}` with
  `Authorization: Bearer {LORE_AGENT_INTERNAL_TOKEN}`.
- DB: `lore.repos.settings` read (dispatch label, spec idempotency check);
  `pipeline.tasks` inserts/updates (`createTask`, `syncTasksToDb`, parent merge).
- `parseTasks` / `inferPhaseDependencies` from `@re-cinq/lore-shared`.
- Env: `LORE_WEBHOOK_SECRET`, `LORE_AGENT_URL`, `LORE_AGENT_INTERNAL_TOKEN`.

## Acceptance Criteria

A valid `sha256=` signature over the raw body verifies; a tampered body or a
length-mismatched signature is rejected without throwing. ([validated by `github-webhook.test.ts:14`](apps/floor/src/delivery/http/routes/github-webhook.test.ts#L14), [`github-webhook.test.ts:24`](apps/floor/src/delivery/http/routes/github-webhook.test.ts#L24), [`github-webhook.test.ts:30`](apps/floor/src/delivery/http/routes/github-webhook.test.ts#L30))

An unset secret returns 503; a missing signature header returns 401 `missing signature`; an invalid signature returns 401 `invalid signature`. ([validated by `github-webhook.test.ts:48`](apps/floor/src/delivery/http/routes/github-webhook.test.ts#L48), [`github-webhook.test.ts:63`](apps/floor/src/delivery/http/routes/github-webhook.test.ts#L63))

A merged spec PR parses tasks.md and syncs spec-tasks; a non-spec branch, an already-synced spec, and a missing tasks.md each skip with the matching reason; a null pool returns 503.

A `synchronize` pull_request triggers the review reactor; an unhandled action skips. ([validated by `github-map.test.ts:7`](apps/floor/src/listeners/github-map.test.ts#L7), [`github-map.test.ts:83`](apps/floor/src/listeners/github-map.test.ts#L83))

A submitted review triggers both the review reactor and auto-merge; a non-submitted review skips; missing repo/pr returns 400. ([validated by `github-map.test.ts:95`](apps/floor/src/listeners/github-map.test.ts#L95))

A completed `check_run` / `check_suite` fans out auto-merge to every PR; a non-completed check and an empty PR list each skip. ([validated by `github-map.test.ts:189`](apps/floor/src/listeners/github-map.test.ts#L189), [`github-map.test.ts:212`](apps/floor/src/listeners/github-map.test.ts#L212))

A created PR comment triggers the review reactor; an edited comment and a non-PR comment skip. ([validated by `github-map.test.ts:112`](apps/floor/src/listeners/github-map.test.ts#L112), [`github-map.test.ts:136`](apps/floor/src/listeners/github-map.test.ts#L136))

A `lore`-labeled issue creates a task (type from issue labels) and labels the issue; a mismatched label, a duplicate, missing fields, a null pool, and a createTask failure each return their documented status. The duplicate guard excludes `failed`/`cancelled` tasks (a new task is allowed after the previous one failed), the dispatch decision reads `dispatch_label`/`auto_review` from `lore.repos.settings`, and the created task is linked to its issue via `issue_number`/`issue_url`. ([validated by `webhook.test.ts:61`](apps/lore-api/src/integration-tests/webhook.test.ts#L61), [`webhook.test.ts:79`](apps/lore-api/src/integration-tests/webhook.test.ts#L79), [`webhook.test.ts:91`](apps/lore-api/src/integration-tests/webhook.test.ts#L91))

Invalid JSON on any dispatched event returns 400.

### Webhook configuration (classify / ensure / management routes)

The repo-webhook classifier (`classifyWebhook`) reports `configured` when a canonical-URL hook is active, covers the required events (or `['*']`), and last delivered 2xx or has never delivered; `missing` when no hook targets the Floor webhook path; `wrong_url` when a Floor-path hook still points at the old host; `inactive` when the hook is disabled; `narrow_events` when it subscribes to only a subset (e.g. `issues`); `delivery_failing` when the last delivery was non-2xx (e.g. a 401 secret mismatch); and `unknown` when the canonical URL is unset. ([validated by `webhook-status.test.ts:22`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L22), [`webhook-status.test.ts:29`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L29), [`webhook-status.test.ts:35`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L35), [`webhook-status.test.ts:47`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L47), [`webhook-status.test.ts:55`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L55), [`webhook-status.test.ts:61`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L61), [`webhook-status.test.ts:67`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L67), [`webhook-status.test.ts:79`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L79), [`webhook-status.test.ts:88`](apps/lore-api/src/features/webhook/webhook-status.test.ts#L88))

`ensureFloorWebhook` skips without touching GitHub when `LORE_WEBHOOK_URL` or `LORE_WEBHOOK_SECRET` is unset (`webhook_host_not_configured` / `secret_not_configured`); otherwise it ensures the repo hook with the secret and the required events, reporting `app_no_webhook_permission` on a 403 and `ensure_failed` (with a detail) on any other error. ([validated by `webhook-ensure.test.ts:17`](apps/lore-api/src/features/webhook/webhook-ensure.test.ts#L17), [`webhook-ensure.test.ts:27`](apps/lore-api/src/features/webhook/webhook-ensure.test.ts#L27), [`webhook-ensure.test.ts:37`](apps/lore-api/src/features/webhook/webhook-ensure.test.ts#L37), [`webhook-ensure.test.ts:62`](apps/lore-api/src/features/webhook/webhook-ensure.test.ts#L62), [`webhook-ensure.test.ts:74`](apps/lore-api/src/features/webhook/webhook-ensure.test.ts#L74))

`GET /api/repos/:o/:r/webhook` returns the classified webhook state: `unknown` when the canonical URL is unset or the App lacks the webhook permission (403), and the `configured` classification otherwise. ([validated by `webhook-route.test.ts:52`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L52), [`webhook-route.test.ts:63`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L63), [`webhook-route.test.ts:76`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L76))

`POST /api/repos/:o/:r/webhook/ensure` ensures the hook and then returns the fresh status, mapping a `secret_not_configured` skip to 503 and an `app_no_webhook_permission` skip to 403. ([validated by `webhook-route.test.ts:100`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L100), [`webhook-route.test.ts:111`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L111), [`webhook-route.test.ts:122`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L122))

`GET /api/repos/:o/:r/webhook/secret` returns the HMAC secret + canonical URL for an admin caller, or 503 when the secret is not configured. ([validated by `webhook-route.test.ts:147`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L147), [`webhook-route.test.ts:156`](apps/lore-api/src/api/routes/webhooks/webhook-route.test.ts#L156))

The actual network delivery to the agent's `/api/trigger/*` endpoints is fire-and-forget; the webhook returns success even when `LORE_AGENT_URL` is unset or the fetch rejects. *(untested: live agent HTTP — the suite asserts the warn-and-continue / swallow-failure behavior but not real delivery; see `warns and continues when the agent env is unset` L157 / `swallows a failing reactor-trigger fetch` L162.)*

## Out of Scope

- The agent-side review-reactor / auto-merge engines (separate specs).
- `createTask` / `syncTasksToDb` pipeline internals.
- GitHub webhook delivery configuration and App installation.
- The bearer-scope auth path (webhooks are HMAC-only and auth-exempt at the router).
