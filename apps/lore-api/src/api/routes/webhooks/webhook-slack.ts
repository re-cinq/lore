import { z } from "zod";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
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
      const slackSecret = process.env.LORE_SLACK_SIGNING_SECRET;

      // Plain-string error bodies: pin text/plain (hapi would default a string to
      // text/html) to match the legacy node:http `res.end("…")` responses.
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

      if (!verifySlackSignature(slackSecret, timestamp, slackSig, body)) {
        return h.response("Invalid signature").type("text/plain").code(401);
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
      const channelId = params.get("channel_id") || "";
      const userName = params.get("user_name") || "unknown";

      if (!commandText) {
        return h.response({
          response_type: "ephemeral",
          text: "Usage: `/lore [task_type] <description>`\nTask types: general, implementation, runbook, gap-fill, review\n\nPrefix with `!` to execute immediately: `/lore ! implementation add caching`\nRetry a failed task: `/lore retry <task_id>`",
        });
      }

      let words = commandText.split(/\s+/);
      let priority = "normal";

      if (words[0] === "!") {
        priority = "immediate";
        words = words.slice(1);
      }

      if (words[0] === "retry" && words[1]) {
        const retryTaskId = words[1];

        try {
          const { retryTask } =
            await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");
          const retryResult = await retryTask(retryTaskId);

          return h.response({
            response_type: "in_channel",
            text: `Retrying task \`${retryTaskId}\`\nNew task: \`${retryResult.task_id}\``,
          });
        } catch (err) {
          return h.response({
            response_type: "ephemeral",
            text: `Retry failed: ${errorMessage(err)}`,
          });
        }
      }

      const knownTypes = [
        "general",
        "implementation",
        "runbook",
        "gap-fill",
        "review",
        "feature-request",
      ];
      let taskType = "general";
      let description = words.join(" ");

      if (words.length > 1 && knownTypes.includes(words[0])) {
        taskType = words[0];
        description = words.slice(1).join(" ");
      }

      const targetRepo = await repoForSlackChannel(getPool(), channelId);

      if (!targetRepo) {
        return h.response({
          response_type: "ephemeral",
          text: "No repo mapped to this channel. Set `slack_channel_id` in repo settings.",
        });
      }

      const contextBundle = {
        slack_channel_id: channelId,
        slack_user: userName,
      };

      try {
        const taskResult = await createTask(
          description,
          taskType,
          targetRepo,
          `slack:${userName}`,
          contextBundle,
          priority,
        );
        const priorityLabel =
          priority === "immediate" ? " | Priority: `immediate`" : "";

        return h.response({
          response_type: "in_channel",
          text: `Task created on \`${targetRepo}\`:\n> ${description}\n\nType: \`${taskType}\`${priorityLabel} | ID: \`${taskResult.task_id}\`\n${priority === "immediate" ? "Agent will pick this up shortly." : "Task in backlog — claim locally or use the UI to run now."}`,
        });
      } catch (err) {
        return h.response({
          response_type: "ephemeral",
          text: `Failed to create task: ${errorMessage(err)}`,
        });
      }
    },
  };
}
