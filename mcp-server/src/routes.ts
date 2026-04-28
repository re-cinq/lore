/**
 * HTTP API route handlers — extracted from index.ts to keep the
 * god file manageable. Each handler is a standalone function that
 * receives (req, res, pool) and owns its own auth/validation.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { redactSecrets as sanitizeContent, parseTasks, inferPhaseDependencies } from "@re-cinq/lore-shared";
import { getHealthStatus, isDbAvailable, getQueryEmbedding } from "./db.js";
import { isMemoryDbAvailable, writeMemory, readMemory, deleteMemory, listMemories } from "./memory.js";
import { writeMemoryFile, readMemoryFile, deleteMemoryFile, listMemoriesFile, searchMemoryFile } from "./memory-file.js";
import { searchMemories } from "./memory-search.js";
import { extractFactsFromEpisode } from "./facts.js";
import { extractAndUpdateGraph } from "./graph.js";
import { assembleContext } from "./context-assembly.js";
import { createTask, getTask, listTasks } from "./pipeline.js";
import { syncTasksToDb } from "./tasks.js";
import { getTaskTypes } from "./pipeline-config.js";
import { onboardRepo } from "./repo-onboard.js";
import { ingestFiles } from "./ingest.js";
import { resolveAgentId } from "./agent-id.js";
import { getGitHubToken, getOctokit } from "./github-client.js";
import {
  parseDarkFactorySettings,
  resolveSettings,
  twoKeyFieldsTouched,
  type DarkFactorySettings,
} from "./dark-factory-settings.js";
import { verifyApproval, TwoKeyError } from "./dark-factory-authz.js";

// ── Rate limiter (in-memory sliding window) ─────────────────────────

type RateBucket = "webhook" | "task" | "default";

const RATE_LIMITS: Record<RateBucket, number> = {
  webhook: 30,   // 30/min for webhooks
  task: 60,      // 60/min for task operations
  default: 200,  // 200/min for everything else
};

const windows = new Map<string, number[]>();

function rateLimit(bucket: RateBucket): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const key = bucket;
  let timestamps = windows.get(key);
  if (!timestamps) { timestamps = []; windows.set(key, timestamps); }
  // Evict old entries
  while (timestamps.length > 0 && timestamps[0] <= now - windowMs) timestamps.shift();
  if (timestamps.length >= RATE_LIMITS[bucket]) return false;
  timestamps.push(now);
  return true;
}

// ── Helpers ─────────────────────────────────────────────────────────

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

// ── Per-client token auth ───────────────────────────────────────────

type TokenScope = "read" | "write" | "task" | "webhook" | "admin";

const ROUTE_SCOPES: Record<string, TokenScope> = {
  "/api/tasks": "read",
  "/api/task/": "read",
  "/api/context": "read",
  "/api/repo-status": "read",
  "/api/memory": "write",
  "/api/episode": "write",
  "/api/session-summary": "write",
  "/api/task": "task",
  "/api/ingest": "write",
  "/api/onboard": "admin",
  "/api/task-logs": "write",
  "/api/webhook/github": "webhook",
  "/api/webhook/slack": "webhook",
  "/api/webhook/incident": "webhook",
  "/api/tokens": "admin",
  "/api/repos/": "admin", // dark-factory settings endpoints (FR3.9)
};

function getRequiredScope(url: string): TokenScope {
  for (const [prefix, scope] of Object.entries(ROUTE_SCOPES)) {
    if (url.startsWith(prefix)) return scope;
  }
  return "read";
}

/**
 * Validate a per-client token against the DB.
 * Returns the scopes if valid, null if invalid.
 * Falls back to LORE_INGEST_TOKEN (full access) for backward compatibility.
 */
async function validateClientToken(
  pool: Pool | null,
  bearerToken: string,
  requiredScope: TokenScope,
): Promise<boolean> {
  // Legacy single-token: full access
  const legacyToken = process.env.LORE_INGEST_TOKEN;
  if (legacyToken && bearerToken === legacyToken) return true;

  // Per-client token: check DB
  if (!pool) return false;
  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");
  try {
    const { rows } = await pool.query(
      `UPDATE pipeline.api_tokens SET last_used = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING scopes`,
      [tokenHash],
    );
    if (rows.length === 0) return false;
    const scopes: string[] = rows[0].scopes;
    // admin scope grants everything
    if (scopes.includes("admin")) return true;
    return scopes.includes(requiredScope);
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
  });
}

