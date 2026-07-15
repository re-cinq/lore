# Feature Specification: POST /api/webhook/slack

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | Slack `/lore` slash-command receiver                                  |
| Status  | **Draft**                                                            |
| Created | 2026-06-10                                                           |
| Owner   | Platform Engineering                                                 |
| Route   | `POST /api/webhook/slack`                                            |
| Auth    | HMAC SHA-256 (`X-Slack-Signature: v0=…` over `v0:{ts}:{body}`, secret `LORE_SLACK_SIGNING_SECRET`) + 5-min replay window |
| Module  | `mcp-server/src/api/routes/webhooks.ts` (`handleSlackWebhook`)       |

## Problem Statement

Developers invoke `/lore [task_type] <description>` from Slack to create
pipeline tasks without leaving the channel. Slack delivers the command as a
URL-encoded form body signed with HMAC-SHA256 over `v0:{timestamp}:{rawBody}`.
The endpoint verifies the signature and a 5-minute replay window (Slack's
own scheme — not a bearer token; the router exempts `/api/webhook/*`), answers
the one-time `url_verification` challenge, parses the command, maps the Slack
channel to a repo via `lore.repos.settings.slack_channel_id`, and creates a
task. All replies are Slack message JSON (`response_type` + `text`).

## Interface

Registered in the route table ([registration](../../../apps/mcp-server/src/api/routes/index.ts#L65)).

- **Method + path**: `POST /api/webhook/slack`
- **Auth**: HMAC SHA-256 + replay window. Handler reads
  `LORE_SLACK_SIGNING_SECRET`, the `X-Slack-Request-Timestamp` and
  `X-Slack-Signature` headers; rejects timestamps older than 300s; then
  `verifySlackSignature(secret, ts, sig, rawBody)` recomputes
  `v0=hex(hmac(secret, "v0:{ts}:{rawBody}"))` and constant-time compares. The
  router does not apply bearer-scope auth to `/api/webhook/*`
  ([auth exemption](../../../apps/mcp-server/src/api/routes/index.ts#L100)); rate
  limiting uses the `webhook` bucket.
- **Request body** (raw, URL-encoded form): Slack slash-command params —
  `text`, `channel_id`, `user_name`, and for the URL handshake `type`,
  `challenge`.
- **Response**:
  - `url_verification` → `200 text/plain` echoing `challenge` (or empty).
  - All command replies → `200 application/json` `{response_type, text}` with
    `response_type` `in_channel` (success/retry) or `ephemeral` (usage/errors/no-repo).
  - Auth failures → plaintext `401`/`503` (`writeHead(code).end("…")`).

## Behavior

1. **Read** the raw body, then `LORE_SLACK_SIGNING_SECRET`. Unset →
   `503 "Slack signing secret not configured"`.
2. **Signature gate** — missing `X-Slack-Request-Timestamp` or
   `X-Slack-Signature` → `401 "Unauthorized"`. `|now − ts| > 300s` →
   `401 "Request too old"`. `verifySlackSignature` false → `401 "Invalid signature"`.
3. **Parse** the body as `URLSearchParams`. `type === "url_verification"` →
   `200 text/plain` `challenge` (or `""`).
4. **Empty command** — trimmed `text` empty → `200 {response_type:"ephemeral", text: usage help}`
   (the `/lore [task_type] <description>` usage string verbatim, listing
   `general, implementation, runbook, gap-fill, review`, the `!` immediate prefix,
   and `retry <task_id>`).
5. **Priority** — split on whitespace; a leading `!` sets `priority="immediate"`
   and is stripped, else `priority="normal"`.
6. **Retry** — `words[0] === "retry" && words[1]` → dynamic-import `retryTask`,
   on success `200 {response_type:"in_channel", text:"Retrying task …\nNew task: …"}`,
   on failure `200 {response_type:"ephemeral", text:"Retry failed: …"}`.
7. **Type parse** — if `words.length > 1` and `words[0]` is in
   `[general, implementation, runbook, gap-fill, review, feature-request]`, use
   it as `taskType` and the rest as `description`; otherwise `taskType="general"`
   and the whole text is the description.
8. **Channel→repo** — when a pool exists, `SELECT full_name FROM lore.repos
   WHERE settings->>'slack_channel_id' = $channelId` (query error → empty repo).
   No repo (or null pool) → `200 {response_type:"ephemeral", text:"No repo mapped to this channel. …"}`.
9. **Create task** — `createTask(description, taskType, targetRepo,
   "slack:{userName}", {slack_channel_id, slack_user}, priority)`. Success →
   `200 {response_type:"in_channel", text: confirmation}` (includes repo,
   description, type, the `| Priority: \`immediate\`` suffix when immediate, the
   task id, and a backlog/pick-up note). Failure →
   `200 {response_type:"ephemeral", text:"Failed to create task: …"}`.

**Env vars**: `LORE_SLACK_SIGNING_SECRET` (required for signature verification).

## Output

| Branch | Status | Body |
|--------|--------|------|
| Signing secret unset | 503 | `Slack signing secret not configured` (text/plain) |
| Missing sig headers | 401 | `Unauthorized` (text/plain) |
| Timestamp too old | 401 | `Request too old` (text/plain) |
| Invalid signature | 401 | `Invalid signature` (text/plain) |
| URL verification | 200 | `{challenge}` (text/plain) |
| Empty command | 200 | `{response_type:"ephemeral", text:"Usage: …"}` |
| Retry success | 200 | `{response_type:"in_channel", text:"Retrying task \`…\`\nNew task: \`…\`"}` |
| Retry failure | 200 | `{response_type:"ephemeral", text:"Retry failed: …"}` |
| No repo mapped / null pool | 200 | `{response_type:"ephemeral", text:"No repo mapped to this channel. Set \`slack_channel_id\` in repo settings."}` |
| Task created | 200 | `{response_type:"in_channel", text:"Task created on \`{repo}\`: …"}` |
| createTask failed | 200 | `{response_type:"ephemeral", text:"Failed to create task: …"}` |

## Dependencies & side effects

- `verifySlackSignature` (pure HMAC compare).
- `createTask` (`pipeline.tasks` insert) and dynamically-imported `retryTask`.
- DB: `lore.repos.settings` read for the channel→repo mapping.
- Env: `LORE_SLACK_SIGNING_SECRET`.

## Acceptance Criteria

A valid `v0=` signature over `v0:{ts}:{body}` verifies; a mismatched timestamp or a length-mismatched signature is rejected without throwing. ([validated by `returns true for a matching v0 signature`](../../../apps/mcp-server/src/api/routes/webhook-signature.test.ts#L29), [`returns false when the timestamp differs`](../../../apps/mcp-server/src/api/routes/webhook-signature.test.ts#L33), [`returns false on a length mismatch without throwing`](../../../apps/mcp-server/src/api/routes/webhook-signature.test.ts#L37))

An unset secret returns 503; missing signature headers, a stale timestamp, and an invalid signature each return 401. ([validated by `returns 503 when the signing secret is unset`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L44), [`returns 401 when signature headers are missing`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L49), [`returns 401 when the timestamp is too old`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L54), [`returns 401 on an invalid signature`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L58))

The url_verification handshake echoes the challenge, and an absent challenge yields an empty body. ([validated by `answers the url_verification challenge`](apps/lore-api/src/api/routes/webhooks/webhook-slack.test.ts#L62), [`answers url_verification with an empty challenge when absent`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L67))

An empty command returns the ephemeral usage help. ([validated by `returns usage help when text is empty`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L72))

`retry <id>` retries the task and reports the new id; a failing retry reports it ephemerally; a bare `retry` with no id is treated as a general-task description. ([validated by `retries a task`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L76), [`reports a failed retry`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L82), [`treats a bare retry with no task id as a general-task description`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L125))

An unmapped channel, a null pool, and a failing channel lookup all return the "No repo mapped" ephemeral message. ([validated by `returns the no-repo message when the channel is unmapped`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L87), [`returns the no-repo message when pool is null`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L93), [`falls through to no-repo when the channel query throws`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L97))

A `! implementation …` command creates an immediate implementation task with the exact createTask arguments; a `! …` with no known type creates an immediate general task; a normal-priority command reports the backlog; a createTask failure is reported ephemerally. ([validated by `creates an immediate task with a known type`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L103), [`creates an immediate general-typed task when no known type follows the bang`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L133), [`creates a normal-priority task and reports the backlog`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L111), [`reports a failed task creation`](../../../apps/mcp-server/src/api/routes/webhook-slack.test.ts#L118))

The pure command parser extracts the type, defaults to general, handles the `!` prefix, and does not match partial type names. ([validated by `parses /lore implementation add auth`](../../../apps/mcp-server/src/api/routes/slack-webhook.test.ts#L88), [`defaults to general when no type specified`](../../../apps/mcp-server/src/api/routes/slack-webhook.test.ts#L94), [`parses ! prefix as immediate priority`](../../../apps/mcp-server/src/api/routes/slack-webhook.test.ts#L129), [`does not match partial type names`](../../../apps/mcp-server/src/api/routes/slack-webhook.test.ts#L106))

## Out of Scope

- The pipeline task lifecycle after creation (claim/run/PR).
- Slack app manifest / slash-command registration (`scripts/slack-app-manifest.yaml`).
- The agent posting PR/issue links back to the channel.
- The bearer-scope auth path (webhooks are HMAC-only and auth-exempt at the router).
