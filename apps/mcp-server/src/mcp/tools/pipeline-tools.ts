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
import { ToolDeps, withReadCache } from "./deps.js";
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
    "Create a pipeline task. By default tasks go to the backlog (priority=normal) for developers to pick up locally. Set priority=immediate to have the GKE agent auto-execute it. Available types: feature-request (PM intent → spec + tasks), onboard (add repo to Lore), general (open-ended), runbook (write ops runbook), implementation (code from spec), gap-fill (draft missing docs), review (review a PR).",
    {
      description: z.string().describe("What should the agent do? Be specific — this is the primary instruction. For feature-request: describe the feature in plain language. For onboard: just the repo name."),
      task_type: z.string().default("general").describe('Task type: "feature-request", "onboard", "general", "runbook", "implementation", "gap-fill", "review".'),
      target_repo: z.string().optional().describe('Target GitHub repository in "owner/repo" format. Auto-detected from git remote if omitted.'),
      priority: z.enum(["normal", "immediate"]).default("normal").describe('Task priority. "normal" = backlog (developers pick up locally). "immediate" = GKE agent auto-executes.'),
      group_id: z.string().optional().describe("Task group UUID for multi-repo task coordination. Tasks in the same group are tracked together."),
      context: z.object({
        spec_file: z.boolean().optional(),
        branch: z.string().optional(),
        seed_query: z.string().optional(),
      }).optional().describe("Additional context to pass to the agent."),
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
            body: JSON.stringify({ description: desc, task_type, target_repo: resolvedRepo, priority, context }),
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
    "Retrieve the current status of a pipeline task, including its full event timeline.",
    {
      task_id: z.string().describe("UUID of the pipeline task."),
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
    "Fetch live PR state from GitHub for a given repo and PR number. Returns draft/open/checks-failing/changes-requested/approved/merged/closed status plus check results and review details.",
    {
      repo: z.string().describe('Repository in owner/name format, e.g. "re-cinq/lore".'),
      pr_number: z.number().describe("Pull request number."),
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
    "List pipeline tasks with optional filtering by status. Returns tasks ordered by creation time, newest first.",
    {
      status: z.string().optional().describe('Filter by status (e.g., "pending", "running", "pr-created", "failed"). Omit to return all tasks.'),
      limit: z.number().default(20).describe("Maximum number of tasks to return. Default 20, max 100."),
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
    "Cancel a pipeline task. If the task has a running agent, attempts to cancel it.",
    {
      task_id: z.string().describe("UUID of the pipeline task to cancel."),
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
    "Retry a failed pipeline task. Creates a new task with the same parameters and links it to the original.",
    {
      task_id: z.string().describe("UUID of the failed task to retry."),
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
    "List all tasks in a task group. Task groups coordinate multi-repo features.",
    {
      group_id: z.string().describe("Task group UUID."),
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
    "Parse a tasks.md file and sync spec-tasks into the pipeline. Handles dependencies and parallelization markers.",
    {
      tasks_markdown: z.string().describe("Contents of tasks.md (the full markdown text)."),
      repo: z.string().optional().describe('Target repo in "owner/repo" format. Auto-detected if omitted.'),
      spec_slug: z.string().describe("Feature slug (e.g. 'auth-refactor'). Used to group tasks."),
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
    "List spec-tasks that are ready to work on (all dependencies satisfied).",
    {
      repo: z.string().optional().describe('Target repo in "owner/repo" format. Auto-detected if omitted.'),
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
    "Atomically claim a spec-task so no other agent works on it.",
    {
      task_id: z.string().describe("UUID of the pipeline task to claim."),
      agent_id: z.string().optional().describe("Agent ID. Auto-resolved if omitted."),
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
    "Mark a spec-task as completed and report any newly unblocked tasks.",
    {
      task_id: z.string().describe("UUID of the pipeline task to complete."),
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
    "Fetch execution logs for a pipeline task. Returns the latest output from the task's log file.",
    {
      task_id: z.string().describe("UUID of the pipeline task."),
      offset: z.number().default(0).describe("Byte offset for incremental reads (for polling)."),
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
              return { ok: false as const, reason: "unreachable" as const, detail: res.statusText };
            },
            { label: false, cacheIf: completeOnly },
          );
          if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
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
    "Fetch full stdout/stderr of a scheduled batch-job run (K8s CronJob pod). The log_path is recorded in pipeline.job_runs by the agent's job-runner.",
    {
      job_name: z.string().describe("Job name (e.g. context_reindex, spec_test_linker)."),
      run_id: z.string().describe("UUID of the run, from pipeline.job_runs.id."),
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
              return { ok: false as const, reason: "unreachable" as const, detail: res.statusText };
            },
            { label: false, cacheIf: completeOnly },
          );
          if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
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
    "Show pending pipeline tasks that can be claimed and run locally. Shows tasks across all repos by default.",
    {
      repo: z.string().optional().describe('Filter by repo in "owner/repo" format. Omit to show all repos.'),
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
    "Dismiss a pending task notification. GKE will pick it up instead.",
    {
      task_id: z.string().describe("Task ID to skip"),
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
    "Start watching for pending pipeline tasks on repos you work with. Shows new tasks in the statusline so you can decide to run them locally or let GKE handle them.",
    {
      repos: z.array(z.string()).optional().describe("Repos to watch (e.g. ['re-cinq/lore']). Defaults to current repo."),
      task_types: z.array(z.string()).optional().describe("Task types to watch. Defaults to implementation, general, runbook, gap-fill."),
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
    "Stop watching for pending pipeline tasks.",
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