/** Build a graph LLM call function for extractAndUpdateGraph. */
function makeGraphLlmCall(pool: Pool | null): ((prompt: string) => Promise<string>) | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;
  const model = process.env.LORE_GRAPH_MODEL || "claude-haiku-4-5-20251001";
  return async (prompt: string) => {
    const start = Date.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    });
    const result = await res.json() as any;
    const durationMs = Date.now() - start;
    if (result.usage && pool) {
      const costUsd = result.usage.input_tokens * 0.8 / 1_000_000 + result.usage.output_tokens * 4.0 / 1_000_000;
      pool.query(
        `INSERT INTO pipeline.llm_calls (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms) VALUES (NULL, 'graph-extraction', $1, $2, $3, $4, $5)`,
        [model, result.usage.input_tokens, result.usage.output_tokens, costUsd, durationMs],
      ).catch(() => {});
    }
    return result.content[0].text;
  };
}

// ── GitHub helpers (used by webhook route) ───────────────────────────

async function ghIssueComment(repo: string, issueNumber: number, body: string): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;
  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json" },
    body: JSON.stringify({ body }),
  });
}

async function ghAddLabel(repo: string, issueNumber: number, label: string): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;
  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json" },
    body: JSON.stringify({ labels: [label] }),
  });
}

// ── Route handlers ──────────────────────────────────────────────────

async function handleHealthz(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const health = await getHealthStatus();
  const status = health.connected || !process.env.LORE_DB_HOST ? "ok" : "error";
  const code = status === "error" ? 503 : 200;
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  const isAuthed = bearer ? await validateClientToken(pool, bearer, "read") : false;
  if (isAuthed) {
    let tasks = { processed_today: 0, pending: 0 };
    if (health.connected && pool) {
      try {
        const taskStats = await pool.query(`SELECT count(*) FILTER (WHERE created_at > current_date)::int as today, count(*) FILTER (WHERE status = 'pending')::int as pending FROM pipeline.tasks`);
        tasks = { processed_today: taskStats.rows[0]?.today || 0, pending: taskStats.rows[0]?.pending || 0 };
      } catch { /* non-fatal */ }
    }
    json(res, code, { status, database: health, tasks });
  } else {
    json(res, code, { status });
  }
}

async function handleRepoStatus(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const repo = url.searchParams.get("repo");
  console.log(`[repo-status] repo=${repo} dbPoolRef=${!!pool}`);
  if (!repo || !pool) {
    json(res, 200, { onboarded: false });
    return;
  }
  try {
    const repoRow = await pool.query(`SELECT settings, last_ingested_at FROM lore.repos WHERE full_name = $1`, [repo]);
    if (repoRow.rows.length === 0) {
      json(res, 200, { onboarded: false, repo });
      return;
    }
    const settings = repoRow.rows[0].settings || {};
    const lastIngested = repoRow.rows[0].last_ingested_at || null;
    const running = await pool.query(
      `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status = 'running'`, [repo],
    );
    const prReady = await pool.query(
      `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status IN ('pr-created', 'review')`, [repo],
    );
    const memories = await pool.query(`SELECT count(*) as c FROM memory.memories WHERE is_deleted = false`);
    const stale = !lastIngested || (Date.now() - new Date(lastIngested).getTime() > 7 * 86400000);
    json(res, 200, {
      onboarded: true, repo,
      running: Number(running.rows[0]?.c || 0),
      pr_ready: Number(prReady.rows[0]?.c || 0),
      memories: Number(memories.rows[0]?.c || 0),
      auto_review: settings.auto_review === true,
      last_ingested_at: lastIngested,
      stale,
    });
  } catch (err: any) {
    console.error("[repo-status] Error:", err.message);
    json(res, 200, { onboarded: false, error: err.message });
  }
}

async function handleIngest(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const { files, repo, commit } = JSON.parse(body);
    if (!Array.isArray(files) || !repo) {
      json(res, 400, { error: "required: files (array of paths or {path,content}), repo (string)" });
      return;
    }
    const result = await ingestFiles(pool, files, repo, commit || "HEAD");
    json(res, 200, result);
  } catch (err: any) {
    console.error("[ingest] API error:", err.message);
    json(res, 500, { error: err.message });
  }
}

