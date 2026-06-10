import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseTasks, inferPhaseDependencies } from "@re-cinq/lore-shared";
import { createTask } from "../../features/pipeline/pipeline.js";
import { syncTasksToDb } from "../../features/pipeline/tasks.js";
import { json, readBody } from "./http.js";
import {
  ghIssueComment,
  ghAddLabel,
  readFileFromGitHub,
  triggerAgentReviewReactor,
  triggerAgentAutoMerge,
} from "./helpers.js";

// ── Signature verification (pure) ───────────────────────────────────

/** Constant-time HMAC compare for the GitHub `sha256=…` signature header. */
export function verifyGitHubSignature(secret: string, signature: string, rawBody: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

/** Constant-time HMAC compare for the Slack `v0=…` signature. */
export function verifySlackSignature(secret: string, timestamp: string, signature: string, rawBody: string): boolean {
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

// ── Spec PR merge → auto-create spec-tasks ────────────────────────

async function handleSpecPRMerge(payload: any, pool: Pool | null, res: ServerResponse): Promise<void> {
  // Callers gate on action === "closed" && pull_request.merged before
  // dispatching here, so no need to re-check.
  if (!pool) { json(res, 503, { error: "database not available" }); return; }

  const pr = payload.pull_request;
  const repo: string = payload.repository?.full_name;
  const branch: string = pr.head?.ref || "";
  const mergeCommitSha: string = pr.merge_commit_sha;
  const labels: string[] = (pr.labels || []).map((l: any) => l.name);

  // Detect spec PRs by branch pattern + label
  if (!branch.startsWith("lore/feature-request/") || !labels.includes("spec")) {
    json(res, 200, { skipped: true, reason: "not a spec PR" });
    return;
  }

  // Extract spec slug from branch name: lore/feature-request/{slug}-{taskId8}
  const branchSuffix = branch.replace("lore/feature-request/", "");
  const specSlug = branchSuffix.replace(/-[a-f0-9]{8}$/, "");
  if (!specSlug) {
    json(res, 200, { skipped: true, reason: "could not extract spec slug" });
    return;
  }

  // Idempotency: check if spec-tasks already synced
  const { rows: existing } = await pool.query(
    `SELECT id FROM pipeline.tasks
     WHERE task_type = 'spec-task'
       AND target_repo = $1
       AND context_bundle->>'spec_slug' = $2
     LIMIT 1`,
    [repo, specSlug],
  );
  if (existing.length > 0) {
    json(res, 200, { skipped: true, reason: "spec-tasks already synced", spec_slug: specSlug });
    return;
  }

  // Read tasks.md from the merged commit
  const tasksPath = `specs/${specSlug}/tasks.md`;
  const tasksContent = await readFileFromGitHub(repo, tasksPath, mergeCommitSha);
  if (!tasksContent) {
    json(res, 200, { skipped: true, reason: "no tasks.md found", path: tasksPath });
    return;
  }

  // Parse, infer dependencies, sync to DB
  const parsed = parseTasks(tasksContent);
  const withDeps = inferPhaseDependencies(parsed);
  const taskGroupId = crypto.randomUUID();
  const result = await syncTasksToDb(pool, repo, specSlug, withDeps, taskGroupId);

  // Mark the parent feature-request pipeline task as merged
  await pool.query(
    `UPDATE pipeline.tasks SET status = 'merged', updated_at = now()
     WHERE task_type = 'feature-request'
       AND target_repo = $1
       AND target_branch = $2
       AND status IN ('pr-created', 'review')`,
    [repo, branch],
  ).catch(() => {});

  console.log(`[webhook] Spec PR merged: ${repo}/${specSlug} → ${result.created} spec-tasks (group ${taskGroupId})`);
  json(res, 200, {
    ok: true,
    spec_slug: specSlug,
    task_group_id: taskGroupId,
    tasks_synced: result.synced,
    tasks_created: result.created,
  });
}

/**
 * GitHub fires `check_run.completed` per individual check (each CI
 * job, each external service) and `check_suite.completed` per app
 * once all that app's checks finish. We accept both — the trigger is
 * cheap (short-circuits on `dark_factory.enabled = false` and on the
 * "PR not found in pipeline.tasks" lookup) and the auto-merge engine
 * itself defers idempotently when not all checks have completed yet.
 *
 * Resolves the PR number from the head SHA via the payload's
 * `pull_requests` array. GitHub populates this for PRs in the same
 * repo as the head ref; cross-repo PRs (forks) won't carry it, but
 * dark-mode auto-merge is opt-in per repo so this is fine.
 */
async function handleCheckEvent(payload: any, res: ServerResponse): Promise<void> {
  if (payload.action !== "completed") {
    json(res, 200, { skipped: true, reason: "not a completed action", action: payload.action });
    return;
  }
  const repo: string = payload.repository?.full_name;
  const prList: Array<{ number: number }> | undefined =
    payload.check_run?.pull_requests ?? payload.check_suite?.pull_requests;
  if (!repo || !prList || prList.length === 0) {
    json(res, 200, { skipped: true, reason: "no pull_requests in payload" });
    return;
  }
  // A check can be associated with multiple PRs (e.g., the same head
  // SHA appears on more than one PR). Fan out to all of them.
  for (const pr of prList) {
    void triggerAgentAutoMerge(repo, pr.number);
  }
  json(res, 200, {
    triggered: "auto-merge",
    repo,
    pr_numbers: prList.map((p) => p.number),
    via: payload.check_run ? "check_run" : "check_suite",
  });
}

/**
 * pull_request events that should wake the review reactor: new commits
 * pushed (synchronize), or the PR being (re)opened. Closed/edited/etc.
 * are ignored here (spec-PR merge is a separate branch).
 */
async function handlePullRequestReviewTrigger(payload: any, res: ServerResponse): Promise<boolean> {
  const action = payload.action;
  if (!["synchronize", "opened", "reopened", "ready_for_review"].includes(action)) {
    return false;
  }
  const repo: string = payload.repository?.full_name;
  const prNumber: number | undefined = payload.pull_request?.number;
  if (!repo || !prNumber) return false;
  void triggerAgentReviewReactor(repo, prNumber);
  json(res, 200, { triggered: "review-reactor", repo, pr_number: prNumber, via: "pull_request" });
  return true;
}

async function handlePullRequestReviewEvent(payload: any, res: ServerResponse): Promise<void> {
  if (payload.action !== "submitted") {
    json(res, 200, { skipped: true, reason: "not a submitted review" });
    return;
  }
  const repo: string = payload.repository?.full_name;
  const prNumber: number | undefined = payload.pull_request?.number;
  if (!repo || !prNumber) {
    json(res, 400, { error: "missing repo or pr_number" });
    return;
  }
  void triggerAgentReviewReactor(repo, prNumber);
  json(res, 200, { triggered: "review-reactor", repo, pr_number: prNumber, via: "pull_request_review" });
}

export async function handleGitHubWebhook(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const webhookSecret = process.env.LORE_WEBHOOK_SECRET;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const ghEvent = req.headers["x-github-event"] as string | undefined;
  const rawBody = await readBody(req);

  if (!webhookSecret) { json(res, 503, { error: "webhook secret not configured" }); return; }
  if (!signature) { json(res, 401, { error: "missing signature" }); return; }

  if (!verifyGitHubSignature(webhookSecret, signature, rawBody)) {
    json(res, 401, { error: "invalid signature" });
    return;
  }

  if (ghEvent === "pull_request") {
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch {
      json(res, 400, { error: "invalid JSON" });
      return;
    }
    // First: spec-PR merge takes priority (closed + merged action)
    if (payload.action === "closed" && payload.pull_request?.merged) {
      await handleSpecPRMerge(payload, pool, res);
      return;
    }
    // Otherwise try review-reactor trigger (sync/opened/reopened/ready_for_review)
    if (await handlePullRequestReviewTrigger(payload, res)) return;
    json(res, 200, { skipped: true, reason: "no handler for pull_request action", action: payload.action });
    return;
  }

  if (ghEvent === "pull_request_review") {
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch {
      json(res, 400, { error: "invalid JSON" });
      return;
    }
    await handlePullRequestReviewEvent(payload, res);
    // A submitted review (especially APPROVED from the review bot)
    // can flip the auto-merge gate. Piggyback on this event to
    // re-trigger auto-merge alongside the review-reactor.
    if (payload.action === "submitted") {
      const repo: string = payload.repository?.full_name;
      const prNumber: number | undefined = payload.pull_request?.number;
      if (repo && prNumber) {
        void triggerAgentAutoMerge(repo, prNumber);
      }
    }
    return;
  }

  // CI completion → re-evaluate auto-merge for any backing pipeline
  // task. Fires per check (check_run) and per app's full set
  // (check_suite). The agent endpoint resolves PR → task UUID and
  // short-circuits when there's no matching task.
  if (ghEvent === "check_run" || ghEvent === "check_suite") {
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch {
      json(res, 400, { error: "invalid JSON" });
      return;
    }
    await handleCheckEvent(payload, res);
    return;
  }

  if (ghEvent === "issue_comment") {
    // Reviewers often leave feedback as issue comments on PRs. Trigger
    // the reactor when the commented-on item is a PR (has pull_request).
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch {
      json(res, 400, { error: "invalid JSON" });
      return;
    }
    if (payload.action === "created" && payload.issue?.pull_request) {
      const repo: string = payload.repository?.full_name;
      const prNumber: number | undefined = payload.issue?.number;
      if (repo && prNumber) {
        void triggerAgentReviewReactor(repo, prNumber);
        json(res, 200, { triggered: "review-reactor", repo, pr_number: prNumber, via: "issue_comment" });
        return;
      }
    }
    json(res, 200, { skipped: true, reason: "not a PR issue_comment created event" });
    return;
  }

  if (ghEvent !== "issues") {
    json(res, 200, { skipped: true, reason: "not an issues event" });
    return;
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch {
    json(res, 400, { error: "invalid JSON" });
    return;
  }

  if (payload.action !== "labeled") {
    json(res, 200, { skipped: true, reason: "not a labeled action" });
    return;
  }

  const repoFullName: string = payload.repository?.full_name;
  const issue = payload.issue;
  const addedLabel: string = payload.label?.name;
  if (!repoFullName || !issue || !addedLabel) {
    json(res, 400, { error: "missing required fields" });
    return;
  }

  let dispatchLabel = "lore";
  let dispatchDefaultType = "general";
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repoFullName]);
      if (rows.length > 0 && rows[0].settings) {
        const settings = typeof rows[0].settings === "string" ? JSON.parse(rows[0].settings) : rows[0].settings;
        if (settings.dispatch_label) dispatchLabel = settings.dispatch_label;
        if (settings.dispatch_default_type) dispatchDefaultType = settings.dispatch_default_type;
      }
    } catch { /* use defaults */ }
  }

  if (addedLabel !== dispatchLabel) {
    json(res, 200, { skipped: true, reason: "label does not match dispatch_label" });
    return;
  }

  if (!pool) { json(res, 503, { error: "database not available" }); return; }

  const issueNumber: number = issue.number;
  const issueTitle: string = issue.title || "";
  const issueBody: string = issue.body || "";
  const issueUrl: string = issue.html_url || "";
  const issueLabels: string[] = (issue.labels || []).map((l: any) => l.name as string);

  let taskType = dispatchDefaultType;
  if (issueLabels.includes("lore:implementation")) taskType = "implementation";
  else if (issueLabels.includes("lore:review")) taskType = "review";
  else if (issueLabels.includes("lore:runbook")) taskType = "runbook";

  // Duplicate prevention
  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM pipeline.tasks WHERE issue_number = $1 AND target_repo = $2 AND status NOT IN ('failed', 'cancelled')`,
      [issueNumber, repoFullName],
    );
    if (existing.length > 0) {
      const existingId = existing[0].id;
      await ghIssueComment(repoFullName, issueNumber, `Already being worked on: task \`${existingId}\``);
      json(res, 200, { skipped: true, reason: "duplicate", task_id: existingId });
      return;
    }
  } catch (err: any) {
    console.error("[webhook] duplicate check error:", err.message);
  }

  const description = `${issueTitle}\n\n${issueBody}`.trim();
  const contextBundle = {
    github_issue_number: issueNumber,
    github_issue_url: issueUrl,
    github_issue_body: issueBody,
  };

  let taskResult: any;
  try {
    taskResult = await createTask(description, taskType, repoFullName, "github-webhook", contextBundle);
    await pool.query(
      `UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`,
      [issueNumber, issueUrl, taskResult.task_id],
    );
  } catch (err: any) {
    console.error("[webhook] createTask error:", err.message);
    json(res, 500, { error: err.message });
    return;
  }

  await Promise.allSettled([
    ghIssueComment(repoFullName, issueNumber, `Lore agent is working on this. Task: \`${taskResult.task_id}\``),
    ghAddLabel(repoFullName, issueNumber, "lore-managed"),
  ]);

  json(res, 200, { task_id: taskResult.task_id, status: taskResult.status });
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
