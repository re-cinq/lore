import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult, proxyGetApi, proxyToApi } from "./deps.js";
import {
  proxiedText,
  type TaskGroupResponse,
} from "./pipeline-tools-shared.js";
import {
  LIST_PIPELINE_TASKS_INPUT,
  LIST_TASK_GROUP_INPUT,
} from "./pipeline-tools-schemas.js";

function registerListPipelineTasksTool(server: McpServer) {
  server.tool(
    "lore_list_pipeline_tasks",
    "Lists pipeline tasks newest-first as JSON, optionally filtered by status. General browse view across all tasks and statuses. Instead: lore_list_pending_tasks for unclaimed work to grab locally; lore_ready_tasks for dependency-ready spec-tasks in one repo; lore_list_task_group for one feature's group; lore_list_local_tasks for tasks running on your machine.",
    LIST_PIPELINE_TASKS_INPUT,
    async ({ status, limit, offset }) => {
      try {
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;

        if (!apiUrl || !apiToken) {
          return textResult(
            "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access.",
          );
        }
        const params = new URLSearchParams();

        if (status) {
          params.set("status", status);
        }
        params.set("limit", String(Math.min(limit, 100)));
        params.set("offset", String(offset));
        const res = await fetch(`${apiUrl}/api/tasks?${params}`, {
          signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${apiToken}` },
        });

        if (!res.ok) {
          return textResult(`Remote error: ${res.statusText}`);
        }

        return textResult(JSON.stringify(await res.json(), null, 2));
      } catch (err) {
        return textResult(`Error listing pipeline tasks: ${errorMessage(err)}`);
      }
    },
  );
}

function registerCancelTaskTool(server: McpServer) {
  server.tool(
    "lore_cancel_task",
    "Cancels a server-side pipeline task, flipping it to 'cancelled' and best-effort stopping any running GKE agent. Instead: lore_cancel_local_task to stop a task running in a local worktree; lore_retry_task to re-run a failed task rather than stop a live one. Rejected for tasks already in merged/failed/cancelled state.",
    {
      task_id: z.string(),
    },
    ({ task_id }) =>
      proxiedText(
        () => proxyToApi("/api/task", { action: "cancel", task_id }),
        {
          op: "cancelling a task",
          toolName: "lore_cancel_task",
          render: (body) => JSON.stringify(body),
        },
      ),
  );
}

function registerRetryTaskTool(server: McpServer) {
  server.tool(
    "lore_retry_task",
    "Re-runs a failed or escalated task by cloning it into a new pipeline task linked via retry_of. Only tasks in 'failed' or 'needs-human-help' state are retryable. Instead: lore_cancel_task to stop an unwanted live task rather than re-run it.",
    {
      task_id: z.string(),
    },
    ({ task_id }) =>
      proxiedText(() => proxyToApi("/api/task", { action: "retry", task_id }), {
        op: "retrying a task",
        toolName: "lore_retry_task",
        render: (body) => JSON.stringify(body),
      }),
  );
}

function registerListTaskGroupTool(server: McpServer) {
  server.tool(
    "lore_list_task_group",
    "Lists every task in one task_group_id with a completed/total rollup — the view for a single multi-repo feature's progress. Instead: lore_list_pipeline_tasks for an unscoped newest-first listing of all tasks.",
    LIST_TASK_GROUP_INPUT,
    ({ group_id }) =>
      proxiedText(
        () => proxyGetApi(`/api/task-groups/${encodeURIComponent(group_id)}`),
        {
          op: "listing a task group",
          toolName: "lore_list_task_group",
          subject: "the task group",
          render: (body) => {
            const group = body as TaskGroupResponse;

            return group.total === 0
              ? `No tasks found for group ${group_id}`
              : `Group ${group_id}: ${group.completed}/${group.total} completed\n\n${JSON.stringify(group.tasks, null, 2)}`;
          },
        },
      ),
  );
}

export function registerPipelineListingTools(server: McpServer) {
  registerListPipelineTasksTool(server);
  registerCancelTaskTool(server);
  registerRetryTaskTool(server);
  registerListTaskGroupTool(server);
}
