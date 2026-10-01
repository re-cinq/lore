import { z } from "zod";
import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type {
  ServerRoute,
  Request,
  ResponseToolkit,
  ResponseObject,
} from "@hapi/hapi";
import { createHmac, timingSafeEqual } from "node:crypto";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { NO_TYPED_TASKS } from "@re-cinq/lore-shared/task-types/retired-task-types.js";

/** Constant-time HMAC compare for the Slack `v0=…` signature. */
// Slack renders this body as-is (response_type + text or blocks format).
const SlackAckSchema = z.object({
  response_type: z.string().optional(),
  text: z.string().optional(),
  blocks: z.array(z.unknown()).optional(),
});

const USAGE =
  "Retry a failed task: `/lore retry <task_id>`\n" +
  "To have something implemented, open an issue with a `priority:*` label: the implementation loop picks it up.";

export function slackWebhookRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/webhook/slack",
    // Auth-exempt: Slack verifies itself via the HMAC signature below.
    options: zodResponse(
      { auth: false, payload: { parse: false } },
      SlackAckSchema,
      {
        name: "SlackAck",
        description: "The message Slack renders back in the channel",
      },
    ),
    handler: serveSlackCommand,
  };
}

/** The /lore slash command. Answers with the message Slack renders back in the channel, so the reply IS the user-visible result rather than a status code. */
async function serveSlackCommand(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const body = rawBody(request);
  const refusal = authenticateSlack(request, body, h);

  if (refusal) {
    return refusal;
  }
  const params = new URLSearchParams(body);

  if (params.get("type") === "url_verification") {
    return challengeResponse(h, params);
  }

  return commandReply(params, h);
}

/** Slack's own request check: the shared secret must be configured, the request signed, and recent enough that a replayed one is refused. Returns the refusal, or null when the request is genuine. */
export function authenticateSlack(
  request: Request,
  body: string,
  h: ResponseToolkit,
): ResponseObject | null {
  const slackSecret = process.env.LORE_SLACK_SIGNING_SECRET;

  if (!slackSecret) {
    return plainText(h, "Slack signing secret not configured", 503);
  }
  const { timestamp, signature } = slackHeaders(request);

  if (!timestamp || !signature) {
    return plainText(h, "Unauthorized", 401);
  }

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return plainText(h, "Request too old", 401);
  }

  return verifySlackSignature(slackSecret, timestamp, signature, body)
    ? null
    : plainText(h, "Invalid signature", 401);
}

// Plain-string error bodies use text/plain (hapi defaults to text/html).
function plainText(
  h: ResponseToolkit,
  message: string,
  code: number,
): ResponseObject {
  return h.response(message).type("text/plain").code(code);
}

/** The two headers Slack signs its request with. */
function slackHeaders(request: Request): {
  timestamp: string;
  signature: string;
} {
  return {
    timestamp: request.headers["x-slack-request-timestamp"] as string,
    signature: request.headers["x-slack-signature"] as string,
  };
}

export function verifySlackSignature(
  secret: string,
  timestamp: string,
  signature: string,
  body: string,
): boolean {
  const sigBase = `v0:${timestamp}:${body}`;
  const expected =
    "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

// hapi 204 on empty payload; Slack expects 200 for empty challenge.
function challengeResponse(h: ResponseToolkit, params: URLSearchParams) {
  return h
    .response(params.get("challenge") || "")
    .type("text/plain")
    .code(200);
}

/** What the typed command becomes: the usage note, a retry, or the answer that Lore takes no typed task from a description any more. Reached only for an already-verified request. */
async function commandReply(
  params: URLSearchParams,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const words = (params.get("text") || "").trim().split(/\s+/);

  if (!words[0]) {
    return h.response({ response_type: "ephemeral", text: USAGE });
  }

  if (words[0] === "retry" && words[1]) {
    return h.response(await retryReply(words[1]));
  }

  return h.response({ response_type: "ephemeral", text: NO_TYPED_TASKS });
}

async function retryReply(retryTaskId: string): Promise<object> {
  try {
    const { retryTask } =
      await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");
    const retryResult = await retryTask(retryTaskId);

    return {
      response_type: "in_channel",
      text: `Retrying task \`${retryTaskId}\`\nNew task: \`${retryResult.task_id}\``,
    };
  } catch (err) {
    return {
      response_type: "ephemeral",
      text: `Retry failed: ${errorMessage(err)}`,
    };
  }
}
