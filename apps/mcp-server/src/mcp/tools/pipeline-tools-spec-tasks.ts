import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
import { proxyToApi, proxyGetApi } from "./deps.js";
import {
  proxiedText,
  undetectedRepoError,
  type RemoteTaskLite,
  type SyncTasksResponse,
} from "./pipeline-tools-shared.js";
import {
  SYNC_TASKS_INPUT,
  READY_TASKS_INPUT,
  CLAIM_TASK_INPUT,
} from "./pipeline-tools-schemas.js";

function registerSyncTasksTool(server: McpServer) {
  server.tool(
    "lore_sync_tasks",
    "Parses a speckit tasks.md and idempotently upserts each checklist item as a spec-task row; returns a 'Synced N tasks (M new)' summary. Run once per spec before any claiming — this is the start of spec-driven multi-agent work. This tool does NOT claim, run, or evaluate readiness. After syncing: lore_ready_tasks to find workable items; lore_claim_task to lock one; lore_complete_task to finish it.",
    SYNC_TASKS_INPUT,
    async ({ tasks_markdown, repo, spec_slug }) => {
      const resolvedRepo = repo || detectCurrentRepo();

      if (!resolvedRepo) {
        return undetectedRepoError();
      }

      return proxiedText(
        () =>
          proxyToApi("/api/spec-tasks/sync", {
            repo: resolvedRepo,
            spec_slug,
            tasks_markdown,
          }),
        {
          op: "syncing spec-tasks",
          toolName: "lore_sync_tasks",
          render: (body) => {
            const sync = body as SyncTasksResponse;

            return sync.parsed === 0
              ? "No tasks found in the provided markdown."
              : `Synced ${sync.synced} tasks (${sync.created} new) for ${resolvedRepo} / ${spec_slug}.`;
          },
        },
      );
    },
  );
}

function registerReadyTasksTool(server: McpServer) {
  server.tool(
    "lore_ready_tasks",
    "Lists spec-tasks that are 'pending' AND whose every dependency has completed — the items you can start right now. Spec-tasks must first be materialized with lore_sync_tasks; after picking one, lock it with lore_claim_task. Instead: lore_list_pipeline_tasks for a general status-filtered listing; lore_list_pending_tasks for unclaimed tasks across repos to run locally.",
    READY_TASKS_INPUT,
    async ({ repo }) => {
      const resolvedRepo = repo || detectCurrentRepo();

      if (!resolvedRepo) {
        return undetectedRepoError();
      }
      const params = new URLSearchParams({ repo: resolvedRepo });

      return proxiedText(() => proxyGetApi(`/api/spec-tasks/ready?${params}`), {
        op: "fetching ready tasks",
        toolName: "lore_ready_tasks",
        subject: "ready tasks",
        render: (body) => {
          const { tasks } = body as { tasks: RemoteTaskLite[] };

          if (tasks.length === 0) {
            return "No ready tasks. All tasks are either completed, claimed, or blocked by dependencies.";
          }
          const lines = tasks.map(
            (t) =>
              `- **${t.context_bundle?.spec_task_id}** (${t.id}): ${t.description}`,
          );

          return `## Ready tasks\n\n${lines.join("\n")}`;
        },
      });
    },
  );
}

function registerClaimTaskTool(server: McpServer) {
  server.tool(
    "lore_claim_task",
    "Atomically locks one 'pending' spec-task (flips it to 'running') so exactly one agent owns it. Use right before starting a task surfaced by lore_ready_tasks. Instead: lore_complete_task to mark it done afterward; lore_skip_task to dismiss a local notification without a server claim.",
    CLAIM_TASK_INPUT,
    ({ task_id, agent_id }) => {
      const resolvedAgent = agent_id || resolveAgentId();

      return proxiedText(
        () =>
          proxyToApi("/api/spec-tasks/claim", {
            task_id,
            agent_id: resolvedAgent,
          }),
        {
          op: "claiming a task",
          toolName: "lore_claim_task",
          render: (body) =>
            (body as { claimed: boolean }).claimed
              ? `Task ${task_id} claimed by ${resolvedAgent}.`
              : `Could not claim task ${task_id}. It may already be claimed or does not exist.`,
        },
      );
    },
  );
}

function registerCompleteTaskTool(server: McpServer) {
  server.tool(
    "lore_complete_task",
    "Marks a claimed ('running') spec-task as 'completed' and returns which dependents are now unblocked. Only 'running' tasks can be completed. Instead: lore_ready_tasks to pick the next item; lore_skip_task to dismiss a local notification; lore_cancel_task to cancel rather than complete.",
    {
      task_id: z.string(),
    },
    ({ task_id }) =>
      proxiedText(() => proxyToApi("/api/spec-tasks/complete", { task_id }), {
        op: "completing a task",
        toolName: "lore_complete_task",
        render: (body) => {
          const result = body as { completed: boolean; unblocked: string[] };

          if (!result.completed) {
            return `Could not complete task ${task_id}. It may not be in 'running' state.`;
          }

          return result.unblocked.length > 0
            ? `Task ${task_id} completed.\n\nNewly unblocked tasks:\n${result.unblocked.map((u) => `- ${u}`).join("\n")}`
            : `Task ${task_id} completed.`;
        },
      }),
  );
}

export function registerSpecTaskTools(server: McpServer) {
  registerSyncTasksTool(server);
  registerReadyTasksTool(server);
  registerClaimTaskTool(server);
  registerCompleteTaskTool(server);
}
