import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { resolveAgentId } from "@re-cinq/lore-shared";
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

/** Reports parsing nothing as its own outcome, not as a sync of zero: an unparsed tasks.md is a markdown problem the caller can fix, while "synced 0" reads as the file being empty. */
function syncSummary(body: unknown, repo: string, specSlug: string): string {
  const sync = body as SyncTasksResponse;

  return sync.parsed === 0
    ? "No tasks found in the provided markdown."
    : `Synced ${sync.synced} tasks (${sync.created} new) for ${repo} / ${specSlug}.`;
}

// Materialises a spec's checklist as task rows. Idempotent, so running it again after editing tasks.md upserts rather than duplicating — which is what makes it safe to run once per spec, every time.
async function syncTasksHandler(args: {
  tasks_markdown: string;
  repo?: string;
  spec_slug: string;
}) {
  const resolvedRepo = args.repo || detectCurrentRepo();

  if (!resolvedRepo) {
    return undetectedRepoError();
  }
  const post = () =>
    proxyToApi("/api/spec-tasks/sync", { ...args, repo: resolvedRepo });

  return proxiedText(post, {
    op: "syncing spec-tasks",
    toolName: "lore_sync_tasks",
    render: (body) => syncSummary(body, resolvedRepo, args.spec_slug),
  });
}

function registerSyncTasksTool(server: McpServer) {
  server.tool(
    "lore_sync_tasks",
    "Parses a speckit tasks.md and idempotently upserts each checklist item as a spec-task row; returns a 'Synced N tasks (M new)' summary. Run once per spec before any claiming — this is the start of spec-driven multi-agent work. This tool does NOT claim, run, or evaluate readiness. After syncing: lore_ready_tasks to find workable items; lore_claim_task to lock one; lore_complete_task to finish it.",
    SYNC_TASKS_INPUT,
    syncTasksHandler,
  );
}

// The tasks whose dependencies have all completed — what a caller can start right now.
async function readyTasksHandler({ repo }: { repo?: string }) {
  const resolvedRepo = repo || detectCurrentRepo();

  if (!resolvedRepo) {
    return undetectedRepoError();
  }
  const params = new URLSearchParams({ repo: resolvedRepo });

  return proxiedText(() => proxyGetApi(`/api/spec-tasks/ready?${params}`), {
    op: "fetching ready tasks",
    toolName: "lore_ready_tasks",
    subject: "ready tasks",
    render: renderReadyTasks,
  });
}

// An empty list says WHY it is empty — completed, claimed, or blocked are three very different situations, and "no ready tasks" alone would read as an error.
function renderReadyTasks(body: unknown): string {
  const { tasks } = body as { tasks: RemoteTaskLite[] };

  if (tasks.length === 0) {
    return "No ready tasks. All tasks are either completed, claimed, or blocked by dependencies.";
  }
  const lines = tasks.map(
    (t) =>
      `- **${t.context_bundle?.spec_task_id}** (${t.id}): ${t.description}`,
  );

  return `## Ready tasks\n\n${lines.join("\n")}`;
}

function registerReadyTasksTool(server: McpServer) {
  server.tool(
    "lore_ready_tasks",
    "Lists spec-tasks that are 'pending' AND whose every dependency has completed — the items you can start right now. Spec-tasks must first be materialized with lore_sync_tasks; after picking one, lock it with lore_claim_task. Instead: lore_list_pipeline_tasks for a general status-filtered listing; lore_list_pending_tasks for unclaimed tasks across repos to run locally.",
    READY_TASKS_INPUT,
    readyTasksHandler,
  );
}

// Locks one pending task so exactly one agent owns it. A refused claim is not an error: the commonest cause is that another agent got there first, which is the mechanism working.
function claimTaskHandler({
  task_id,
  agent_id,
}: {
  task_id: string;
  agent_id?: string;
}) {
  const resolvedAgent = agent_id || resolveAgentId();
  const post = () =>
    proxyToApi("/api/spec-tasks/claim", { task_id, agent_id: resolvedAgent });

  return proxiedText(post, {
    op: "claiming a task",
    toolName: "lore_claim_task",
    render: (body) =>
      (body as { claimed: boolean }).claimed
        ? `Task ${task_id} claimed by ${resolvedAgent}.`
        : `Could not claim task ${task_id}. It may already be claimed or does not exist.`,
  });
}

function registerClaimTaskTool(server: McpServer) {
  server.tool(
    "lore_claim_task",
    "Atomically locks one 'pending' spec-task (flips it to 'running') so exactly one agent owns it. Use right before starting a task surfaced by lore_ready_tasks. Instead: lore_complete_task to mark it done afterward; lore_skip_task to dismiss a local notification without a server claim.",
    CLAIM_TASK_INPUT,
    claimTaskHandler,
  );
}

// Marks a running task done and says what that unblocked — the newly ready dependents are the reason a caller completes a task rather than just stopping.
function completeTaskHandler({ task_id }: { task_id: string }) {
  return proxiedText(
    () => proxyToApi("/api/spec-tasks/complete", { task_id }),
    {
      op: "completing a task",
      toolName: "lore_complete_task",
      render: (body) => renderCompletion(body, task_id),
    },
  );
}

// Only a RUNNING task can be completed, so a refusal names that as the likely cause rather than reporting a bare failure.
function renderCompletion(body: unknown, task_id: string): string {
  const result = body as { completed: boolean; unblocked: string[] };

  if (!result.completed) {
    return `Could not complete task ${task_id}. It may not be in 'running' state.`;
  }

  return result.unblocked.length > 0
    ? `Task ${task_id} completed.\n\nNewly unblocked tasks:\n${result.unblocked.map((u) => `- ${u}`).join("\n")}`
    : `Task ${task_id} completed.`;
}

function registerCompleteTaskTool(server: McpServer) {
  server.tool(
    "lore_complete_task",
    "Marks a claimed ('running') spec-task as 'completed' and returns which dependents are now unblocked. Only 'running' tasks can be completed. Instead: lore_ready_tasks to pick the next item; lore_skip_task to dismiss a local notification; lore_cancel_task to cancel rather than complete.",
    {
      task_id: z.string(),
    },
    completeTaskHandler,
  );
}

export function registerSpecTaskTools(server: McpServer) {
  registerSyncTasksTool(server);
  registerReadyTasksTool(server);
  registerClaimTaskTool(server);
  registerCompleteTaskTool(server);
}
