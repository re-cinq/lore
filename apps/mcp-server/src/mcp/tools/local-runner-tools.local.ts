import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PendingTask } from "../../features/pipeline/runner.local.js";

/** Registers the task via the API, returning the server-issued id, or null when offline. */
async function createPipelineTaskViaApi(
  description: string,
  taskType: string,
  repo: string,
): Promise<string | null> {
  const apiUrl = process.env.LORE_API_URL || "";
  const token = process.env.LORE_INGEST_TOKEN || "";

  if (!(apiUrl && token)) {
    return null;
  }

  try {
    const resp = await fetch(`${apiUrl}/api/task`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description,
        task_type: taskType,
        target_repo: repo,
        created_by: "local-runner",
      }),
    });
    const created = (await resp.json()) as { task_id?: string };

    return created.task_id ?? null;
  } catch {
    return null;
  }
}

/** Fetches one task from the API; undefined when unreachable or not pending. */
async function fetchPendingTaskFromApi(
  taskId: string,
): Promise<PendingTask | undefined> {
  const apiUrl = process.env.LORE_API_URL || "";
  const apiToken = process.env.LORE_INGEST_TOKEN || "";

  if (!(apiUrl && apiToken)) {
    return undefined;
  }

  try {
    const resp = await fetch(`${apiUrl}/api/task/${taskId}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!resp.ok) {
      return undefined;
    }
    const fetchedTask = (await resp.json()) as {
      status?: string;
      id: string;
      description: string;
      task_type: string;
      target_repo: string;
      issue_number?: number;
      created_at: string;
    };

    if (fetchedTask.status !== "pending") {
      return undefined;
    }

    return {
      id: fetchedTask.id,
      description: fetchedTask.description,
      task_type: fetchedTask.task_type,
      target_repo: fetchedTask.target_repo,
      issue_number: fetchedTask.issue_number,
      created_at: fetchedTask.created_at,
    };
  } catch {
    return undefined;
  }
}

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const RUN_TASK_LOCALLY_INPUT = {
  description: z
    .string()
    .describe(
      "Free-text instruction for the agent. Must reference the current repo; cross-repo references are refused with a wrong-repo warning.",
    ),
  task_type: z
    .enum(["implementation", "general", "runbook", "gap-fill"])
    .default("implementation")
    .describe(
      "Kind of work: 'implementation' (code), 'general' (open-ended), 'runbook' (incident runbook), 'gap-fill' (missing docs).",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Anthropic model id override for the spawned process (e.g. 'claude-opus-4-6').",
    ),
};

const CLAIM_AND_RUN_LOCALLY_INPUT = {
  task_id: z
    .string()
    .describe(
      "Id or unique id-prefix of the pending task (from lore_list_pending_tasks); must be in 'pending' status.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Anthropic model id override for non-ingest tasks (e.g. 'claude-opus-4-6').",
    ),
};

const CONFIGURE_LOCAL_RUNNER_INPUT = {
  max_concurrent: z
    .number()
    .optional()
    .describe("Max simultaneous local background tasks (positive integer)."),
  repos: z
    .array(z.string())
    .optional()
    .describe(
      "owner/repo slugs the local notifier watches (e.g. ['re-cinq/lore']). Replaces the whole list.",
    ),
  task_types: z
    .array(z.string())
    .optional()
    .describe(
      "Task-type names eligible to run locally. Replaces the whole list.",
    ),
  model: z
    .string()
    .optional()
    .describe("Default model id for local tasks (e.g. 'claude-sonnet-4-6')."),
};

export function registerLocalRunnerTools(server: McpServer) {
  registerRunTaskLocallyTool(server);
  registerListLocalTasksTool(server);
  registerCancelLocalTaskTool(server);
  registerClaimAndRunLocallyTool(server);
  registerConfigureLocalRunnerTool(server);
}

function registerRunTaskLocallyTool(server: McpServer) {
  server.tool(
    "lore_run_task_locally",
    `Starts a brand-new ad-hoc task as a detached background Claude Code process in a local git worktree; returns immediately with task id, branch, worktree path, log file, and PID. Runs on your local machine (your Claude subscription). Instead of this: to run an EXISTING pending pipeline task by id use lore_claim_and_run_locally; to register a task for the GKE agent use lore_create_pipeline_task.`,
    RUN_TASK_LOCALLY_INPUT,
    async (args) => {
      try {
        const { spawnLocalTask, detectRepo, getRepoRoot } =
          await import("../../features/pipeline/runner.local.js");
        const repo = detectRepo();

        if (!repo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: not in a git repository with a GitHub remote",
              },
            ],
          };
        }

        // Warn if the task description references a different repo
        const repoRefMatch = args.description.match(
          /\b([\w-]+\/[\w-]+)(?:#|\s)/,
        );

        if (
          repoRefMatch &&
          repoRefMatch[1] !== repo &&
          !args.description.toLowerCase().includes(repo)
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Warning: This task references ${repoRefMatch[1]} but you're in ${repo}. Switch to the target repo first:\n  cd /path/to/${repoRefMatch[1].split("/")[1]} && claude`,
              },
            ],
          };
        }

        // Create pipeline task via API; fall back to a generated UUID offline.
        const taskId =
          (await createPipelineTaskViaApi(
            args.description,
            args.task_type,
            repo,
          )) ?? crypto.randomUUID();

        const task = await spawnLocalTask({
          taskId,
          prompt: args.description,
          repo,
          taskType: args.task_type,
          model: args.model,
          repoRoot: getRepoRoot() || undefined,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Task running locally in background.\n\nTask ID: ${task.taskId}\nBranch: ${task.branch}\nWorktree: ${task.worktreePath}\nLogs: ${task.logFile}\nPID: ${task.pid}\n\nYour session continues normally. Watch progress in the statusline.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${errorMessage(err)}` },
          ],
        };
      }
    },
  );
}

function registerListLocalTasksTool(server: McpServer) {
  server.tool(
    "lore_list_local_tasks",
    `Lists all background tasks tracked on your local machine (running, completed, failed) with status, repo, branch, PR URL, and error. Instead of this: for server-side pipeline tasks use lore_list_pipeline_tasks; for unclaimed server tasks use lore_list_pending_tasks; for dependency-satisfied spec tasks use lore_ready_tasks; for multi-repo group rollup use lore_list_task_group.`,
    {},
    async () => {
      try {
        const { listLocalTasks } =
          await import("../../features/pipeline/runner.local.js");
        const tasks = listLocalTasks();

        if (tasks.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No local tasks." }],
          };
        }
        const lines = tasks.map(
          (t) =>
            `${t.taskId.substring(0, 8)} ${t.status} ${t.repo} ${t.branch}${t.prUrl ? " → " + t.prUrl : ""}${t.error ? " ✗ " + t.error : ""}`,
        );

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${errorMessage(err)}` },
          ],
        };
      }
    },
  );
}

