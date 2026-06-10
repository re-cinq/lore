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

Registered in the route table ([registration](../../../mcp-server/src/api/routes/index.ts#L64)).

- **Method + path**: `POST /api/webhook/github`
- **Auth**: HMAC SHA-256. Handler reads `LORE_WEBHOOK_SECRET` and the
  `X-Hub-Signature-256` header; `verifyGitHubSignature(secret, sig, rawBody)`
  recomputes `sha256=hex(hmac(secret, rawBody))` and constant-time compares.
  The router does **not** apply bearer-scope auth to `/api/webhook/*`
  ([auth exemption](../../../mcp-server/src/api/routes/index.ts#L100)). Rate
  limiting uses the `webhook` bucket ([bucket](../../../mcp-server/src/api/routes/index.ts#L89)).
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
length-mismatched signature is rejected without throwing. ([validated by `returns true for a matching sha256 signature`](../../../mcp-server/src/api/routes/webhook-signature.test.ts#L11), [`returns false when the signature is for a different body`](../../../mcp-server/src/api/routes/webhook-signature.test.ts#L15), [`returns false on a length mismatch without throwing`](../../../mcp-server/src/api/routes/webhook-signature.test.ts#L19))

An unset secret returns 503; a missing signature header returns 401 `missing signature`; an invalid signature returns 401 `invalid signature`. ([validated by `returns 503 when the webhook secret is unset`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L57), [`returns 401 when the signature header is missing`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L62), [`returns 401 on an invalid signature`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L67))

A merged spec PR parses tasks.md and syncs spec-tasks; a non-spec branch, an already-synced spec, and a missing tasks.md each skip with the matching reason; a null pool returns 503. ([validated by `syncs spec-tasks on a merged spec PR`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L87), [`skips a non-spec branch`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L110), [`skips when spec-tasks already synced`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L125), [`skips when tasks.md is missing (no GitHub token)`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L131), [`returns 503 when pool is null on a spec merge`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L106))

A `synchronize` pull_request triggers the review reactor; an unhandled action skips. ([validated by `triggers the review reactor on synchronize`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L145), [`skips an unhandled pull_request action`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L153))

A submitted review triggers both the review reactor and auto-merge; a non-submitted review skips; missing repo/pr returns 400. ([validated by `triggers reactor and auto-merge on a submitted review`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L175), [`skips a non-submitted review`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L184), [`returns 400 when repo/pr missing on submitted review`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L180))

A completed `check_run` / `check_suite` fans out auto-merge to every PR; a non-completed check and an empty PR list each skip. ([validated by `fans out auto-merge for check_run`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L195), [`fans out auto-merge for check_suite`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L199), [`skips a non-completed check`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L203), [`skips when there are no pull_requests`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L207))

A created PR comment triggers the review reactor; an edited comment and a non-PR comment skip. ([validated by `triggers reactor on a PR comment`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L230), [`skips an edited (non-created) PR comment`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L242), [`skips a non-PR comment`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L238))

A `lore`-labeled issue creates a task (type from issue labels) and labels the issue; a mismatched label, a duplicate, missing fields, a null pool, and a createTask failure each return their documented status. ([validated by `picks the implementation task type from issue labels`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L319), [`skips when the label does not match dispatch_label`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L276), [`skips a duplicate task and comments on the issue`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L330), [`returns 400 on missing fields`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L272), [`returns 503 when pool is null after the label matches`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L315), [`returns 500 when createTask throws`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L363))

Invalid JSON on any dispatched event returns 400. ([validated by `returns 400 on invalid JSON`](../../../mcp-server/src/api/routes/webhook-github.test.ts#L168))

The actual network delivery to the agent's `/api/trigger/*` endpoints is fire-and-forget; the webhook returns success even when `LORE_AGENT_URL` is unset or the fetch rejects. *(untested: live agent HTTP — the suite asserts the warn-and-continue / swallow-failure behavior but not real delivery; see `warns and continues when the agent env is unset` L157 / `swallows a failing reactor-trigger fetch` L162.)*

## Out of Scope

- The agent-side review-reactor / auto-merge engines (separate specs).
- `createTask` / `syncTasksToDb` pipeline internals.
- GitHub webhook delivery configuration and App installation.
- The bearer-scope auth path (webhooks are HMAC-only and auth-exempt at the router).
