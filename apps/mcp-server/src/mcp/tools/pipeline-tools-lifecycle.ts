import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import {
  unreachableError,
  deniedError,
  notConfiguredError,
  textResult,
  proxyGetApi,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import {
  type ToolText,
  isAuthDenied,
  resolveApiCredentials,
} from "./pipeline-tools-shared.js";
import {
  CREATE_PIPELINE_TASK_INPUT,
  GET_PR_STATUS_INPUT,
} from "./pipeline-tools-schemas.js";

interface CreateTaskArgs {
  description: string;
  task_type: string;
  target_repo?: string;
  priority: "normal" | "immediate";
  group_id?: string;
  context?: unknown;
}

function resolveTaskRepo(targetRepo: string | undefined): string | undefined {
  return targetRepo || detectCurrentRepo() || undefined;
}

async function postTask(
  apiUrl: string,
  apiToken: string,
  args: CreateTaskArgs,
  resolvedRepo: string | undefined,
): Promise<Response> {
  return await fetch(`${apiUrl}/api/task`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: args.description,
      task_type: args.task_type,
      target_repo: resolvedRepo,
      priority: args.priority,
      group_id: args.group_id,
      context: args.context,
    }),
  });
}

/** The uuid plus what to do next — the pickup hint differs by priority, which is the one thing a caller cannot read off the id. */
async function createdResult(
  res: Response,
  args: CreateTaskArgs,
  resolvedRepo: string | undefined,
) {
  const result = (await res.json()) as {
    task_id?: string;
    task_type?: string;
  };
  const pickup =
    args.priority === "immediate"
      ? "The GKE agent will pick this up within 30 seconds."
      : "Task added to backlog. Claim it locally with lore_claim_and_run_locally, or set priority to immediate via the UI.";

  invalidateCache([
    "lore_list_pipeline_tasks",
    "lore_list_pending_tasks",
    "lore_get_pipeline_status",
  ]);

  return textResult(
    `Task created: ${result.task_id}\nType: ${result.task_type || args.task_type}\nPriority: ${args.priority}\nRepo: ${resolvedRepo || "default"}\n\n${pickup}`,
  );
}

async function refusalResult(res: Response) {
  if (isAuthDenied(res.status)) {
    return deniedError("creating a pipeline task", res.statusText);
  }
  const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
    error?: string;
  };

  return textResult(
    `Remote task creation failed: ${err.error || res.statusText}`,
  );
}

async function createPipelineTask(args: CreateTaskArgs) {
  // Refused before anything else: onboarding's duplicate guard lives inside lore_onboard_repo's own transaction (#968).
  if (args.task_type === "onboard") {
    return textResult(
      "Onboard tasks are not created here — use lore_onboard_repo, which refuses a repo that is already onboarded or has an onboard task in flight.",
    );
  }
  const creds = resolveApiCredentials();

  if (!creds) {
    return notConfiguredError("creating a pipeline task");
  }
  // The adapter holds no pool: the remote API is the only writer.
  const resolvedRepo = resolveTaskRepo(args.target_repo);

  try {
    const res = await postTask(creds.apiUrl, creds.token, args, resolvedRepo);

    return res.ok
      ? await createdResult(res, args, resolvedRepo)
      : await refusalResult(res);
  } catch (err) {
    return unreachableError("creating a pipeline task", errorMessage(err));
  }
}

function registerCreatePipelineTaskTool(server: McpServer) {
  server.tool(
    "lore_create_pipeline_task",
    "Enqueues a new server-side pipeline task and returns its UUID and a pickup hint. priority=normal lands in the backlog; priority=immediate the GKE agent picks up within ~30s. This tool only enqueues — it never runs anything on your machine. Instead: lore_run_task_locally to start a new ad-hoc task in a local worktree NOW; lore_claim_and_run_locally to run an existing backlog task locally; lore_sync_tasks to materialize a tasks.md checklist as spec-tasks (not this tool).",
    CREATE_PIPELINE_TASK_INPUT,
    async (args) => await createPipelineTask(args as CreateTaskArgs),
  );
}

async function fetchPipelineStatusText(taskId: string): Promise<ToolText> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return notConfiguredError("getting pipeline status");
  }

  let res: Response;

  try {
    res = await fetch(`${creds.apiUrl}/api/task/${taskId}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${creds.token}` },
    });
  } catch (err) {
    return unreachableError("getting pipeline status", errorMessage(err));
  }

  if (isAuthDenied(res.status)) {
    return deniedError("getting pipeline status", res.statusText);
  }

  if (!res.ok) {
    return textResult(`Remote error: ${res.statusText}`);
  }

  return textResult(JSON.stringify(await res.json(), null, 2));
}

function registerGetPipelineStatusTool(server: McpServer) {
  server.tool(
    "lore_get_pipeline_status",
    "Returns one pipeline task's full record (status + ordered event timeline) as JSON, by UUID. Instead: lore_list_pipeline_tasks for a multi-task listing; lore_get_pr_status for the live GitHub PR/CI verdict; lore_get_task_logs for the execution transcript; lore_list_task_group for a group rollup.",
    {
      task_id: z.string(),
    },
    async ({ task_id }) => {
      try {
        return await fetchPipelineStatusText(task_id);
      } catch (err) {
        return textResult(
          `Error getting pipeline status: ${errorMessage(err)}`,
        );
      }
    },
  );
}

function registerGetPrStatusTool(server: McpServer) {
  server.tool(
    "lore_get_pr_status",
    "Fetches live PR state from GitHub and returns a derived computed_status (merged | closed | draft | checks-failing | changes-requested | approved | open) plus CI checks and reviews. Use this for the real-time PR/CI/review verdict. Instead: lore_get_pipeline_status for the Lore task's stored status and event timeline.",
    GET_PR_STATUS_INPUT,
    async ({ repo, pr_number }) => {
      try {
        const params = new URLSearchParams({
          repo,
          pr_number: String(pr_number),
        });
        const proxied = await proxyGetApi(`/api/pr-status?${params}`);

        if (proxied.ok) {
          return textResult(JSON.stringify(JSON.parse(proxied.body), null, 2));
        }

        if (proxied.reason === "not_configured") {
          return notConfiguredError("getting PR status");
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_get_pr_status", proxied.detail);
        }

        // A read with no local fallback: surface the server's reason plainly rather than the write-oriented "unreachable" copy.
        return textResult(
          `Could not fetch PR status from the Lore API: ${proxied.detail}`,
        );
      } catch (err) {
        return textResult(`Error getting PR status: ${errorMessage(err)}`);
      }
    },
  );
}

export function registerPipelineLifecycleTools(server: McpServer) {
  registerCreatePipelineTaskTool(server);
  registerGetPipelineStatusTool(server);
  registerGetPrStatusTool(server);
}