function registerCancelLocalTaskTool(server: McpServer) {
  server.tool(
    "lore_cancel_local_task",
    `Stops a locally-running background worktree task: kills the process, removes the worktree, and marks it cancelled. Instead of this: to cancel a server-side GKE pipeline task use lore_cancel_task.`,
    {
      task_id: z.string(),
    },
    async (args) => {
      try {
        const { cancelLocalTask } =
          await import("../../features/pipeline/runner.local.js");
        const result = cancelLocalTask(args.task_id);

        return {
          content: [
            {
              type: "text" as const,
              text: result.cancelled
                ? `Task ${args.task_id} cancelled. Worktree cleaned up.`
                : `Could not cancel: ${result.error}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${errorMessage(err)}` },
          ],
        };
      }
    },
  );
}

function registerClaimAndRunLocallyTool(server: McpServer) {
  server.tool(
    "lore_claim_and_run_locally",
    `Claims an EXISTING pending pipeline task by id and runs it on your local machine (your Claude subscription), then removes it from the pending list. ingest-* types run in-process with no worktree; all others spawn a background Claude Code worktree task and return task id, branch, log file, and PID. Instead of this: to start a BRAND-NEW task from a description use lore_run_task_locally; to register a task for the GKE agent use lore_create_pipeline_task.`,
    CLAIM_AND_RUN_LOCALLY_INPUT,
    async (args) => {
      try {
        const { spawnLocalTask, getRepoRoot, skipTask, listPendingTasks } =
          await import("../../features/pipeline/runner.local.js");

        // Find the task in local pending list first, then fall back to API
        const pending = listPendingTasks();
        let task = pending.find(
          (t) => t.id === args.task_id || t.id.startsWith(args.task_id),
        );

        // If not in local cache, try fetching from API (supports cross-repo tasks)
        if (!task) {
          task = await fetchPendingTaskFromApi(args.task_id);
        }

        if (!task) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Task ${args.task_id} not found or not in pending status. Run lore_list_pending_tasks first.`,
              },
            ],
          };
        }

        // Claim via API (best effort)
        const apiUrl = process.env.LORE_API_URL || "";
        const token = process.env.LORE_INGEST_TOKEN || "";

        if (apiUrl && token) {
          try {
            await fetch(`${apiUrl}/api/task`, {
              signal: AbortSignal.timeout(30_000),
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                task_id: task.id,
                action: "claim",
                claimed_by: "local-runner",
              }),
            });
          } catch {
            /* best effort */
          }
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
          content: [
            {
              type: "text" as const,
              text: `Claimed and running locally.\n\nTask: ${task.id}\nBranch: ${localTask.branch}\nLogs: ${localTask.logFile}\nPID: ${localTask.pid}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${errorMessage(err)}` },
          ],
        };
      }
    },
  );
}

function registerConfigureLocalRunnerTool(server: McpServer) {
  server.tool(
    "lore_configure_local_runner",
    `Views or updates the local runner config on your machine; returns current config as JSON when called with no arguments, or writes provided fields and returns 'Config updated:' + JSON. Controls which repos/task-types the local notifier watches and local concurrency/model limits. To run work locally use lore_run_task_locally (new task) or lore_claim_and_run_locally (existing task).`,
    CONFIGURE_LOCAL_RUNNER_INPUT,
    async (args) => {
      try {
        const { readConfig, writeConfig } =
          await import("../../features/pipeline/runner.local.js");
        const config = readConfig();

        // If no args provided, return current config
        const noRepoOrTypeArgs = !args.repos && !args.task_types;
        const noArgsProvided =
          !args.max_concurrent && noRepoOrTypeArgs && !args.model;

        if (noArgsProvided) {
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(config, null, 2) },
            ],
          };
        }

        // Update provided fields
        if (args.max_concurrent !== undefined) {
          config.max_concurrent = args.max_concurrent;
        }

        if (args.repos) {
          config.repos = args.repos;
        }

        if (args.task_types) {
          config.task_types = args.task_types;
        }

        if (args.model) {
          config.model = args.model;
        }

        writeConfig(config);

        return {
          content: [
            {
              type: "text" as const,
              text: `Config updated:\n${JSON.stringify(config, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${errorMessage(err)}` },
          ],
        };
      }
    },
  );
}
