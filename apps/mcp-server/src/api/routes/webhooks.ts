/**
 * Slack + incident webhooks. The GitHub webhook moved to the Floor (it now ingests
 * directly into the pipeline.events table and the Floor event loop dispatches) —
 * mcp-server no longer receives or forwards GitHub events.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createTask } from "../../features/pipeline/pipeline.js";
import { json, readBody } from "./http.js";

// ── Signature verification (pure) ───────────────────────────────────

/** Constant-time HMAC compare for the Slack `v0=…` signature. */
export function verifySlackSignature(secret: string, timestamp: string, signature: string, rawBody: string): boolean {
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

export async function handleSlackWebhook(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const rawBody = await readBody(req);
  const slackSecret = process.env.LORE_SLACK_SIGNING_SECRET;
  if (!slackSecret) { res.writeHead(503).end("Slack signing secret not configured"); return; }

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSig = req.headers["x-slack-signature"] as string;
  if (!timestamp || !slackSig) { res.writeHead(401).end("Unauthorized"); return; }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) { res.writeHead(401).end("Request too old"); return; }

  if (!verifySlackSignature(slackSecret, timestamp, slackSig, rawBody)) {
    res.writeHead(401).end("Invalid signature");
    return;
  }

  const params = new URLSearchParams(rawBody);

  if (params.get("type") === "url_verification") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end(params.get("challenge") || "");
    return;
  }

  const commandText = (params.get("text") || "").trim();
  const channelId = params.get("channel_id") || "";
  const userName = params.get("user_name") || "unknown";

  if (!commandText) {
    json(res, 200, {
      response_type: "ephemeral",
      text: "Usage: `/lore [task_type] <description>`\nTask types: general, implementation, runbook, gap-fill, review\n\nPrefix with `!` to execute immediately: `/lore ! implementation add caching`\nRetry a failed task: `/lore retry <task_id>`",
    });
    return;
  }

  let words = commandText.split(/\s+/);
  let priority = "normal";
  if (words[0] === "!") { priority = "immediate"; words = words.slice(1); }

  if (words[0] === "retry" && words[1]) {
    const retryTaskId = words[1];
    try {
      const { retryTask } = await import('../../features/pipeline/pipeline.js');
      const retryResult = await retryTask(retryTaskId);
      json(res, 200, { response_type: "in_channel", text: `Retrying task \`${retryTaskId}\`\nNew task: \`${retryResult.task_id}\`` });
    } catch (err: any) {
      json(res, 200, { response_type: "ephemeral", text: `Retry failed: ${err.message}` });
    }
    return;
  }

  const knownTypes = ["general", "implementation", "runbook", "gap-fill", "review", "feature-request"];
  let taskType = "general";
  let description = words.join(" ");
  if (words.length > 1 && knownTypes.includes(words[0])) {
    taskType = words[0];
    description = words.slice(1).join(" ");
  }

  let targetRepo = "";
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT full_name FROM lore.repos WHERE settings->>'slack_channel_id' = $1`, [channelId],
      );
      if (rows.length > 0) targetRepo = rows[0].full_name;
    } catch { /* fall through */ }
  }

  if (!targetRepo) {
    json(res, 200, { response_type: "ephemeral", text: "No repo mapped to this channel. Set `slack_channel_id` in repo settings." });
    return;
  }

  // A truthy targetRepo can only come from the pool lookup above, so pool is
  // non-null here.
  const contextBundle = { slack_channel_id: channelId, slack_user: userName };
  try {
    const taskResult = await createTask(description, taskType, targetRepo, `slack:${userName}`, contextBundle, priority);
    const priorityLabel = priority === "immediate" ? " | Priority: `immediate`" : "";
    json(res, 200, {
      response_type: "in_channel",
      text: `Task created on \`${targetRepo}\`:\n> ${description}\n\nType: \`${taskType}\`${priorityLabel} | ID: \`${taskResult.task_id}\`\n${priority === "immediate" ? "Agent will pick this up shortly." : "Task in backlog — claim locally or use the UI to run now."}`,
    });
  } catch (err: any) {
    json(res, 200, { response_type: "ephemeral", text: `Failed to create task: ${err.message}` });
  }
}

export async function handleIncidentWebhook(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const payload = JSON.parse(body);
    // Accept both direct format and PagerDuty/Opsgenie envelope
    const incident = payload.incident || payload;
    const repoName = incident.repo || incident.service?.name;
    if (!repoName) { json(res, 400, { error: "required: repo (or incident.repo)" }); return; }

    const entry = {
      title: incident.title || incident.summary || "Unknown incident",
      severity: incident.severity || incident.urgency || "unknown",
      date: incident.date || new Date().toISOString(),
      resolved: incident.resolved || incident.status === "resolved" || false,
      url: incident.url || incident.html_url || null,
    };

    // Upsert into lore.repos.settings.incidents (max 10, FIFO)
    await pool.query(
      `UPDATE lore.repos
       SET settings = jsonb_set(
         COALESCE(settings, '{}'),
         '{incidents}',
         (SELECT jsonb_agg(elem) FROM (
           SELECT elem FROM jsonb_array_elements(
             COALESCE(settings->'incidents', '[]') || $2::jsonb
           ) AS elem
           ORDER BY elem->>'date' DESC
           LIMIT 10
         ) sub)
       )
       WHERE full_name = $1`,
      [repoName, JSON.stringify(entry)],
    );
    json(res, 200, { ok: true, repo: repoName });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