async function handleOnboard(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const { repo } = JSON.parse(body);
    if (!repo || !repo.includes("/")) {
      json(res, 400, { error: "required: repo (owner/name format)" });
      return;
    }
    const result = await onboardRepo(pool, repo);
    json(res, 200, result);
  } catch (err: any) {
    console.error("[onboard] API error:", err.message);
    json(res, 500, { error: err.message });
  }
}

async function handleContext(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const repo = url.searchParams.get("repo");
  const query = url.searchParams.get("query");
  const template = url.searchParams.get("template") || "default";
  try {
    if (query && pool) {
      const result = await assembleContext(pool, query, template, 8000, repo || undefined);
      json(res, 200, { text: result.text || null, sections: result.sections });
    } else {
      const parts: string[] = [];
      if (repo && pool) {
        const { rows } = await pool.query(
          `SELECT content, content_type, file_path FROM org_shared.chunks
           WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
           ORDER BY content_type, ingested_at DESC`,
          [repo],
        );
        for (const r of rows) parts.push(r.content);
      }
      json(res, 200, { text: parts.length > 0 ? parts.join("\n\n---\n\n") : null });
    }
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

async function handleGetTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const taskId = req.url!.replace("/api/task/", "");
  try {
    const task = await getTask(taskId);
    if (!task) { json(res, 404, { error: "not found" }); return; }
    json(res, 200, task);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

async function handleListTasks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, `http://localhost`);
  const status = url.searchParams.get("status") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  try {
    const result = await listTasks(status, limit);
    json(res, 200, result);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

async function handleTaskPost(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const parsed = JSON.parse(body);

    // Retry action
    if (parsed.action === "retry" && parsed.task_id) {
      const { retryTask } = await import('./pipeline.js');
      const retryResult = await retryTask(parsed.task_id);
      json(res, 200, retryResult);
      return;
    }

    // Cancel action
    if (parsed.action === "cancel" && parsed.task_id) {
      await pool.query(
        `UPDATE pipeline.tasks SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled', 'merged')`,
        [parsed.task_id],
      );
      json(res, 200, { ok: true, task_id: parsed.task_id });
      return;
    }

    // Set priority action
    if (parsed.action === "set-priority" && parsed.task_id && parsed.priority) {
      const resolvedPriority = parsed.priority === "immediate" ? "immediate" : "normal";
      await pool.query(
        `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2 AND status = 'pending'`,
        [resolvedPriority, parsed.task_id],
      );
      json(res, 200, { ok: true, task_id: parsed.task_id, priority: resolvedPriority });
      return;
    }

    // Status update from local runner (no action field, has task_id + status)
    if (!parsed.action && parsed.task_id && parsed.status) {
      const allowedStatuses = ["running", "pr-created", "completed", "failed", "needs-human-help", "cancelled"];
      if (!allowedStatuses.includes(parsed.status)) {
        json(res, 400, { error: `invalid status: ${parsed.status}` });
        return;
      }
      const setClauses = ["status = $1", "updated_at = now()"];
      const values: unknown[] = [parsed.status];
      if (parsed.pr_url) { setClauses.push(`pr_url = $${values.length + 1}`); values.push(parsed.pr_url); }
      if (parsed.error) { setClauses.push(`error = $${values.length + 1}`); values.push(parsed.error); }
      values.push(parsed.task_id);
      await pool.query(
        `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
        values,
      );
      json(res, 200, { ok: true, task_id: parsed.task_id, status: parsed.status });
      return;
    }

    // Create action (default)
    const { description, task_type, target_repo, priority, context } = parsed;
    if (!description?.trim()) {
      json(res, 400, { error: "description is required" });
      return;
    }
    const validTypes = getTaskTypes();
    const resolvedType = validTypes.includes(task_type || "") ? task_type : "general";
    const result = await createTask(description, resolvedType, target_repo, "remote-mcp", context || undefined, priority || "normal");
    json(res, 200, result);
  } catch (err: any) {
    console.error("[api/task] error:", err.message);
    json(res, 500, { error: err.message });
  }
}

async function handleMemory(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { action, key, value, agent_id, ttl, query: searchQuery, limit, version, pool_name, repo } = JSON.parse(body);
    let result: any;
    const embedding = (action === "write" || action === "search") && (value || searchQuery) ? await getQueryEmbedding(value || searchQuery || "") : null;

    switch (action) {
      case "write":
        if (!key || !value) { json(res, 400, { error: "key and value required" }); return; }
        result = isMemoryDbAvailable()
          ? await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo)
          : await writeMemoryFile(key, value, agent_id, ttl);
        break;
      case "read":
        if (!key) { json(res, 400, { error: "key required" }); return; }
        result = isMemoryDbAvailable()
          ? await readMemory(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined)
          : await readMemoryFile(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined);
        break;
      case "search":
        if (!searchQuery) { json(res, 400, { error: "query required" }); return; }
        result = isMemoryDbAvailable()
          ? await searchMemories(pool!, searchQuery, agent_id, pool_name, limit || 10)
          : await searchMemoryFile(searchQuery, agent_id, limit || 10);
        break;
      case "delete":
        if (!key) { json(res, 400, { error: "key required" }); return; }
        result = isMemoryDbAvailable()
          ? await deleteMemory(key, agent_id)
          : await deleteMemoryFile(key, agent_id);
        break;
      case "list":
        result = isMemoryDbAvailable()
          ? await listMemories(agent_id, limit || 50, 0)
          : await listMemoriesFile(agent_id, limit || 50, 0);
        break;
      default:
        json(res, 400, { error: "action must be: write, read, search, delete, list" });
        return;
    }
    json(res, 200, result);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

async function handleEpisode(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { content, source, ref, agent_id } = JSON.parse(body);
    if (!content) { json(res, 400, { error: "content required" }); return; }
    const agent = agent_id || 'unknown';
    const safeContent = sanitizeContent(content);
    const contentHash = createHash("sha256").update(safeContent).digest("hex");
    const { rows } = await pool!.query(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [agent, safeContent, contentHash, source || 'session', ref || null],
    );
    if (rows.length === 0) {
      json(res, 200, { status: "duplicate" });
      return;
    }
    extractFactsFromEpisode(rows[0].id, safeContent, agent, pool!).catch(() => {});
    const gLlm = makeGraphLlmCall(pool);
    if (gLlm) extractAndUpdateGraph(pool!, safeContent, ref || null, rows[0].id, null, gLlm).catch(() => {});
    json(res, 200, { status: "ok", episode_id: rows[0].id });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

async function handleSessionSummary(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { session_log, repo, agent_id } = JSON.parse(body);
    if (!session_log) { json(res, 400, { error: "required: session_log" }); return; }

    const summary = typeof session_log === "string"
      ? session_log
      : (session_log.summary || JSON.stringify(session_log));

    if (!summary || summary.length < 10) {
      json(res, 200, { status: "skipped", reason: "empty session" });
      return;
    }

    const content = `Session in ${repo || "unknown"}\n\n${summary}`;
    const agent = agent_id || "session-hook";
    const contentHash = createHash("sha256").update(content).digest("hex");

    if (!pool) { json(res, 503, { error: "database not available" }); return; }

    const { rows } = await pool.query(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, 'session', $4)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [agent, content, contentHash, repo || null],
    );

    if (rows.length === 0) {
      json(res, 200, { status: "duplicate" });
      return;
    }

    extractFactsFromEpisode(rows[0].id, content, agent, pool).catch(() => {});
    const gLlm = makeGraphLlmCall(pool);
    if (gLlm) extractAndUpdateGraph(pool, content, repo || null, rows[0].id, null, gLlm).catch(() => {});
    json(res, 200, { status: "ok", episode_id: rows[0].id });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

// ── Spec PR merge → auto-create spec-tasks ────────────────────────

async function readFileFromGitHub(repo: string, path: string, ref: string): Promise<string | null> {
  const token = await getGitHubToken();
  if (!token) return null;
  const [owner, repoName] = repo.split("/");
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
      },
    },
  );
  if (!response.ok) return null;
  return response.text();
}

async function handleSpecPRMerge(payload: any, pool: Pool | null, res: ServerResponse): Promise<void> {
  if (payload.action !== "closed" || !payload.pull_request?.merged) {
    json(res, 200, { skipped: true, reason: "not a merged PR" });
    return;
  }
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
 * Forward a review-reactor trigger to the agent service. Fire-and-forget:
 * the agent returns 202 before running the LLM, so this won't block the
 * webhook response. Safe to await briefly for the 202 itself.
 */
async function triggerAgentReviewReactor(repo: string, prNumber: number): Promise<void> {
  const agentUrl = process.env.LORE_AGENT_URL;
  const token = process.env.LORE_AGENT_INTERNAL_TOKEN;
  if (!agentUrl || !token) {
    console.warn("[webhook] LORE_AGENT_URL or LORE_AGENT_INTERNAL_TOKEN not set — skipping review-reactor trigger");
    return;
  }
  try {
    await fetch(`${agentUrl.replace(/\/+$/, "")}/api/trigger/review-reactor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ repo, pr_number: prNumber }),
    });
  } catch (err: any) {
    console.warn("[webhook] review-reactor trigger failed:", err.message);
  }
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
  triggerAgentReviewReactor(repo, prNumber).catch(() => {});
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
  triggerAgentReviewReactor(repo, prNumber).catch(() => {});
  json(res, 200, { triggered: "review-reactor", repo, pr_number: prNumber, via: "pull_request_review" });
}

