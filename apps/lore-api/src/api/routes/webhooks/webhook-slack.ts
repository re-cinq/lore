import { z } from "zod";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  ServerRoute,
  Request,
  ResponseToolkit,
  ResponseObject,
} from "@hapi/hapi";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { rawBody } from "../../../server/raw-body.js";

/** Constant-time HMAC compare for the Slack `v0=…` signature. */
/**
 * Slack renders whatever this returns in the channel, so the body is Slack's
 * message format rather than ours — `response_type` plus text or blocks.
 */
const SlackAckSchema = z.object({
  response_type: z.string().optional(),
  text: z.string().optional(),
  blocks: z.array(z.unknown()).optional(),
});

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

/** The repo mapped to a Slack channel via `settings.slack_channel_id`, or "" when unmapped. */
async function repoForSlackChannel(
  pool: Pool | null,
  channelId: string,
): Promise<string> {
  if (!pool) {
    return "";
  }

  try {
    const { rows } = await pool.query(
      `SELECT full_name FROM lore.repos WHERE settings->>'slack_channel_id' = $1`,
      [channelId],
    );

    return rows.length > 0 ? rows[0].full_name : "";
  } catch {
    return "";
  }
}

const USAGE =
  "Usage: `/lore [task_type] <description>`\nTask types: general, implementation, runbook, gap-fill, review\n\n" +
  "Prefix with `!` to execute immediately: `/lore ! implementation add caching`\nRetry a failed task: `/lore retry <task_id>`";

const KNOWN_TASK_TYPES = [
  "general",
  "implementation",
  "runbook",
  "gap-fill",
  "review",
  "feature-request",
];

/** Slack's own request check: the shared secret must be configured, the request signed, and recent enough that a replayed one is refused. Returns the refusal, or null when the request is genuine. */
function authenticateSlack(
  request: Request,
  body: string,
  h: ResponseToolkit,
): ResponseObject | null {
  // Plain-string error bodies: pin text/plain (hapi would default a string to
  // text/html) to match the legacy node:http `res.end("…")` responses.
  const slackSecret = process.env.LORE_SLACK_SIGNING_SECRET;

  if (!slackSecret) {
    return h
      .response("Slack signing secret not configured")
      .type("text/plain")
      .code(503);
  }
  const timestamp = request.headers["x-slack-request-timestamp"] as string;
  const slackSig = request.headers["x-slack-signature"] as string;

  if (!timestamp || !slackSig) {
    return h.response("Unauthorized").type("text/plain").code(401);
  }

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return h.response("Request too old").type("text/plain").code(401);
  }

  return verifySlackSignature(slackSecret, timestamp, slackSig, body)
    ? null
    : h.response("Invalid signature").type("text/plain").code(401);
}

interface SlashCommand {
  priority: string;
  taskType: string;
  description: string;
  retryTaskId?: string;
}

/** `/lore [!] [task_type] <description>`, or `/lore retry <task_id>`. A leading `!` asks for immediate priority; a first word that names a known type claims it, otherwise the whole text is the description. */
function parseSlashCommand(commandText: string): SlashCommand {
  let words = commandText.split(/\s+/);
  let priority = "normal";

  if (words[0] === "!") {
    priority = "immediate";
    words = words.slice(1);
  }

  if (words[0] === "retry" && words[1]) {
    return {
      priority,
      taskType: "general",
      description: "",
      retryTaskId: words[1],
    };
  }
  const named = words.length > 1 && KNOWN_TASK_TYPES.includes(words[0]);

  return {
    priority,
    taskType: named ? words[0] : "general",
    description: named ? words.slice(1).join(" ") : words.join(" "),
  };
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

/** Which repo the command lands on comes from the channel it was typed in; an unmapped channel is told so rather than defaulting somewhere surprising. */
async function createReply(
  pool: Pool | null,
  command: SlashCommand,
  from: { channelId: string; userName: string },
): Promise<object> {
  const targetRepo = await repoForSlackChannel(pool, from.channelId);

  if (!targetRepo) {
    return {
      response_type: "ephemeral",
      text: "No repo mapped to this channel. Set `slack_channel_id` in repo settings.",
    };
  }

  try {
    const taskResult = await createTask({
      description: command.description,
      taskType: command.taskType,
      targetRepo,
      createdBy: `slack:${from.userName}`,
      contextBundle: {
        slack_channel_id: from.channelId,
        slack_user: from.userName,
      },
      priority: command.priority,
    });
    const priorityLabel =
      command.priority === "immediate" ? " | Priority: `immediate`" : "";
    const followUp =
      command.priority === "immediate"
        ? "Agent will pick this up shortly."
        : "Task in backlog — claim locally or use the UI to run now.";

    return {
      response_type: "in_channel",
      text: `Task created on \`${targetRepo}\`:\n> ${command.description}\n\nType: \`${command.taskType}\`${priorityLabel} | ID: \`${taskResult.task_id}\`\n${followUp}`,
    };
  } catch (err) {
    return {
      response_type: "ephemeral",
      text: `Failed to create task: ${errorMessage(err)}`,
    };
  }
}

export function slackWebhookRoute(getPool: () => Pool | null): ServerRoute {
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
    handler: async (request, h) => {
      const body = rawBody(request);
      const refusal = authenticateSlack(request, body, h);

      if (refusal) {
        return refusal;
      }
      const params = new URLSearchParams(body);

      if (params.get("type") === "url_verification") {
        // hapi returns 204 for an empty payload; Slack expects 200 even for an
        // empty challenge, so pin the code.
        return h
          .response(params.get("challenge") || "")
          .type("text/plain")
          .code(200);
      }
      const commandText = (params.get("text") || "").trim();

      if (!commandText) {
        return h.response({ response_type: "ephemeral", text: USAGE });
      }
      const command = parseSlashCommand(commandText);

      if (command.retryTaskId) {
        return h.response(await retryReply(command.retryTaskId));
      }

      return h.response(
        await createReply(getPool(), command, {
          channelId: params.get("channel_id") || "",
          userName: params.get("user_name") || "unknown",
        }),
      );
    },
  };
}
