import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import {
  type ApiCredentials,
  type RemoteTaskLite,
  resolveApiCredentials,
} from "./shared/pipeline-api.js";

const LIST_PENDING_TASKS_INPUT = {
  repo: z
    .string()
    .optional()
    .describe("'owner/repo' filter for the API view. Omit for all repos."),
};

export function registerListPendingTasksTool(server: McpServer) {
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
    await import("../../../work/pipeline/runner.local.js");
  const allTasks = listPendingTasks();

  return filterRepo
    ? allTasks.filter((t) => t.target_repo === filterRepo)
    : allTasks;
}

/** The pending-task list via the API, grouped by repo; null when the API is unavailable. */
async function listPendingTasksViaApi(
  filterRepo: string | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }> } | null> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return null;
  }
  const fetched = await fetchPendingTasks(creds);

  if (!fetched) {
    return null;
  }
  const tasks = filterByRepo(fetched, filterRepo);

  if (tasks.length === 0) {
    return textResult(noPendingTasksMessage(filterRepo));
  }

  return textResult(formatPendingTasksByRepo(tasks));
}

/** Null means the API could not answer at all, which callers turn into a local fallback rather than an empty list. */
async function fetchPendingTasks(
  creds: ApiCredentials,
): Promise<RemoteTaskLite[] | null> {
  const resp = await fetch(
    `${creds.apiUrl}/api/tasks?status=pending&limit=50`,
    {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${creds.token}` },
    },
  );

  if (!resp.ok) {
    return null;
  }
  const body = (await resp.json()) as { tasks?: RemoteTaskLite[] };

  return body.tasks || [];
}

function filterByRepo(
  tasks: RemoteTaskLite[],
  filterRepo: string | undefined,
): RemoteTaskLite[] {
  return filterRepo ? tasks.filter((t) => t.target_repo === filterRepo) : tasks;
}

function noPendingTasksMessage(filterRepo: string | undefined): string {
  return filterRepo
    ? `No pending tasks for ${filterRepo}.`
    : "No pending tasks.";
}

function formatPendingTasksByRepo(tasks: RemoteTaskLite[]): string {
  const byRepo = new Map<string, RemoteTaskLite[]>();

  for (const t of tasks) {
    const r = t.target_repo || "unknown";
    const repoTasks = byRepo.get(r) ?? [];

    repoTasks.push(t);
    byRepo.set(r, repoTasks);
  }
  const sections: string[] = [];

  for (const [r, repoTasks] of byRepo) {
    const lines = repoTasks.map(
      (t) =>
        `  ${t.id.substring(0, 8)} ${t.task_type} ${t.issue_number ? "#" + t.issue_number + " " : ""}${(t.description || "").substring(0, 80)}`,
    );

    sections.push(`**${r}** (${repoTasks.length})\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}