async function handleGitHubWebhook(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const webhookSecret = process.env.LORE_WEBHOOK_SECRET;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const ghEvent = req.headers["x-github-event"] as string | undefined;
  const rawBody = await readBody(req);

  if (!webhookSecret) { json(res, 503, { error: "webhook secret not configured" }); return; }
  if (!signature) { json(res, 401, { error: "missing signature" }); return; }

  const expected = "sha256=" + createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
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
        triggerAgentReviewReactor(repo, prNumber).catch(() => {});
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

async function handleSlackWebhook(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const rawBody = await readBody(req);
  const slackSecret = process.env.LORE_SLACK_SIGNING_SECRET;
  if (!slackSecret) { res.writeHead(503).end("Slack signing secret not configured"); return; }

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSig = req.headers["x-slack-signature"] as string;
  if (!timestamp || !slackSig) { res.writeHead(401).end("Unauthorized"); return; }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) { res.writeHead(401).end("Request too old"); return; }

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + createHmac("sha256", slackSecret).update(sigBase).digest("hex");
  const sigBuf = Buffer.from(slackSig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
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
      const { retryTask } = await import('./pipeline.js');
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

  if (!pool) { json(res, 503, { error: "database not available" }); return; }

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

async function handleTaskLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  try {
    const { task_id, repo, logs } = JSON.parse(body);
    if (!task_id || !repo || !logs) { json(res, 400, { error: "missing fields" }); return; }
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
    await bucket.file(`${repo}/${task_id}/output.log`).save(logs, { resumable: false, contentType: "text/plain" });
    json(res, 200, { ok: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

async function handleGetTaskLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const taskId = url.searchParams.get("task_id");
  const repo = url.searchParams.get("repo");
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  if (!taskId || !repo) { json(res, 400, { error: "required: task_id, repo" }); return; }
  try {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
    const file = bucket.file(`${repo}/${taskId}/output.log`);
    const [exists] = await file.exists();
    if (!exists) { json(res, 200, { logs: "", next_offset: 0, complete: true }); return; }
    const [content] = await file.download();
    const full = content.toString("utf-8");
    const sliced = full.substring(offset);
    json(res, 200, { logs: sliced, next_offset: full.length, complete: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

async function handleIncidentWebhook(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
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

async function handleTokens(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const method = req.method || "";

  if (method === "GET") {
    // List active tokens (never return the actual token)
    const { rows } = await pool.query(
      `SELECT id, name, scopes, created_by, expires_at, last_used, created_at
       FROM pipeline.api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC`,
    );
    json(res, 200, { tokens: rows });
    return;
  }

  if (method === "POST") {
    const body = await readBody(req);
    try {
      const { action, name, scopes, expires_in_days, token_id } = JSON.parse(body);

      if (action === "revoke" && token_id) {
        await pool.query(`UPDATE pipeline.api_tokens SET revoked_at = now() WHERE id = $1`, [token_id]);
        json(res, 200, { ok: true });
        return;
      }

      // Create new token
      if (!name) { json(res, 400, { error: "name required" }); return; }
      const { randomBytes } = await import("node:crypto");
      const rawToken = `lore_${randomBytes(32).toString("hex")}`;
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const validScopes: TokenScope[] = ["read", "write", "task", "webhook", "admin"];
      const resolvedScopes = (scopes || ["read"]).filter((s: string) => validScopes.includes(s as TokenScope));
      const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 86400000).toISOString() : null;

      const { rows } = await pool.query(
        `INSERT INTO pipeline.api_tokens (name, token_hash, scopes, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, scopes, created_at`,
        [name, tokenHash, resolvedScopes, "admin", expiresAt],
      );
      // Return the raw token ONCE — it cannot be retrieved again
      json(res, 201, { ...rows[0], token: rawToken, expires_at: expiresAt });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return;
  }

  json(res, 405, { error: "method not allowed" });
}

// ── Main router ─────────────────────────────────────────────────────

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "";

  // Rate limiting (healthz is exempt)
  if (url !== "/healthz") {
    const bucket: RateBucket = url.startsWith("/api/webhook/") ? "webhook"
      : (url === "/api/task" || url.startsWith("/api/task/") || url.startsWith("/api/tasks")) ? "task"
      : "default";
    if (!rateLimit(bucket)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" })
        .end(JSON.stringify({ error: "rate limit exceeded" }));
      return true;
    }
  }

  // Centralized auth — webhooks have their own HMAC auth, healthz is public
  const authExempt = url === "/healthz" || url.startsWith("/api/webhook/");
  if (!authExempt) {
    const bearer = req.headers.authorization?.replace("Bearer ", "");
    if (!bearer) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const scope = getRequiredScope(url);
    const valid = await validateClientToken(pool, bearer, scope);
    if (!valid) {
      json(res, 403, { error: "insufficient scope" });
      return true;
    }
  }

  if (url === "/healthz") {
    await handleHealthz(req, res, pool);
  } else if (url.startsWith("/api/repo-status") && method === "GET") {
    await handleRepoStatus(req, res, pool);
  } else if (url === "/api/ingest" && method === "POST") {
    await handleIngest(req, res, pool);
  } else if (url === "/api/onboard" && method === "POST") {
    await handleOnboard(req, res, pool);
  } else if (url.startsWith("/api/context") && method === "GET") {
    await handleContext(req, res, pool);
  } else if (url.startsWith("/api/task/") && method === "GET") {
    await handleGetTask(req, res);
  } else if (url.startsWith("/api/tasks") && method === "GET") {
    await handleListTasks(req, res);
  } else if (url === "/api/task" && method === "POST") {
    await handleTaskPost(req, res, pool);
  } else if (url === "/api/memory" && method === "POST") {
    await handleMemory(req, res, pool);
  } else if (url === "/api/episode" && method === "POST") {
    await handleEpisode(req, res, pool);
  } else if (url === "/api/session-summary" && method === "POST") {
    await handleSessionSummary(req, res, pool);
  } else if (url === "/api/webhook/github" && method === "POST") {
    await handleGitHubWebhook(req, res, pool);
  } else if (url === "/api/webhook/slack" && method === "POST") {
    await handleSlackWebhook(req, res, pool);
  } else if (url === "/api/task-logs" && method === "POST") {
    await handleTaskLogs(req, res);
  } else if (url.startsWith("/api/task-logs") && method === "GET") {
    await handleGetTaskLogs(req, res);
  } else if (url === "/api/webhook/incident" && method === "POST") {
    await handleIncidentWebhook(req, res, pool);
  } else if (url === "/api/tokens") {
    await handleTokens(req, res, pool);
  } else if (
    /^\/api\/repos\/[^/]+\/[^/]+\/settings\/dark-factory(\?|$)/.test(url)
  ) {
    await handleDarkFactorySettingsRoute(req, res, pool);
  } else {
    return false; // not handled
  }
  return true;
}

// ── Dark factory settings (T018, T017) ──────────────────────────────

const DARK_FACTORY_PATH_RE =
  /^\/api\/repos\/([^/]+)\/([^/]+)\/settings\/dark-factory/;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let len = 0;
    req.on("data", (chunk: Buffer) => {
      len += chunk.length;
      if (len > 1_048_576) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      buf += chunk.toString("utf-8");
    });
    req.on("end", () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function handleDarkFactorySettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  if (!pool) {
    json(res, 503, { error: "database unavailable" });
    return;
  }
  const m = (req.url || "").match(DARK_FACTORY_PATH_RE);
  if (!m) {
    json(res, 404, { error: "not found" });
    return;
  }
  const owner = decodeURIComponent(m[1]);
  const repoName = decodeURIComponent(m[2]);
  const repo = `${owner}/${repoName}`;
  const method = req.method || "";

  if (method === "GET") {
    await handleGetDarkFactorySettings(repo, res, pool);
    return;
  }
  if (method === "PUT") {
    await handlePutDarkFactorySettings(req, res, pool, repo);
    return;
  }
  json(res, 405, { error: "method not allowed" });
}

async function handleGetDarkFactorySettings(
  repo: string,
  res: ServerResponse,
  pool: Pool,
): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [repo],
    );
    if (rows.length === 0) {
      json(res, 404, { error: "repo not onboarded", repo });
      return;
    }
    const partial = (rows[0].settings?.dark_factory ?? null) as
      | DarkFactorySettings
      | null;
    json(res, 200, resolveSettings(partial));
  } catch (err) {
    console.error("[dark-factory] GET settings failed:", err);
    json(res, 500, { error: "internal" });
  }
}

async function handlePutDarkFactorySettings(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool,
  repo: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(res, 400, {
      error: "invalid_body",
      detail: (err as Error).message,
    });
    return;
  }

  let patch: DarkFactorySettings;
  try {
    patch = parseDarkFactorySettings(body);
  } catch (err) {
    const issues =
      typeof err === "object" && err !== null && "issues" in err
        ? (err as { issues: unknown }).issues
        : (err as Error).message;
    json(res, 400, { error: "invalid_settings", issues });
    return;
  }

  // Two-key check (FR3.9): privileged fields require an approval-PR header.
  const twoKey = twoKeyFieldsTouched(patch);
  let ceremony: { tier: "two_key" | "admin"; pr_ref?: string; approver?: string; pr_url?: string } = { tier: "admin" };
  if (twoKey.length > 0) {
    const prRef = req.headers["x-lore-approval-pr"];
    if (typeof prRef !== "string" || !prRef) {
      json(res, 403, {
        error: "two_key_required",
        field_paths: twoKey,
        detail:
          "Privileged fields require an X-Lore-Approval-PR header. " +
          "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.",
      });
      return;
    }
    try {
      const octokit = await getOctokit();
      const evidence = await verifyApproval({
        octokit,
        prRef,
        targetRepo: repo,
      });
      ceremony = {
        tier: "two_key",
        pr_ref: evidence.prRef,
        approver: evidence.approver,
        pr_url: evidence.prUrl,
      };
    } catch (err) {
      if (err instanceof TwoKeyError) {
        json(res, 403, {
          error: "codeowners_check_failed",
          code: err.code,
          detail: err.message,
        });
        return;
      }
      console.error("[dark-factory] Two-key verify failed:", err);
      json(res, 503, { error: "github_api_unavailable" });
      return;
    }
  }

  // Read current, merge patch, write back. lore.repos.settings is JSONB.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT settings FROM lore.repos WHERE full_name = $1 FOR UPDATE`,
      [repo],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      json(res, 404, { error: "repo not onboarded", repo });
      return;
    }
    const settings = rows[0].settings ?? {};
    const prev = settings.dark_factory ?? {};
    const next = { ...prev, ...patch };
    if (patch.auto_merge) {
      next.auto_merge = { ...(prev.auto_merge ?? {}), ...patch.auto_merge };
    }
    settings.dark_factory = next;

    await client.query(
      `UPDATE lore.repos SET settings = $1 WHERE full_name = $2`,
      [settings, repo],
    );

    // Audit log entry per FR3.9.
    const auditPayload = {
      field_paths_changed: Object.keys(patch),
      two_key_fields: twoKey,
      prev: prev,
      next: next,
      ceremony,
    };
    await client
      .query(
        `INSERT INTO pipeline.audit_log (event_type, repo, payload)
         VALUES ('dark_factory_setting_changed', $1, $2)`,
        [repo, JSON.stringify(auditPayload)],
      )
      .catch(() => {
        // Audit log is best-effort; do not block the settings update.
      });

    await client.query("COMMIT");
    json(res, 200, {
      ok: true,
      applied: next,
      ceremony,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[dark-factory] PUT settings failed:", err);
    json(res, 500, { error: "internal" });
  } finally {
    client.release();
  }
}
