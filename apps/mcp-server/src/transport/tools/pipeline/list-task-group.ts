import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyGetApi } from "../shared/deps.js";
import { proxiedText, type RemoteTaskLite } from "./shared/pipeline-api.js";

type TaskGroupResponse = {
  total: number;
  completed: number;
  tasks: RemoteTaskLite[];
};

const LIST_TASK_GROUP_INPUT = {
  group_id: z
    .string()
    .describe("Task-group UUID (a plan's spec-tasks share one)."),
};

export function registerListTaskGroupTool(server: McpServer) {
  server.tool(
    "lore_list_task_group",
    "Lists every task in one task_group_id with a completed/total rollup — the view for a single multi-repo feature's progress. Instead: lore_list_pipeline_tasks for an unscoped newest-first listing of all tasks.",
    LIST_TASK_GROUP_INPUT,
    ({ group_id }) => listTaskGroup(group_id),
  );
}

function listTaskGroup(groupId: string) {
  return proxiedText(
    () => proxyGetApi(`/api/task-groups/${encodeURIComponent(groupId)}`),
    {
      op: "listing a task group",
      toolName: "lore_list_task_group",
      subject: "the task group",
      render: (body) => renderTaskGroup(groupId, body),
    },
  );
}

/** An empty group is a real answer, not an error — a feature can be registered before any of its tasks are. */
function renderTaskGroup(groupId: string, body: unknown): string {
  const group = body as TaskGroupResponse;

  return group.total === 0
    ? `No tasks found for group ${groupId}`
    : `Group ${groupId}: ${group.completed}/${group.total} completed\n\n${JSON.stringify(group.tasks, null, 2)}`;
}
