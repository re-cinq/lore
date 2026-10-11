import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  unreachableError,
  deniedError,
  unconfiguredError,
  textResult,
} from "./deps.js";
import {
  type ToolText,
  isAuthDenied,
  resolveApiCredentials,
} from "./pipeline-tools-shared.js";

export function registerPipelineLifecycleTools(server: McpServer) {
  registerGetPipelineStatusTool(server);
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

async function fetchPipelineStatusText(taskId: string): Promise<ToolText> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return unconfiguredError("getting pipeline status");
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

  return statusResponse(res);
}

// The task's stored status, or why it could not be read. A denial is distinguished from any other failure: one means the token is wrong, the other that the task or the API is.
async function statusResponse(res: Response) {
  if (isAuthDenied(res.status)) {
    return deniedError("getting pipeline status", res.statusText);
  }

  if (!res.ok) {
    return textResult(`Remote error: ${res.statusText}`);
  }

  return textResult(JSON.stringify(await res.json(), null, 2));
}
