import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTask,
  getTask,
  listTasks,
  cancelTask,
} from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { getTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import {
  parseTasks,
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from "@re-cinq/lore-server-core/features/pipeline/tasks.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
import { ToolDeps, withReadCache, unreachableError, deniedError } from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";

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
    "Enqueues a new server-side pipeline task and returns its UUID and a pickup hint. priority=normal lands in the backlog; priority=immediate the GKE agent picks up within ~30s. This tool only enqueues — it never runs anything on your machine. Instead: lore_run_task_locally to start a new ad-hoc task in a local worktree NOW; lore_claim_and_run_locally to run an existing backlog task locally; lore_sync_tasks to materialize a tasks.md checklist as spec-tasks (not this tool).",
    {
      description: z.string().describe("Primary natural-language instruction; be specific. Max 10000 chars; non-empty."),
      task_type: z.string().default("general").describe("feature-request | onboard | general | runbook | implementation | gap-fill | review. Unknown values fall back to 'general'."),
      target_repo: z.string().optional().describe("'owner/repo'. Auto-detected from git remote when omitted."),
      priority: z.enum(["normal", "immediate"]).default("normal").describe("'normal' = backlog; 'immediate' = GKE agent auto-executes within ~30s."),
      group_id: z.string().optional().describe("Task-group UUID to link this task into a multi-repo feature rollup (see lore_list_task_group)."),
      context: z.object({
        spec_file: z.boolean().optional(),
        branch: z.string().optional(),
        seed_query: z.string().optional(),
      }).optional().describe("Optional context for the agent: spec_file, branch, seed_query."),
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
    "Returns one pipeline task's full record (status + ordered event timeline) as JSON, by UUID. Instead: lore_list_pipeline_tasks for a multi-task listing; lore_get_pr_status for the live GitHub PR/CI verdict; lore_get_task_logs for raw log bytes; lore_list_task_group for a group rollup.",
    {
      task_id: z.string(),
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
    "Fetches live PR state from GitHub and returns a derived computed_status (merged | closed | draft | checks-failing | changes-requested | approved | open) plus CI checks and reviews. Use this for the real-time PR/CI/review verdict. Instead: lore_get_pipeline_status for the Lore task's stored status and event timeline.",
    {
      repo: z.string().describe("'owner/repo'"),
      pr_number: z.number().describe("PR number (integer from the PR URL, not a UUID)."),
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
    "Lists pipeline tasks newest-first as JSON, optionally filtered by status. General browse view across all tasks and statuses. Instead: lore_list_pending_tasks for unclaimed work to grab locally; lore_ready_tasks for dependency-ready spec-tasks in one repo; lore_list_task_group for one feature's group; lore_list_local_tasks for tasks running on your machine.",
    {
      status: z.string().optional().describe("Filter by status: pending | queued | running | pr-created | review | merged | failed | cancelled. Omit for all."),
      limit: z.number().default(20),
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
    "Cancels a server-side pipeline task, flipping it to 'cancelled' and best-effort stopping any running GKE agent. (DB-only) Instead: lore_cancel_local_task to stop a task running in a local worktree; lore_retry_task to re-run a failed task rather than stop a live one. Rejected for tasks already in merged/failed/cancelled state.",
    {
      task_id: z.string(),
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
    "Re-runs a failed or escalated task by cloning it into a new pipeline task linked via retry_of. Only tasks in 'failed' or 'needs-human-help' state are retryable. (DB-only) Instead: lore_cancel_task to stop an unwanted live task rather than re-run it.",
    {
      task_id: z.string(),
    },
    async ({ task_id }) => {
      try {
        if (!process.env.LORE_DB_HOST) {
          return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const { retryTask } = await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");
        const result = await retryTask(task_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error retrying task: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_list_task_group",
    "Lists every task in one task_group_id with a completed/total rollup — the view for a single multi-repo feature's progress. (DB-only) Instead: lore_list_pipeline_tasks for an unscoped newest-first listing of all tasks.",
    {
      group_id: z.string().describe("Task-group UUID (the value passed as group_id to lore_create_pipeline_task)."),
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
    "Parses a speckit tasks.md and idempotently upserts each checklist item as a spec-task row; returns a 'Synced N tasks (M new)' summary. Run once per spec before any claiming — this is the start of spec-driven multi-agent work. This tool does NOT claim, run, or evaluate readiness. (DB-only) After syncing: lore_ready_tasks to find workable items; lore_claim_task to lock one; lore_complete_task to finish it.",
    {
      tasks_markdown: z.string().describe("Full markdown text of the tasks.md document (not a path). Parsed for phases, [P] parallel markers, [DEPENDS ON: …] deps, and file-path suffixes."),
      repo: z.string().optional().describe("'owner/repo'. Auto-detected from git remote when omitted."),
      spec_slug: z.string().describe("Feature slug grouping these spec-tasks within the repo."),
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
    "Lists spec-tasks that are 'pending' AND whose every dependency has completed — the items you can start right now. (DB-only) Spec-tasks must first be materialized with lore_sync_tasks; after picking one, lock it with lore_claim_task. Instead: lore_list_pipeline_tasks for a general status-filtered listing; lore_list_pending_tasks for unclaimed tasks across repos to run locally.",
    {
      repo: z.string().optional().describe("'owner/repo'. Auto-detected from git remote when omitted."),
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
    "Atomically locks one 'pending' spec-task (flips it to 'running') so exactly one agent owns it. (DB-only) Use right before starting a task surfaced by lore_ready_tasks. Instead: lore_complete_task to mark it done afterward; lore_skip_task to dismiss a local notification without a server claim.",
    {
      task_id: z.string(),
      agent_id: z.string().optional().describe("Claiming agent identifier. Auto-resolved when omitted."),
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
    "Marks a claimed ('running') spec-task as 'completed' and returns which dependents are now unblocked. (DB-only) Only 'running' tasks can be completed. Instead: lore_ready_tasks to pick the next item; lore_skip_task to dismiss a local notification; lore_cancel_task to cancel rather than complete.",
    {
      task_id: z.string(),
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
    "Fetches raw execution output for one pipeline task (by UUID), returning {logs, next_offset, complete}. Pass next_offset back as offset to poll incrementally. Instead: lore_get_job_logs (job_name + run_id) for scheduled CronJob run logs.",
    {
      task_id: z.string(),
      offset: z.number().default(0).describe("Byte offset to start reading from; pass previous next_offset to poll incrementally."),
    },
    async ({ task_id, offset }) => {
      try {
        // Get task to find repo and log_url
        const task = await getTask(task_id);
        if (!task) return { content: [{ type: "text" as const, text: `Task not found: ${task_id}` }] };
        const repo = task.target_repo;

        // Proxy log reads to the remote API (logs live server-side in GCS).
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
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_get_job_logs",
    "Fetches the full stdout/stderr of one scheduled CronJob run (keyed by job_name + run_id), returning {logs, complete:true}. Use for scheduled jobs like context_reindex or spec_test_linker. Instead: lore_get_task_logs for a user-created pipeline task's logs (by UUID).",
    {
      job_name: z.string().describe("Scheduled job name, e.g. 'context_reindex' or 'spec_test_linker'."),
      run_id: z.string().describe("Run UUID from pipeline.job_runs."),
    },
    async ({ job_name, run_id }) => {
      try {
        // Proxy log reads to the remote API (logs live server-side in GCS).
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
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_list_pending_tasks",
    "Shows unclaimed 'pending' backlog tasks grouped by repo — the 'what can I grab' view. Falls back to ~/.lore/pending-tasks.json (local notifier cache) when the API is unreachable; the local fallback ignores the repo filter. After choosing one, run it with lore_claim_and_run_locally. Instead: lore_list_pipeline_tasks for a general status-filterable listing; lore_ready_tasks for dependency-ready spec-tasks in one repo.",
    {
      repo: z.string().optional().describe("'owner/repo' filter for the API view. Omit for all repos."),
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
    "Removes one task from the local ~/.lore/pending-tasks.json notification cache so it stops appearing in the statusline. Local only — does NOT change server state (task stays 'pending'). Instead: lore_cancel_task to cancel server-side; lore_complete_task to mark a claimed spec-task done.",
    {
      task_id: z.string(),
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
    "Starts a local background poller that watches repos for new 'pending' pipeline tasks and writes matches to ~/.lore/pending-tasks.json for the statusline. Idempotent — returns 'already active' if running. To stop it: lore_disable_task_notifications. To run a surfaced task: lore_claim_and_run_locally. To dismiss one: lore_skip_task.",
    {
      repos: z.array(z.string()).optional().describe("Repos to watch as 'owner/repo'. Defaults to current git remote."),
      task_types: z.array(z.string()).optional().describe("Task types to surface. Defaults to implementation, general, runbook, gap-fill."),
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
    "Stops the local pending-task notifier and removes the ~/.lore/pending-tasks.json cache. Undoes lore_enable_task_notifications. Idempotent.",
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
