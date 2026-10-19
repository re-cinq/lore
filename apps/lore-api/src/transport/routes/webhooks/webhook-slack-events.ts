import { z } from "zod";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { zodResponse } from "../../http/zod-response.js";
import { authenticateSlack } from "./webhook-slack.js";

/** Slack's name for the trash-can emoji. */
const TRASH_REACTION = "wastebasket";

const SlackEventAckSchema = z.string();

interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    reaction?: string;
    item?: { type?: string; channel?: string; ts?: string };
  };
}

/** Slack Events API receiver. A trash-can reaction on a Lore message deletes it, so a channel can tidy away notices that are no longer news without anyone holding admin rights. */
export function slackEventsRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/webhook/slack-events",
    // Auth-exempt: Slack verifies itself via the HMAC signature.
    options: zodResponse(
      { auth: false, payload: { parse: false } },
      SlackEventAckSchema,
      {
        name: "SlackEventAck",
        description:
          "Empty acknowledgement, or the url_verification challenge echoed back",
      },
    ),
    handler: (request, h) => serveSlackEvent(request, h),
  };
}

function serveSlackEvent(request: Request, h: ResponseToolkit): ResponseObject {
  const body = rawBody(request);
  const refusal = authenticateSlack(request, body, h);

  if (refusal) {
    return refusal;
  }
  const envelope = JSON.parse(body) as SlackEventEnvelope;
  const trashed = trashedMessage(envelope);

  if (trashed) {
    // Not awaited: Slack re-sends an event it has not seen acknowledged within 3 s.
    void deleteMessage(trashed).catch((err: unknown) =>
      console.error("[slack-events] chat.delete failed:", err),
    );
  }

  return h
    .response(envelope.type === "url_verification" ? envelope.challenge : "")
    .type("text/plain")
    .code(200);
}

type SlackEvent = NonNullable<SlackEventEnvelope["event"]>;
type ReactedTo = NonNullable<SlackEvent["item"]>;

/** The message a trash-can reaction points at, or null for any other event. Whose message it is needs no check here: Slack refuses a bot's chat.delete on anything it did not post. */
export function trashedMessage(
  envelope: SlackEventEnvelope,
): { channel: string; ts: string } | null {
  const { event } = envelope;

  return event && isTrashReaction(event) ? reactedMessage(event.item) : null;
}

function isTrashReaction(event: SlackEvent): boolean {
  return event.type === "reaction_added" && event.reaction === TRASH_REACTION;
}

/** The channel and ts of a reacted-to message; null when the reaction was on a file or the item is incomplete. */
function reactedMessage(
  reactedTo: ReactedTo | undefined,
): { channel: string; ts: string } | null {
  if (reactedTo?.type !== "message") {
    return null;
  }
  const { channel, ts } = reactedTo;

  return channel && ts ? { channel, ts } : null;
}

async function deleteMessage(message: {
  channel: string;
  ts: string;
}): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.delete", {
    signal: AbortSignal.timeout(10_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LORE_SLACK_BOT_TOKEN ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  const result = (await res.json()) as { ok: boolean; error?: string };

  if (!result.ok) {
    console.warn(`[slack-events] chat.delete refused: ${result.error}`);
  }
}
