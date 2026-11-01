import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";

// The types a developer can actually pick up locally — a surfaced task nobody can run is noise on the statusline.
const LOCALLY_RUNNABLE_TASK_TYPES = ["runbook", "gap-fill"];

const ENABLE_TASK_NOTIFICATIONS_INPUT = {
  repos: z
    .array(z.string())
    .optional()
    .describe(
      "Repos to watch as 'owner/repo'. Defaults to current git remote.",
    ),
  task_types: z
    .array(z.string())
    .optional()
    .describe(
      "Task types to surface. Defaults to implementation, general, runbook, gap-fill.",
    ),
};

export function registerEnableTaskNotificationsTool(server: McpServer) {
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
    await import("../../../work/pipeline/runner.local.js");

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
  const { detectRepo } = await import("../../../work/pipeline/runner.local.js");
  const repos = explicit || ([detectRepo()].filter(Boolean) as string[]);

  return repos.length === 0 ? null : repos;
}

async function beginWatching(repos: string[], taskTypes: string[]) {
  const { startNotifier } =
    await import("../../../work/pipeline/runner.local.js");

  startNotifier(repos, taskTypes);

  return textResult(
    `Watching for pending tasks on ${repos.join(", ")}.\nTypes: ${taskTypes.join(", ")}\nCheck the statusline for new tasks.`,
  );
}
