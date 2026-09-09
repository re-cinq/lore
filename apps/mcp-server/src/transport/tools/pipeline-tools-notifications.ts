import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "./deps.js";
import { listPendingTasksViaApi } from "./pipeline-tools-shared.js";
import {
  LIST_PENDING_TASKS_INPUT,
  ENABLE_TASK_NOTIFICATIONS_INPUT,
} from "./pipeline-tools-schemas.js";

// The types a developer can actually pick up locally — a surfaced task nobody can run is noise on the statusline.
const LOCALLY_RUNNABLE_TASK_TYPES = [
  "implementation",
  "general",
  "runbook",
  "gap-fill",
];

export function registerPipelineNotificationTools(server: McpServer) {
  registerListPendingTasksTool(server);
  registerSkipTaskTool(server);
  registerEnableTaskNotificationsTool(server);
  registerDisableTaskNotificationsTool(server);
}

function registerListPendingTasksTool(server: McpServer) {
  server.tool(
    "lore_list_pending_tasks",
    "Shows unclaimed 'pending' backlog tasks grouped by repo — the 'what can I grab' view. Falls back to ~/.lore/pending-tasks.json (local notifier cache) when the API is unreachable; the repo filter applies on both paths. After choosing one, run it with lore_claim_and_run_locally. Instead: lore_list_pipeline_tasks for a general status-filterable listing; lore_ready_tasks for dependency-ready spec-tasks in one repo.",
    LIST_PENDING_TASKS_INPUT,
    async ({ repo: filterRepo }) => {
      try {
        // Try API first for global view (all repos)
        const apiListing = await listPendingTasksViaApi(filterRepo);

        if (apiListing) {
          return apiListing;
        }

        return await pendingFromFile(filterRepo);
      } catch (err) {
        return textResult(`Error listing pending tasks: ${errorMessage(err)}`);
      }
    },
  );
}

/** The offline view, read from the notifier's own cache. It is the same list the API would serve, minus repos this machine has never seen — which is why the API is tried first rather than this. */
async function pendingFromFile(filterRepo?: string) {
  const tasks = await readPendingCache(filterRepo);

  if (tasks.length === 0) {
    return textResult(
      filterRepo ? `No pending tasks for ${filterRepo}.` : "No pending tasks.",
    );
  }

  return textResult(
    tasks
      .map(
        (t) =>
          `${t.id.substring(0, 8)} ${t.task_type} ${t.target_repo}${t.issue_number ? " #" + t.issue_number : ""}\n  ${t.description}`,
      )
      .join("\n\n"),
  );
}

/** The cache holds every repo the notifier watches, so the repo filter has to be applied here as well as on the API path. */
async function readPendingCache(filterRepo?: string) {
  const { listPendingTasks } =
    await import("../../work/pipeline/runner.local.js");
  const allTasks = listPendingTasks();

  return filterRepo
    ? allTasks.filter((t) => t.target_repo === filterRepo)
    : allTasks;
}

function registerSkipTaskTool(server: McpServer) {
  server.tool(
    "lore_skip_task",
    "Removes one task from the local ~/.lore/pending-tasks.json notification cache so it stops appearing in the statusline. Local only — does NOT change server state (task stays 'pending'). Instead: lore_cancel_task to cancel server-side; lore_complete_task to mark a claimed spec-task done.",
    {
      task_id: z.string(),
    },
    async (args) => {
      try {
        const { skipTask } =
          await import("../../work/pipeline/runner.local.js");

        skipTask(args.task_id);

        return textResult(`Task ${args.task_id} skipped. GKE will handle it.`);
      } catch (err) {
        return textResult(`Error skipping task: ${errorMessage(err)}`);
      }
    },
  );
}

function registerEnableTaskNotificationsTool(server: McpServer) {
  server.tool(
    "lore_enable_task_notifications",
    "Starts a local background poller that watches repos for new 'pending' pipeline tasks and writes matches to ~/.lore/pending-tasks.json for the statusline. Idempotent — returns 'already active' if running. To stop it: lore_disable_task_notifications. To run a surfaced task: lore_claim_and_run_locally. To dismiss one: lore_skip_task.",
    ENABLE_TASK_NOTIFICATIONS_INPUT,
    async (args) => {
      try {
        return await startTaskNotifier(args);
      } catch (err) {
        return textResult(
          `Error enabling task notifications: ${errorMessage(err)}`,
        );
      }
    },
  );
}

/** Starts the poller, defaulting to the repo the caller is standing in. */
async function startTaskNotifier(args: {
  repos?: string[];
  task_types?: string[];
}) {
  const { isNotifierRunning } =
    await import("../../work/pipeline/runner.local.js");

  if (isNotifierRunning()) {
    return textResult("Task notifications already active.");
  }
  const repos = await resolveNotifierRepos(args.repos);

  if (!repos) {
    return textResult(
      "Error: no repos to watch. Pass repos explicitly or run from a git repo with a GitHub remote.",
    );
  }

  return await beginWatching(
    repos,
    args.task_types || LOCALLY_RUNNABLE_TASK_TYPES,
  );
}

/** Null rather than an empty list: a notifier watching nothing would poll forever and surface nothing. */
async function resolveNotifierRepos(
  explicit?: string[],
): Promise<string[] | null> {
  const { detectRepo } = await import("../../work/pipeline/runner.local.js");
  const repos = explicit || ([detectRepo()].filter(Boolean) as string[]);

  return repos.length === 0 ? null : repos;
}

async function beginWatching(repos: string[], taskTypes: string[]) {
  const { startNotifier } = await import("../../work/pipeline/runner.local.js");

  startNotifier(repos, taskTypes);

  return textResult(
    `Watching for pending tasks on ${repos.join(", ")}.\nTypes: ${taskTypes.join(", ")}\nCheck the statusline for new tasks.`,
  );
}

function registerDisableTaskNotificationsTool(server: McpServer) {
  server.tool(
    "lore_disable_task_notifications",
    "Stops the local pending-task notifier and removes the ~/.lore/pending-tasks.json cache. Undoes lore_enable_task_notifications. Idempotent.",
    {},
    async () => {
      try {
        const { stopNotifier } =
          await import("../../work/pipeline/runner.local.js");

        stopNotifier();

        return textResult("Task notifications stopped.");
      } catch (err) {
        return textResult(
          `Error disabling task notifications: ${errorMessage(err)}`,
        );
      }
    },
  );
}
