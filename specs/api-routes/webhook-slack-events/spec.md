# Feature Specification: POST /api/webhook/slack-events

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Feature | Slack Events API receiver: a trash-can reaction deletes a Lore message |
| Status  | In Progress                                                           |
| Created | 2026-09-28                                                            |
| Owner   | Platform Engineering                                                  |
| Route   | `POST /api/webhook/slack-events`                                      |
| Auth    | HMAC SHA-256 (`X-Slack-Signature: v0=…` over `v0:{ts}:{body}`, secret `LORE_SLACK_SIGNING_SECRET`) + 5-min replay window |
| Module  | `apps/lore-api/src/transport/routes/webhooks/webhook-slack-events.ts` |

POST /api/webhook/slack-events lets anyone in a channel remove a Lore notice that is no longer news by reacting to it with the trash-can emoji, without admin rights and without Lore reading the channel.

## Problem Statement

Lore posts failure notices, digests and PR links to Slack. Once a failure is
explained or fixed, its notice is noise, but only the bot that posted it (or a
workspace admin) can delete it. The bot's token can delete its own messages
with `chat:write`, yet it holds no history scope, so Lore cannot find a message
to delete by itself. The people reading the channel can point at it instead.

## Behavior

1. The route verifies Slack's request signature and replay window with the
   same check as the `/lore` slash command (`authenticateSlack`); a request
   that fails it is refused with 401 and nothing is deleted.
   ([validated by refuses a bad signature with 401 and deletes nothing](apps/lore-api/src/transport/routes/webhooks/webhook-slack-events.test.ts#L97))
2. A `url_verification` envelope is answered with its `challenge`, as plain
   text with status 200, so Slack accepts the URL as the app's event endpoint.
   ([validated by answers the url_verification handshake with its challenge](apps/lore-api/src/transport/routes/webhooks/webhook-slack-events.test.ts#L60))
3. A `reaction_added` event whose reaction is `wastebasket` on a message
   deletes that message with `chat.delete` (channel + ts from the event's
   `item`), using `LORE_SLACK_BOT_TOKEN`. The route answers 200 without waiting
   for the delete, because Slack re-sends an event it has not seen
   acknowledged within 3 seconds.
   ([validated by deletes message 1790590000.000100 in C0LORE when someone reacts with wastebasket](apps/lore-api/src/transport/routes/webhooks/webhook-slack-events.test.ts#L72))
4. Any other event or reaction is acknowledged with 200 and deletes nothing.
   ([validated by deletes nothing for a thumbsup reaction](apps/lore-api/src/transport/routes/webhooks/webhook-slack-events.test.ts#L90))

## Rationale

Whose message it is needs no check: Slack refuses a bot's `chat.delete` on
anything the bot did not post, so a trash can on a person's message is
refused by Slack and only logged. A delete that Slack refuses is logged, not
retried.

## Setup

The Slack app needs the `reactions:read` bot scope and an event subscription
for `reaction_added` pointed at this route (`scripts/slack-app-manifest.yaml`).
Reinstalling the app to grant the scope keeps the bot token. The bot only
receives reactions in channels it is a member of, which are the channels it
posts to.
