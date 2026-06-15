import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolDeps } from "./deps.js";

export function registerLocalRunnerTools(server: McpServer, _deps: ToolDeps) {
  server.tool(
    "lore_run_task_locally",
    "Run a task in the background on your local machine using Claude Code in a git worktree. Returns immediately — your session continues normally while the task runs.",
    {
      description: z.string().describe("What to implement or do"),
      task_type: z.enum(["implementation", "general", "runbook", "gap-fill"]).default("implementation"),
      model: z.string().optional().describe("Model override (default: claude-sonnet-4-6)"),
    },
    async (args) => {
      try {
        const { spawnLocalTask, detectRepo, getRepoRoot } = await import("../../features/pipeline/runner.local.js");
        const repo = detectRepo();
        if (!repo) return { content: [{ type: "text" as const, text: "Error: not in a git repository with a GitHub remote" }] };

        // Warn if the task description references a different repo
        const repoRefMatch = args.description.match(/\b([\w-]+\/[\w-]+)(?:#|\s)/);
        if (repoRefMatch && repoRefMatch[1] !== repo && !args.description.toLowerCase().includes(repo)) {
          return { content: [{ type: "text" as const, text: `Warning: This task references ${repoRefMatch[1]} but you're in ${repo}. Switch to the target repo first:\n  cd /path/to/${repoRefMatch[1].split("/")[1]} && claude` }] };
        }

        // Create pipeline task via API
        const apiUrl = process.env.LORE_API_URL || "";
        const token = process.env.LORE_INGEST_TOKEN || "";
        let taskId = crypto.randomUUID();

        if (apiUrl && token) {
          try {
            const resp = await fetch(`${apiUrl}/api/task`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                description: args.description,
                task_type: args.task_type,
                target_repo: repo,
                created_by: "local-runner",
              }),
            });
            const data = await resp.json() as any;
            if (data.task_id) taskId = data.task_id;
          } catch { /* use generated UUID */ }
        }

        const task = await spawnLocalTask({
          taskId,
          prompt: args.description,
          repo,
          taskType: args.task_type,
          model: args.model,
          repoRoot: getRepoRoot() || undefined,
        });

        return {
          content: [{
            type: "text" as const,
            text: `Task running locally in background.\n\nTask ID: ${task.taskId}\nBranch: ${task.branch}\nWorktree: ${task.worktreePath}\nLogs: ${task.logFile}\nPID: ${task.pid}\n\nYour session continues normally. Watch progress in the statusline.`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_list_local_tasks",
    "List all local background tasks (running, completed, failed).",
    {},
    async () => {
      try {
        const { listLocalTasks } = await import("../../features/pipeline/runner.local.js");
        const tasks = listLocalTasks();
        if (tasks.length === 0) {
          return { content: [{ type: "text" as const, text: "No local tasks." }] };
        }
        const lines = tasks.map((t: any) =>
          `${t.taskId.substring(0, 8)} ${t.status} ${t.repo} ${t.branch}${t.prUrl ? " → " + t.prUrl : ""}${t.error ? " ✗ " + t.error : ""}`
        );
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_cancel_local_task",
    "Cancel a running local background task and clean up its worktree.",
    {
      task_id: z.string().describe("Task ID to cancel"),
    },
    async (args) => {
      try {
        const { cancelLocalTask } = await import("../../features/pipeline/runner.local.js");
        const result = cancelLocalTask(args.task_id);
        return {
          content: [{
            type: "text" as const,
            text: result.cancelled
              ? `Task ${args.task_id} cancelled. Worktree cleaned up.`
              : `Could not cancel: ${result.error}`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_claim_and_run_locally",
    "Claim a pending pipeline task and run it locally in the background. The task runs in a git worktree using your Claude Code subscription (zero API cost).",
    {
      task_id: z.string().describe("Task ID to claim (from lore_list_pending_tasks)"),
      model: z.string().optional().describe("Model override"),
    },
    async (args) => {
      try {
        const { spawnLocalTask, getRepoRoot, skipTask, listPendingTasks } = await import("../../features/pipeline/runner.local.js");

        // Find the task in local pending list first, then fall back to API
        const pending = listPendingTasks();
        let task = pending.find((t: any) => t.id === args.task_id || t.id.startsWith(args.task_id));

        // If not in local cache, try fetching from API (supports cross-repo tasks)
        if (!task) {
          const apiUrl = process.env.LORE_API_URL || "";
          const apiToken = process.env.LORE_INGEST_TOKEN || "";
          if (apiUrl && apiToken) {
            try {
              const resp = await fetch(`${apiUrl}/api/task/${args.task_id}`, {
                headers: { Authorization: `Bearer ${apiToken}` },
              });
              if (resp.ok) {
                const data = await resp.json() as any;
                if (data.status === "pending") {
                  task = { id: data.id, description: data.description, task_type: data.task_type, target_repo: data.target_repo, issue_number: data.issue_number, created_at: data.created_at };
                }
              }
            } catch { /* fall through */ }
          }
        }

        if (!task) {
          return { content: [{ type: "text" as const, text: `Task ${args.task_id} not found or not in pending status. Run lore_list_pending_tasks first.` }] };
        }

        // Claim via API (best effort)
        const apiUrl = process.env.LORE_API_URL || "";
        const token = process.env.LORE_INGEST_TOKEN || "";
        if (apiUrl && token) {
          try {
            await fetch(`${apiUrl}/api/task`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ task_id: task.id, action: "claim", claimed_by: "local-runner" }),
            });
          } catch { /* best effort */ }
        }

        // Deterministic graph-ingest tasks run in-process (zero-LLM, no worktree),
        // dispatched by execution_mode via the task-type prefix. The content source
        // is the cwd working tree when it matches, else a cached /tmp clone.
        if (typeof task.task_type === "string" && task.task_type.startsWith("ingest-")) {
          const { resolveContentSource, executeGraphIngestLocally } = await import("../../features/spec-trace/graph-ingest.local.js");
          const cb = (task as any).context_bundle || {};
          const ref = cb.commit || cb.branch || undefined;
          let sourceDir: string;
          try {
            sourceDir = await resolveContentSource(task.target_repo, ref);
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Could not prepare repo source for ${task.target_repo}: ${err.message}` }] };
          }
          const result = await executeGraphIngestLocally(task, sourceDir);
          skipTask(task.id);
          return { content: [{ type: "text" as const, text: `${result.message}\n\nTask ${task.id} → ${result.status} (source: ${sourceDir})` }] };
        }

        // Spawn locally
        const localTask = await spawnLocalTask({
          taskId: task.id,
          prompt: task.description,
          repo: task.target_repo,
          taskType: task.task_type,
          model: args.model,
          repoRoot: getRepoRoot() || undefined,
        });

        // Remove from pending
        skipTask(task.id);

        return {
          content: [{
            type: "text" as const,
            text: `Claimed and running locally.\n\nTask: ${task.id}\nBranch: ${localTask.branch}\nLogs: ${localTask.logFile}\nPID: ${localTask.pid}`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_configure_local_runner",
    "View or update local task runner settings. Controls which repos and task types the runner watches, concurrency limits, and default model.",
    {
      max_concurrent: z.number().optional().describe("Max concurrent local tasks (default: 2)"),
      repos: z.array(z.string()).optional().describe("Repos to watch (e.g. ['re-cinq/lore'])"),
      task_types: z.array(z.string()).optional().describe("Task types to run locally"),
      model: z.string().optional().describe("Default model for local tasks"),
    },
    async (args) => {
      try {
        const { readConfig, writeConfig } = await import("../../features/pipeline/runner.local.js");
        const config = readConfig();

        // If no args provided, return current config
        if (!args.max_concurrent && !args.repos && !args.task_types && !args.model) {
          return { content: [{ type: "text" as const, text: JSON.stringify(config, null, 2) }] };
        }

        // Update provided fields
        if (args.max_concurrent !== undefined) config.max_concurrent = args.max_concurrent;
        if (args.repos) config.repos = args.repos;
        if (args.task_types) config.task_types = args.task_types;
        if (args.model) config.model = args.model;

        writeConfig(config);
        return { content: [{ type: "text" as const, text: `Config updated:\n${JSON.stringify(config, null, 2)}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );
}
