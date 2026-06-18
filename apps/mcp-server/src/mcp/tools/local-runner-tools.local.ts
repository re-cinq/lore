import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolDeps } from "./deps.js";

export function registerLocalRunnerTools(server: McpServer, _deps: ToolDeps) {
  server.tool(
    "lore_run_task_locally",
    `Starts a brand-new ad-hoc task running now as a detached background Claude Code process in an isolated git worktree on the local machine, and returns immediately with the task id, branch name, worktree path, log file path, and PID. Runs on your local Claude subscription (zero API cost); the background process eventually validates, commits, pushes, and opens a PR while your interactive session continues. Requires a trusted local sandbox checked out at a git repo with a GitHub origin remote — the detected repo must match the task; otherwise it returns a not-in-a-repo error or a wrong-repo warning with a cd suggestion (no worktree created). When LORE_API_URL + LORE_INGEST_TOKEN are set it first POSTs /api/task to register a server-side pipeline task and adopt its id. Use this when YOU supply a free-text description for new work; to run an EXISTING pending pipeline task by its id (from lore_list_pending_tasks) use lore_claim_and_run_locally instead; to merely register a server-side task without running anything locally use lore_create_pipeline_task instead. Never throws — all errors are returned as text.`,
    {
      description: z.string().describe("Free-text instruction for what to implement or do, in plain language (e.g. 'Add retry with backoff to the S3 upload client'). If it references an owner/repo token other than the current repo, the call is refused with a wrong-repo warning."),
      task_type: z.enum(["implementation", "general", "runbook", "gap-fill"]).default("implementation").describe("Kind of work the background agent performs: 'implementation' (write code from the description, the default), 'general' (open-ended task), 'runbook' (generate an incident runbook), or 'gap-fill' (draft missing documentation). Defaults to 'implementation'."),
      model: z.string().optional().describe("Anthropic model id override for the spawned Claude Code process (e.g. 'claude-opus-4-6'). When omitted, the local runner's configured default model (~/.lore/local-runner.json `model`) is used, falling back to claude-sonnet-4-6 when none is configured."),
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
    `Lists every background task tracked on YOUR machine — running, completed, or failed — one line per task as '<8-char id> <status> <repo> <branch>' plus ' → <prUrl>' when a PR was opened and ' ✗ <error>' when failed; returns 'No local tasks.' when none. Reads the local ~/.lore/local-tasks.json registry and reconciles any 'running' row whose PID is dead to 'failed' before printing; no DB, no network, no cache. Use this for the status of locally-spawned worktree tasks (PIDs, branches, PR URLs); for server-side pipeline tasks use lore_list_pipeline_tasks (all statuses), for unclaimed tasks you could pick up use lore_list_pending_tasks, for spec-tasks whose dependencies are satisfied use lore_ready_tasks, and for every task sharing a multi-repo group_id with a completed/total rollup use lore_list_task_group. Takes no input. Never throws — errors are returned as text.`,
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
    `Stops a task running in a background worktree on YOUR machine: SIGTERMs its process, marks the local registry row 'failed' with error 'Cancelled by user', force-removes its git worktree, and fire-and-forget updates the server-side task to 'cancelled'. Returns 'Task <id> cancelled. Worktree cleaned up.' on success, or 'Could not cancel: <reason>' when the id is unknown or the task is not in 'running' status. Operates only on the local ~/.lore/local-tasks.json registry and worktrees — no shared DB. Use this for locally-spawned tasks from lore_run_task_locally / lore_claim_and_run_locally; to cancel a SERVER-SIDE pipeline task by UUID (which may stop a running GKE agent) use lore_cancel_task instead. Never throws — errors are returned as text.`,
    {
      task_id: z.string().describe("Local task id to cancel (the id returned by lore_run_task_locally or shown by lore_list_local_tasks, e.g. '5f3a9b2c-...'). Must reference a task currently in 'running' status."),
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
    `Claims an EXISTING pending pipeline task by its id and runs it on YOUR machine (your Claude subscription, zero API cost), then removes it from the local pending list. Resolves the task from the local pending cache (exact id or id-prefix) or, on a miss, via GET /api/task/<id> (adopted only if still 'pending'); best-effort claims it via POST /api/task. ingest-* task types run in-process with zero LLM and no worktree (returning the ingest result); all other types spawn a detached background Claude Code worktree task and return a 'Claimed and running locally' report with task id, branch, log file, and PID. Returns a not-found message when the id is unknown or not pending. Requires a trusted local sandbox. Use this to pick up a pre-existing pending task surfaced by lore_list_pending_tasks; to start a BRAND-NEW task from a free-text description use lore_run_task_locally instead; to register a task for the GKE agent to execute server-side use lore_create_pipeline_task instead. Never throws — errors are returned as text.`,
    {
      task_id: z.string().describe("Id of the pending pipeline task to claim, as shown by lore_list_pending_tasks (e.g. 'a1b2c3d4-...'). Matched by exact id or unique id-prefix; the task must currently be in 'pending' status."),
      model: z.string().optional().describe("Anthropic model id override for the spawned Claude Code process when the task is not an ingest-* type (e.g. 'claude-opus-4-6'). When omitted, the runner's configured default model is used."),
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
    `Views or updates the local task-runner config file (~/.lore/local-runner.json) on YOUR machine and returns the resulting config as pretty JSON. Called with NO update arguments (or only a max_concurrent of 0, which is ignored) it is read-only and returns the current config (defaults — enabled:false, max_concurrent:2, the four standard task_types, model claude-sonnet-4-6 — when the file is absent or unreadable); called with any positive/non-empty field it overwrites only the provided fields, persists, and returns 'Config updated:' plus the JSON. This config governs which repos/task-types the local notifier watches and the local concurrency/model bounds; it has no meaning on the shared GKE server. This is configuration only — to actually run work locally use lore_run_task_locally (new task) or lore_claim_and_run_locally (existing pending task). No DB, no network. Never throws — errors are returned as text.`,
    {
      max_concurrent: z.number().optional().describe("Maximum number of local background tasks allowed to run at once, as a positive integer (e.g. 3). When omitted, the existing value is kept; the built-in default is 2."),
      repos: z.array(z.string()).optional().describe("Allowlist of owner/repo slugs the local notifier watches for claimable tasks (e.g. ['re-cinq/lore','re-cinq/platform']). When omitted, the existing list is kept; replaces the whole list when provided."),
      task_types: z.array(z.string()).optional().describe("Allowlist of task-type names eligible to run locally (e.g. ['implementation','general','runbook','gap-fill']). When omitted, the existing list is kept; replaces the whole list when provided."),
      model: z.string().optional().describe("Default Anthropic model id for locally-run tasks (e.g. 'claude-sonnet-4-6'). When omitted, the existing value is kept; the built-in default is claude-sonnet-4-6."),
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
