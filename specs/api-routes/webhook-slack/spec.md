# Feature Specification: POST /api/webhook/slack

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | Slack `/lore` slash-command receiver                                  |
| Status  | In Progress                                                          |
| Created | 2026-06-10                                                           |
| Owner   | Platform Engineering                                                 |
| Route   | `POST /api/webhook/slack`                                            |
| Auth    | HMAC SHA-256 (`X-Slack-Signature: v0=…` over `v0:{ts}:{body}`, secret `LORE_SLACK_SIGNING_SECRET`) + 5-min replay window |
| Module  | `mcp-server/src/api/routes/webhooks.ts` (`handleSlackWebhook`)       |

POST /api/webhook/slack receives the signed `/lore` slash command from Slack and verifies it. Since 2026-10-02 the command creates no task (`specs/external-floor` FR16.7): it retries a failed one, and answers anything else with where that work goes now.

## Problem Statement

Developers invoked `/lore [task_type] <description>` from Slack to create
pipeline tasks without leaving the channel. Lore no longer runs a typed task
from a description, so the command keeps one verb, `/lore retry <task_id>`.
Slack delivers the command as a URL-encoded form body signed with HMAC-SHA256
over `v0:{timestamp}:{rawBody}`. The endpoint verifies the signature and a
5-minute replay window (Slack's own scheme — not a bearer token; the router
exempts `/api/webhook/*`) and answers the one-time `url_verification` challenge.
All replies are Slack message JSON (`response_type` + `text`).

## Interface

Registered in the route table ([registration](../../../apps/lore-api/src/app/build-server.ts#L105)).

- **Method + path**: `POST /api/webhook/slack`
- **Auth**: HMAC SHA-256 + replay window. Handler reads
  `LORE_SLACK_SIGNING_SECRET`, the `X-Slack-Request-Timestamp` and
  `X-Slack-Signature` headers; rejects timestamps older than 300s; then
  `verifySlackSignature(secret, ts, sig, rawBody)` recomputes
  `v0=hex(hmac(secret, "v0:{ts}:{rawBody}"))` and constant-time compares. The
  router does not apply bearer-scope auth to `/api/webhook/*`
  ([auth exemption](../../../apps/lore-api/src/transport/routes/webhooks/webhook-slack.ts#L29)); rate
  limiting uses the `webhook` bucket.
- **Request body** (raw, URL-encoded form): Slack slash-command params —
  `text`, `channel_id`, `user_name`, and for the URL handshake `type`,
  `challenge`.
- **Response**:
  - `url_verification` → `200 text/plain` echoing `challenge` (or empty).
  - All command replies → `200 application/json` `{response_type, text}` with
    `response_type` `in_channel` (retry) or `ephemeral` (usage, errors, and the "no typed task" answer).
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
   (how to retry a task, and that code is implemented from an issue with a `priority:*` label).
5. **Retry** — `words[0] === "retry" && words[1]` → dynamic-import `retryTask`,
   on success `200 {response_type:"in_channel", text:"Retrying task …\nNew task: …"}`,
   on failure `200 {response_type:"ephemeral", text:"Retry failed: …"}`.
6. **Anything else** — `200 {response_type:"ephemeral", text}` saying that Lore no longer runs
   typed tasks and where that work goes: an issue with a `priority:*` label, a plan, or the
   review every pull request already gets. No repo is looked up and nothing is created.

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
| Anything else | 200 | `{response_type:"ephemeral", text:"Lore no longer runs typed tasks, …"}` |

## Dependencies & side effects

- `verifySlackSignature` (pure HMAC compare).
- Dynamically-imported `retryTask`.
- Env: `LORE_SLACK_SIGNING_SECRET`.

## Acceptance Criteria

A valid `v0=` signature over `v0:{ts}:{body}` verifies; a mismatched timestamp or a length-mismatched signature is rejected without throwing. ([validated by `returns true for a matching v0 signature`](apps/lore-api/src/transport/routes/webhooks/webhook-signature.test.ts#L16), [`returns false when the timestamp differs`](apps/lore-api/src/transport/routes/webhooks/webhook-signature.test.ts#L20), [`returns false on a length mismatch without throwing`](apps/lore-api/src/transport/routes/webhooks/webhook-signature.test.ts#L24), [`slack-webhook.test.ts:10`](apps/lore-api/src/transport/routes/webhooks/slack-webhook.test.ts#L10), [`slack-webhook.test.ts:22`](apps/lore-api/src/transport/routes/webhooks/slack-webhook.test.ts#L22), [`slack-webhook.test.ts:31`](apps/lore-api/src/transport/routes/webhooks/slack-webhook.test.ts#L31), [`slack-webhook.test.ts:48`](apps/lore-api/src/transport/routes/webhooks/slack-webhook.test.ts#L48), [`slack-webhook.test.ts:55`](apps/lore-api/src/transport/routes/webhooks/slack-webhook.test.ts#L55))

An unset secret returns 503; missing signature headers, a stale timestamp, and an invalid signature each return 401. ([validated by `returns 503 when the signing secret is unset`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L61), [`returns 401 when signature headers are missing`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L68), [`returns 401 when the timestamp is too old`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L78), [`returns 401 on an invalid signature`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L87))

The url_verification handshake echoes the challenge, and an absent challenge yields an empty body. ([validated by `answers the url_verification challenge`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L93), [`answers url_verification with an empty challenge when absent`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L100), [`webhook-slack.test.ts:94`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L93))

An empty command returns the ephemeral usage help. ([validated by `returns usage help when text is empty`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L107))

`retry <id>` retries the task and reports the new id; a failing retry reports it ephemerally. ([validated by `retries a task`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L113), [`reports a failed retry`](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L121))

Any other command, a bare `retry` with no id included, creates no task and answers ephemerally with where that work goes now. ([validated by creates no task for /lore %s and says where that work goes now](apps/lore-api/src/transport/routes/webhooks/webhook-slack.test.ts#L128))

## Out of Scope

- Slack app manifest / slash-command registration (`scripts/slack-app-manifest.yaml`).
- The agent posting PR/issue links back to the channel.
- The bearer-scope auth path (webhooks are HMAC-only and auth-exempt at the router).
