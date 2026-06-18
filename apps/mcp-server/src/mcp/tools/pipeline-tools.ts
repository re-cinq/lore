import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTask,
  getTask,
  listTasks,
  cancelTask,
} from "../../features/pipeline/pipeline.js";
import { getTaskTypes } from "../../features/pipeline/pipeline-config.js";
import {
  parseTasks,
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from "../../features/pipeline/tasks.js";
import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { resolveAgentId } from "../../platform/agent-id.js";
import { ToolDeps, withReadCache, unreachableError, deniedError } from "./deps.js";
import { invalidate as invalidateCache } from "../../platform/proxy-cache.js";

function completeOnly(body: string): boolean {
  try {
    return (JSON.parse(body) as { complete?: boolean }).complete === true;
  } catch {
    return false;
  }
}

export function registerPipelineTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;

  server.tool(
    "lore_create_pipeline_task",
    "Registers a new server-side pipeline task and returns its UUID, type, priority, resolved repo, and a pickup hint. With priority=normal the task lands in the backlog for someone to claim later; with priority=immediate the GKE agent picks it up within ~30s. This tool only enqueues — it never runs anything on your machine. Use it to delegate brand-new work to the server. To instead start a brand-new ad-hoc task running NOW in a worktree on your own machine, use lore_run_task_locally; to claim and locally run a task that ALREADY exists in the backlog, use lore_claim_and_run_locally. To turn a tasks.md checklist into spec-tasks, use lore_sync_tasks (not this tool). Runs against the shared backend: direct Postgres when LORE_DB_HOST is set, otherwise POST /api/task over LORE_API_URL (requires LORE_INGEST_TOKEN). Mutates: inserts a pipeline.tasks row + 'pending' event, enforces the repo's trust gate, and invalidates task-list read caches. Never throws; returns a text error on failure.",
    {
      description: z.string().describe("Primary natural-language instruction for the agent; be specific. For feature-request describe the feature in plain language; for onboard just give the repo name. Required and non-empty (whitespace-only is rejected); max 10000 chars. Example: 'Add rate limiting to the /api/search endpoint, 60 req/min per token'."),
      task_type: z.string().default("general").describe("One of feature-request (PM intent to spec+tasks), onboard (add a repo to Lore), general (open-ended, default), runbook (write an ops runbook), implementation (code from a spec), gap-fill (draft missing docs), review (review a PR). Unknown values fall back to 'general'. Defaults to 'general' when omitted. Example: 'implementation'."),
      target_repo: z.string().optional().describe("Target GitHub repo as 'owner/repo'. When omitted, auto-detected from the current git remote, then a task-type default. Example: 're-cinq/lore'."),
      priority: z.enum(["normal", "immediate"]).default("normal").describe("'normal' = backlog (claimed and run later, locally or via the UI); 'immediate' = the GKE agent auto-executes within ~30s. Defaults to 'normal'. Example: 'immediate'."),
      group_id: z.string().optional().describe("Task-group UUID linking this task to others in a multi-repo feature so they roll up together (see lore_list_task_group). Omit for a standalone task. Example: '7b3f...-uuid'."),
      context: z.object({
        spec_file: z.boolean().optional(),
        branch: z.string().optional(),
        seed_query: z.string().optional(),
      }).optional().describe("Optional context bundle passed through to the agent: spec_file (whether a spec file drives the task), branch (target git branch), seed_query (initial context-assembly query). Omit when not needed. Example: {branch: 'main', seed_query: 'rate limiting middleware'}."),
    },
    async ({ description: desc, task_type, target_repo, priority, group_id, context }) => {
      try {
        if (!desc || !desc.trim()) {
          return { content: [{ type: "text" as const, text: "description is required and cannot be empty" }] };
        }

        // Auto-detect repo from git remote if not specified
        const resolvedRepo = target_repo || detectCurrentRepo() || undefined;

        // When running locally (no DB), proxy to the GKE MCP server
        if (!process.env.LORE_DB_HOST) {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;
          if (!apiUrl || !apiToken) {
            return { content: [{ type: "text" as const, text: "Task delegation requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh or set them manually." }] };
          }
          const res = await fetch(`${apiUrl}/api/task`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ description: desc, task_type, target_repo: resolvedRepo, priority, group_id, context }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            return { content: [{ type: "text" as const, text: `Remote task creation failed: ${(err as any).error || res.statusText}` }] };
          }
          const result = await res.json() as any;
          const pickupMsg = priority === "immediate"
            ? "The GKE agent will pick this up within 30 seconds."
            : "Task added to backlog. Claim it locally with lore_claim_and_run_locally, or set priority to immediate via the UI.";
          const msg = `Task created: ${result.task_id}\nType: ${result.task_type || task_type}\nPriority: ${priority}\nRepo: ${resolvedRepo || 'default'}\n\n${pickupMsg}`;
          invalidateCache(["lore_list_pipeline_tasks", "lore_list_pending_tasks", "lore_get_pipeline_status"]);
          return { content: [{ type: "text" as const, text: msg }] };
        }

        const validTypes = getTaskTypes();
        const resolvedType = validTypes.includes(task_type) ? task_type : "general";
        const result = await createTask(desc, resolvedType, resolvedRepo, "mcp", context || undefined, priority, group_id);
        const pickupMsg = priority === "immediate"
          ? "The GKE agent will pick this up within 30 seconds."
          : "Task added to backlog. Claim it locally with lore_claim_and_run_locally, or set priority to immediate via the UI.";
        const msg = `Task created: ${result.task_id}\nType: ${resolvedType}\nPriority: ${priority}\nRepo: ${resolvedRepo || 'default'}\n\n${pickupMsg}`;
        invalidateCache(["lore_list_pipeline_tasks", "lore_list_pending_tasks", "lore_get_pipeline_status"]);
        return { content: [{ type: "text" as const, text: msg }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error creating pipeline task: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_get_pipeline_status",
    "Returns one pipeline task's full record by UUID — its current status plus the ordered event timeline (pending → running → pr-created → …) as pretty-printed JSON. Use this to check where a specific delegated task stands. For a multi-task listing use lore_list_pipeline_tasks; for the live GitHub PR/CI state of the task's PR use lore_get_pr_status; for raw execution log bytes use lore_get_task_logs; for a task-group rollup use lore_list_task_group. Reads the shared backend: direct Postgres when LORE_DB_HOST is set, otherwise GET /api/task/:id over LORE_API_URL (requires LORE_INGEST_TOKEN). Read-only. A missing id returns 'task not found: {id}'. Never throws.",
    {
      task_id: z.string().describe("UUID of the pipeline task to fetch, as returned by lore_create_pipeline_task or lore_list_pipeline_tasks. Example: '9f1c2d34-...-uuid'."),
    },
    async ({ task_id }) => {
      try {
        if (!process.env.LORE_DB_HOST) {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;
          if (!apiUrl || !apiToken) return { content: [{ type: "text" as const, text: "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access." }] };
          const res = await fetch(`${apiUrl}/api/task/${task_id}`, { headers: { "Authorization": `Bearer ${apiToken}` } });
          if (!res.ok) return { content: [{ type: "text" as const, text: `Remote error: ${res.statusText}` }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
        }
        const task = await getTask(task_id);
        if (!task) return { content: [{ type: "text" as const, text: `task not found: ${task_id}` }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_get_pr_status",
    "Fetches live PR state directly from GitHub for a repo + PR number and returns JSON with a single derived computed_status (one of merged, closed, draft, checks-failing, changes-requested, approved, open — by fixed precedence) plus number, title, state, draft, merged, mergeable, html_url, the normalized check runs (checks), and the reviews. Use this for the real, up-to-the-second PR/CI/review verdict; use lore_get_pipeline_status instead for the Lore task's own stored status and event timeline. Calls api.github.com directly via the configured GitHub App or token — no DB and no LORE_API_URL proxy. Read-only. Returns a 'GitHub not configured…' message when no credentials are set. Never throws.",
    {
      repo: z.string().describe("Repository as 'owner/name'. Example: 're-cinq/lore'."),
      pr_number: z.number().describe("Pull request number (the integer in the PR URL, not a UUID). Example: 482."),
    },
    async ({ repo, pr_number }) => {
      try {
        const { fetchPrStatus } = await import("../../platform/github-client.js");
        const result = await fetchPrStatus(repo, pr_number);
        if (!result) return { content: [{ type: "text" as const, text: "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN." }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_list_pipeline_tasks",
    "Lists pipeline tasks newest-first as JSON ({tasks, total}), optionally filtered to one status. This is the general browse view across ALL tasks and statuses. For only unclaimed work you could pick up and run locally (grouped by repo), use lore_list_pending_tasks; for dependency-ready spec-tasks in one repo use lore_ready_tasks; for one feature's task group use lore_list_task_group; for background tasks running on YOUR machine use lore_list_local_tasks. Reads the shared backend: direct Postgres when LORE_DB_HOST is set, otherwise GET /api/tasks over LORE_API_URL (requires LORE_INGEST_TOKEN); not cached. Read-only. Never throws.",
    {
      status: z.string().optional().describe("Filter to one status; in DB mode validated against pending, queued, running, pr-created, review, merged, failed, cancelled (an invalid value is rejected with the valid list). Omit to return tasks of every status. Example: 'running'."),
      limit: z.number().default(20).describe("Maximum number of tasks to return, newest-first; clamped to at most 100. Defaults to 20 when omitted. Example: 50."),
    },
    async ({ status, limit }) => {
      try {
        if (!process.env.LORE_DB_HOST) {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;
          if (!apiUrl || !apiToken) return { content: [{ type: "text" as const, text: "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access." }] };
          const params = new URLSearchParams();
          if (status) params.set("status", status);
          params.set("limit", String(Math.min(limit, 100)));
          const res = await fetch(`${apiUrl}/api/tasks?${params}`, { headers: { "Authorization": `Bearer ${apiToken}` } });
          if (!res.ok) return { content: [{ type: "text" as const, text: `Remote error: ${res.statusText}` }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
        }
        const validStatuses = ["pending", "queued", "running", "pr-created", "review", "merged", "failed", "cancelled"];
        if (status && !validStatuses.includes(status)) {
          return { content: [{ type: "text" as const, text: `invalid status: ${status}. Valid values: ${validStatuses.join(", ")}` }] };
        }
        const result = await listTasks(status, Math.min(limit, 100));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_cancel_task",
    "Cancels a SERVER-SIDE pipeline task by UUID, flipping it to 'cancelled' and best-effort stopping a running GKE agent; returns the new status as JSON. Use this for tasks tracked in the Lore pipeline (created via lore_create_pipeline_task / the UI). To stop a task running in a worktree on YOUR own machine and clean up the worktree, use lore_cancel_local_task instead. To re-run a failed task rather than stop a live one, use lore_retry_task. Mutates pipeline.tasks + records a 'cancelled' event. Requires a direct Postgres connection (LORE_DB_HOST) — there is no stdio/API-proxy path; without it returns a guidance message. Rejected for tasks already merged, failed, or cancelled ('Cannot cancel task in {state} state'). Never throws.",
    {
      task_id: z.string().describe("UUID of the pipeline task to cancel. Must be a non-terminal task (not merged/failed/cancelled). Example: '9f1c2d34-...-uuid'."),
    },
    async ({ task_id }) => {
      try {
        if (!process.env.LORE_DB_HOST) {
          return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const result = await cancelTask(task_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error cancelling task: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_retry_task",
    "Re-runs a failed or escalated task by cloning its description, repo, and context into a NEW pipeline task linked back via retry_of; returns the new task id, status, and retry_of as JSON. Use this to give a failed task a second attempt; to stop an unwanted live task instead of re-running it, use lore_cancel_task. Only tasks in 'failed' or 'needs-human-help' state are retryable (others are rejected, e.g. 'Cannot retry task in running state'). Mutates: inserts a new pipeline.tasks row + 'pending' event (re-running the trust gate) and marks the original 'retried'. Requires a direct Postgres connection (LORE_DB_HOST) — no stdio/API-proxy path; without it returns a guidance message. Never throws.",
    {
      task_id: z.string().describe("UUID of the original failed or needs-human-help task to retry. Example: '9f1c2d34-...-uuid'."),
    },
    async ({ task_id }) => {
      try {
        if (!process.env.LORE_DB_HOST) {
          return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const { retryTask } = await import("../../features/pipeline/pipeline.js");
        const result = await retryTask(task_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error retrying task: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_list_task_group",
    "Lists every task sharing one task_group_id (the grouping that coordinates a single multi-repo feature), ordered by creation time, with a 'completed/total' rollup line and the rows as JSON (id, description, task_type, status, target_repo, pr_url, created_at). Use this when you have a group_id and want the whole feature's progress in one rollup; for an unscoped newest-first listing of all tasks use lore_list_pipeline_tasks. A group is formed by passing group_id to lore_create_pipeline_task. Reads the shared backend via the DB pool; requires a direct Postgres connection (LORE_DB_HOST) — no stdio/API-proxy path. Read-only. An unknown/empty group returns 'No tasks found for group {id}'. Never throws.",
    {
      group_id: z.string().describe("Task-group UUID whose member tasks to list (the same value passed as group_id to lore_create_pipeline_task). Example: '7b3f...-uuid'."),
    },
    async ({ group_id }) => {
      try {
        const dbPoolRef = getPool();
        if (!dbPoolRef) {
          return { content: [{ type: "text" as const, text: "Task groups require PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const { rows } = await dbPoolRef.query(
          `SELECT id, description, task_type, status, target_repo, pr_url, created_at
           FROM pipeline.tasks WHERE task_group_id = $1 ORDER BY created_at`,
          [group_id],
        );
        if (rows.length === 0) {
          return { content: [{ type: "text" as const, text: `No tasks found for group ${group_id}` }] };
        }
        const completed = rows.filter((t: any) => ['merged', 'completed'].includes(t.status)).length;
        const summary = `Group ${group_id}: ${completed}/${rows.length} completed`;
        return { content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(rows, null, 2)}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_sync_tasks",
    "Parses a speckit tasks.md (phases, [P] parallel markers, [DEPENDS ON: …] dependencies, optional file paths) and idempotently upserts each checklist item as a spec-task row in pipeline.tasks under the given spec slug; returns a 'Synced N tasks (M new)' summary. This is the START of spec-driven multi-agent work — run it once per spec before any claiming. After syncing, find workable items with lore_ready_tasks, lock one with lore_claim_task, and finish it with lore_complete_task; this tool does NOT claim, run, or evaluate readiness. Re-running after edits updates rows in place rather than duplicating. Reads + writes the shared backend via the DB pool; requires a direct Postgres connection (LORE_DB_HOST) — no stdio/API-proxy path. Never throws.",
    {
      tasks_markdown: z.string().describe("Full markdown text of the tasks.md file (the entire document, not a path). Parsed for phases, [P] parallel markers, [DEPENDS ON: …] dependencies, and file-path suffixes. Required. Example: '## Phase 1\\n- [ ] T001 Add migration [P]'."),
      repo: z.string().optional().describe("Target repo as 'owner/repo'. When omitted, auto-detected from the current git remote. Example: 're-cinq/lore'."),
      spec_slug: z.string().describe("Feature slug that groups these spec-tasks within the repo (and disambiguates them on re-sync). Required. Example: 'auth-refactor'."),
    },
    async ({ tasks_markdown, repo, spec_slug }) => {
      try {
        const resolvedRepo = repo || detectCurrentRepo();
        if (!resolvedRepo) {
          return { content: [{ type: "text" as const, text: "Could not detect repo. Specify repo parameter." }] };
        }
        const dbPoolRef = getPool();
        if (!dbPoolRef) {
          return { content: [{ type: "text" as const, text: "lore_sync_tasks requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const parsed = parseTasks(tasks_markdown);
        if (parsed.length === 0) {
          return { content: [{ type: "text" as const, text: "No tasks found in the provided markdown." }] };
        }
        const result = await syncTasksToDb(dbPoolRef, resolvedRepo, spec_slug, parsed);
        const summary = `Synced ${result.synced} tasks (${result.created} new) for ${resolvedRepo} / ${spec_slug}.`;
        return { content: [{ type: "text" as const, text: summary }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error syncing tasks: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_ready_tasks",
    "Lists the spec-tasks for one repo that are still 'pending' AND whose every declared dependency has reached completed/merged — i.e. the items you can start right now — as a markdown bullet list of 'spec_task_id (uuid): description'. This is dependency-aware, not status-aware: for a general status-filtered listing of all tasks use lore_list_pipeline_tasks; for unclaimed tasks across repos to run locally use lore_list_pending_tasks. Spec-tasks must first be materialized with lore_sync_tasks; after picking one, lock it with lore_claim_task. Reads the shared backend via the DB pool; requires a direct Postgres connection (LORE_DB_HOST) — no stdio/API-proxy path. Read-only. Returns 'No ready tasks…' when nothing qualifies. Never throws.",
    {
      repo: z.string().optional().describe("Repo to scan as 'owner/repo'. When omitted, auto-detected from the current git remote. Example: 're-cinq/lore'."),
    },
    async ({ repo }) => {
      try {
        const resolvedRepo = repo || detectCurrentRepo();
        if (!resolvedRepo) {
          return { content: [{ type: "text" as const, text: "Could not detect repo. Specify repo parameter." }] };
        }
        const dbPoolRef = getPool();
        if (!dbPoolRef) {
          return { content: [{ type: "text" as const, text: "lore_ready_tasks requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const tasks = await getReadyTasks(dbPoolRef, resolvedRepo);
        if (tasks.length === 0) {
          return { content: [{ type: "text" as const, text: "No ready tasks. All tasks are either completed, claimed, or blocked by dependencies." }] };
        }
        const lines = tasks.map((t: any) =>
          `- **${t.metadata?.spec_task_id}** (${t.id}): ${t.description}`
        );
        return { content: [{ type: "text" as const, text: `## Ready tasks\n\n${lines.join('\n')}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error fetching ready tasks: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_claim_task",
    "Atomically locks one 'pending' spec-task and flips it to 'running' under a row lock (SELECT … FOR UPDATE SKIP LOCKED) so exactly one agent owns it; returns a claim-success or already-claimed/not-found message. Use this right before you start working a specific spec-task (typically one surfaced by lore_ready_tasks) to prevent duplicate work. To pick WHICH task, use lore_ready_tasks; to mark it done and unblock dependents afterward, use lore_complete_task; to merely dismiss a local pending NOTIFICATION (not a server claim), use lore_skip_task. Mutates pipeline.tasks (status + agent_id) inside a transaction and best-effort records a 'running' event. Requires a direct Postgres connection (LORE_DB_HOST) — no stdio/API-proxy path. Never throws.",
    {
      task_id: z.string().describe("UUID of the pending spec-task to claim. Example: '9f1c2d34-...-uuid'."),
      agent_id: z.string().optional().describe("Identifier of the claiming agent, recorded as the task owner. When omitted it is resolved from LORE_AGENT_ID, ~/.lore/agent-id, or an auto-generated id. Example: 'agent-loredana-laptop'."),
    },
    async ({ task_id, agent_id }) => {
      try {
        const dbPoolRef = getPool();
        if (!dbPoolRef) {
          return { content: [{ type: "text" as const, text: "lore_claim_task requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const resolvedAgent = agent_id || resolveAgentId();
        const claimed = await claimTask(dbPoolRef, task_id, resolvedAgent);
        if (!claimed) {
          return { content: [{ type: "text" as const, text: `Could not claim task ${task_id}. It may already be claimed or does not exist.` }] };
        }
        return { content: [{ type: "text" as const, text: `Task ${task_id} claimed by ${resolvedAgent}.` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error claiming task: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_complete_task",
    "Marks a claimed ('running') spec-task as 'completed' and reports which dependent spec-tasks that unblocks (returned as 'spec_task_id: description' entries) so you can immediately pick up the next unit of work. Use this when you finish a task you claimed with lore_claim_task; to pick the next item afterward use lore_ready_tasks. Only tasks currently in 'running' state are completed (others return 'Could not complete…it may not be in running state'). This is a server-side DB state transition — not a local notification dismissal (for that use lore_skip_task), and distinct from cancelling (lore_cancel_task). Mutates pipeline.tasks (status='completed') and best-effort records a 'completed' event. Requires a direct Postgres connection (LORE_DB_HOST) — no stdio/API-proxy path. Never throws.",
    {
      task_id: z.string().describe("UUID of the running spec-task to mark completed (the one you previously claimed). Example: '9f1c2d34-...-uuid'."),
    },
    async ({ task_id }) => {
      try {
        const dbPoolRef = getPool();
        if (!dbPoolRef) {
          return { content: [{ type: "text" as const, text: "lore_complete_task requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const result = await completeTask(dbPoolRef, task_id);
        if (!result.completed) {
          return { content: [{ type: "text" as const, text: `Could not complete task ${task_id}. It may not be in 'running' state.` }] };
        }
        let msg = `Task ${task_id} completed.`;
        if (result.unblocked.length > 0) {
          msg += `\n\nNewly unblocked tasks:\n${result.unblocked.map(u => `- ${u}`).join('\n')}`;
        }
        return { content: [{ type: "text" as const, text: msg }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error completing task: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_get_task_logs",
    "Fetches the raw execution output of one pipeline TASK (by its UUID) from the per-task GCS log object, returning JSON {logs, next_offset, complete} where 'complete' reflects whether the task is still running — pass next_offset back as offset to poll incrementally for new bytes. Use this for a user-created/delegated task's logs; for the full stdout/stderr of a scheduled CronJob RUN (context_reindex, spec_test_linker, …) use lore_get_job_logs with job_name+run_id instead. Reads the shared backend: in stdio mode via GET /api/task-logs over LORE_API_URL (requires LORE_INGEST_TOKEN), cached only once the task is complete so live polls always hit fresh bytes; in GKE mode via a direct GCS read of {repo}/{task_id}/output.log. Read-only. An unknown id returns 'Task not found: {id}'. Never throws.",
    {
      task_id: z.string().describe("UUID of the pipeline task whose logs to fetch. Example: '9f1c2d34-...-uuid'."),
      offset: z.number().default(0).describe("Byte offset to start reading from; pass the previous response's next_offset to fetch only newly-appended bytes when polling. Defaults to 0 (whole log from the start) when omitted. Example: 4096."),
    },
    async ({ task_id, offset }) => {
      try {
        // Get task to find repo and log_url
        const task = await getTask(task_id);
        if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${task_id}` }] };
        const repo = task.target_repo;

        // Try local proxy first (GCS via API)
        if (!process.env.LORE_DB_HOST) {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;
          if (!apiUrl || !apiToken) {
            return { content: [{ type: "text" as const, text: "Task logs require LORE_API_URL." }] };
          }
          const params = new URLSearchParams({ task_id, repo, offset: String(offset) });
          const proxied = await withReadCache(
            { tool: "lore_get_task_logs", args: { task_id, repo, offset }, repo, ttlSeconds: 86400 },
            async () => {
              const res = await fetch(`${apiUrl}/api/task-logs?${params}`, { headers: { "Authorization": `Bearer ${apiToken}` } });
              if (res.ok) return { ok: true as const, body: JSON.stringify(await res.json()) };
              const detail = `HTTP ${res.status} ${res.statusText}`;
              if (res.status === 401 || res.status === 403) return { ok: false as const, reason: "denied" as const, detail };
              return { ok: false as const, reason: "unreachable" as const, detail };
            },
            { label: false, cacheIf: completeOnly },
          );
          if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
          if (proxied.reason === "denied") return deniedError("lore_get_task_logs", proxied.detail);
          if (proxied.reason === "unreachable") return unreachableError("lore_get_task_logs", proxied.detail);
          return { content: [{ type: "text" as const, text: "Task logs require LORE_API_URL." }] };
        }

        // Direct GCS read (GKE mode)
        try {
          const { Storage } = await import("@google-cloud/storage");
          const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
          const file = bucket.file(`${repo}/${task_id}/output.log`);
          const [exists] = await file.exists();
          if (!exists) return { content: [{ type: "text" as const, text: JSON.stringify({ logs: "", next_offset: 0, complete: task.status !== 'running' }) }] };
          const [content] = await file.download();
          const full = content.toString("utf-8");
          const sliced = full.substring(offset);
          return { content: [{ type: "text" as const, text: JSON.stringify({ logs: sliced, next_offset: full.length, complete: task.status !== 'running' }) }] };
        } catch (err: any) {
          return { content: [{ type: "text" as const, text: `Error reading logs: ${err.message}` }] };
        }
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_get_job_logs",
    "Fetches the FULL stdout/stderr of one scheduled batch/CronJob RUN, keyed by job_name + run_id (from pipeline.job_runs), returning JSON {logs, complete:true} — the whole body, no offset slicing, since these runs are bounded. Use this for scheduled jobs like context_reindex or spec_test_linker; for the logs of a user-created pipeline task use lore_get_task_logs (by task UUID) instead. Reads the shared backend: in stdio mode via cached GET /api/job-run-logs over LORE_API_URL (requires LORE_INGEST_TOKEN), in GKE mode via a direct GCS read of __job_runs__/{job_name}/{run_id}/output.log. Read-only; a missing object returns empty logs. Never throws.",
    {
      job_name: z.string().describe("Name of the scheduled job whose run to read. Example: 'context_reindex' or 'spec_test_linker'."),
      run_id: z.string().describe("UUID of the specific run, from pipeline.job_runs.id. Example: 'b21e...-uuid'."),
    },
    async ({ job_name, run_id }) => {
      try {
        // Local-stdio mode → proxy to API
        if (!process.env.LORE_DB_HOST) {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;
          if (!apiUrl || !apiToken) {
            return { content: [{ type: "text" as const, text: "Job-run logs require LORE_API_URL." }] };
          }
          const params = new URLSearchParams({ job_name, run_id });
          const proxied = await withReadCache(
            { tool: "lore_get_job_logs", args: { job_name, run_id }, ttlSeconds: 86400 },
            async () => {
              const res = await fetch(`${apiUrl}/api/job-run-logs?${params}`, { headers: { "Authorization": `Bearer ${apiToken}` } });
              if (res.ok) return { ok: true as const, body: JSON.stringify(await res.json()) };
              const detail = `HTTP ${res.status} ${res.statusText}`;
              if (res.status === 401 || res.status === 403) return { ok: false as const, reason: "denied" as const, detail };
              return { ok: false as const, reason: "unreachable" as const, detail };
            },
            { label: false, cacheIf: completeOnly },
          );
          if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
          if (proxied.reason === "denied") return deniedError("lore_get_job_logs", proxied.detail);
          if (proxied.reason === "unreachable") return unreachableError("lore_get_job_logs", proxied.detail);
          return { content: [{ type: "text" as const, text: "Job-run logs require LORE_API_URL." }] };
        }

        // Direct GCS read (GKE mode)
        const { Storage } = await import("@google-cloud/storage");
        const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
        const file = bucket.file(`__job_runs__/${job_name}/${run_id}/output.log`);
        const [exists] = await file.exists();
        if (!exists) return { content: [{ type: "text" as const, text: JSON.stringify({ logs: "", complete: true }) }] };
        const [content] = await file.download();
        return { content: [{ type: "text" as const, text: JSON.stringify({ logs: content.toString("utf-8"), complete: true }) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_list_pending_tasks",
    "Shows unclaimed 'pending' backlog tasks you could pick up and run locally (zero API cost) before the GKE agent takes them — grouped by repo, one short line per task. This is the 'what can I grab' view; for a general status-filterable listing of ALL tasks use lore_list_pipeline_tasks, and for dependency-ready spec-tasks in one repo use lore_ready_tasks. After choosing one, run it with lore_claim_and_run_locally (which takes the task id). Prefers a live GET /api/tasks?status=pending view over LORE_API_URL (requires LORE_INGEST_TOKEN); when the API is unconfigured/unreachable it falls back to the locally-cached ~/.lore/pending-tasks.json written by the notifier (note: the local fallback ignores the repo filter). Read-only. Never throws.",
    {
      repo: z.string().optional().describe("Filter the API view to one repo as 'owner/repo'. Omit to show pending tasks across all repos. Example: 're-cinq/lore'."),
    },
    async ({ repo: filterRepo }) => {
      try {
        // Try API first for global view (all repos)
        const apiUrl = process.env.LORE_API_URL || "";
        const token = process.env.LORE_INGEST_TOKEN || "";
        if (apiUrl && token) {
          const resp = await fetch(`${apiUrl}/api/tasks?status=pending&limit=50`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resp.ok) {
            const data = await resp.json() as any;
            let tasks = data.tasks || data || [];
            if (filterRepo) {
              tasks = tasks.filter((t: any) => t.target_repo === filterRepo);
            }
            if (tasks.length === 0) {
              return { content: [{ type: "text" as const, text: filterRepo ? `No pending tasks for ${filterRepo}.` : "No pending tasks." }] };
            }
            // Group by repo
            const byRepo = new Map<string, any[]>();
            for (const t of tasks) {
              const r = t.target_repo || "unknown";
              if (!byRepo.has(r)) byRepo.set(r, []);
              byRepo.get(r)!.push(t);
            }
            const sections: string[] = [];
            for (const [r, repoTasks] of byRepo) {
              const lines = repoTasks.map((t: any) =>
                `  ${t.id.substring(0, 8)} ${t.task_type} ${t.issue_number ? "#" + t.issue_number + " " : ""}${(t.description || "").substring(0, 80)}`
              );
              sections.push(`**${r}** (${repoTasks.length})\n${lines.join("\n")}`);
            }
            return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
          }
        }
        // Fallback to local pending file
        const { listPendingTasks } = await import("../../features/pipeline/runner.local.js");
        const tasks = listPendingTasks();
        if (tasks.length === 0) {
          return { content: [{ type: "text" as const, text: "No pending tasks." }] };
        }
        const lines = tasks.map((t: any) =>
          `${t.id.substring(0, 8)} ${t.task_type} ${t.target_repo}${t.issue_number ? " #" + t.issue_number : ""}\n  ${t.description}`
        );
        return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_skip_task",
    "Dismisses one pending-task notification LOCALLY by removing its entry from ~/.lore/pending-tasks.json, so it stops showing in your statusline and GKE picks it up after its grace period. This is a local notification dismissal only — it does NOT change server state; the task stays 'pending'. To cancel the task server-side use lore_cancel_task; to mark a claimed spec-task done use lore_complete_task. Runs entirely in the local sandbox: no network, no DB, no API. Mutates the local pending-tasks cache file. Never throws.",
    {
      task_id: z.string().describe("Id of the pending task to remove from the local notification cache (as shown by lore_list_pending_tasks). Example: '9f1c2d34-...-uuid'."),
    },
    async (args) => {
      try {
        const { skipTask } = await import("../../features/pipeline/runner.local.js");
        skipTask(args.task_id);
        return { content: [{ type: "text" as const, text: `Task ${args.task_id} skipped. GKE will handle it.` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_enable_task_notifications",
    "Starts a local background poller (30s interval) that watches the given repos/task-types for new 'pending' pipeline tasks and writes matches to ~/.lore/pending-tasks.json so the statusline can surface them — letting you choose to run one locally instead of waiting for GKE. Read-only with respect to tasks: it never claims or mutates them (use lore_claim_and_run_locally to actually run a surfaced task, or lore_skip_task to dismiss one). Idempotent: if a notifier is already running it returns 'already active' without spawning a second interval. To stop it, use lore_disable_task_notifications. Runs in the local sandbox; starts a setInterval and writes the local cache file (the poll itself reads the API or DB). Never throws.",
    {
      repos: z.array(z.string()).optional().describe("List of repos to watch, each as 'owner/repo'. Defaults to the current repo (detected from the git remote) when omitted. Example: ['re-cinq/lore']."),
      task_types: z.array(z.string()).optional().describe("List of task types to surface. Defaults to ['implementation','general','runbook','gap-fill'] when omitted. Example: ['implementation','review']."),
    },
    async (args) => {
      try {
        const { startNotifier, detectRepo, isNotifierRunning } = await import("../../features/pipeline/runner.local.js");
        if (isNotifierRunning()) {
          return { content: [{ type: "text" as const, text: "Task notifications already active." }] };
        }
        const repos = args.repos || [detectRepo()].filter(Boolean) as string[];
        if (repos.length === 0) {
          return { content: [{ type: "text" as const, text: "Error: no repos to watch. Pass repos explicitly or run from a git repo with a GitHub remote." }] };
        }
        const taskTypes = args.task_types || ["implementation", "general", "runbook", "gap-fill"];
        startNotifier(repos, taskTypes);
        return {
          content: [{
            type: "text" as const,
            text: `Watching for pending tasks on ${repos.join(", ")}.\nTypes: ${taskTypes.join(", ")}\nCheck the statusline for new tasks.`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_disable_task_notifications",
    "Stops the local pending-task notifier: clears its background polling interval and removes the ~/.lore/pending-tasks.json cache file (and thus the statusline entries). Use this to undo lore_enable_task_notifications. Idempotent — calling it when no notifier is running still succeeds. Takes no parameters. Runs in the local sandbox; no network, no DB. Mutates local notifier state by tearing down the interval and unlinking the cache file. Never throws.",
    {},
    async () => {
      try {
        const { stopNotifier } = await import("../../features/pipeline/runner.local.js");
        stopNotifier();
        return { content: [{ type: "text" as const, text: "Task notifications stopped." }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );
}
