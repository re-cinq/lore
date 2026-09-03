import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Loose shape of a pipeline task as returned by the Lore API / pg rows. */
type RemoteTaskLite = {
  id: string;
  target_repo?: string;
  task_type?: string;
  issue_number?: number;
  description?: string;
  status?: string;
  context_bundle?: { spec_task_id?: string };
};
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
import {
  withReadCache,
  unreachableError,
  deniedError,
  notConfiguredError,
  proxyGetApi,
  proxyToApi,
  type ProxyResult,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";

type TaskGroupResponse = {
  total: number;
  completed: number;
  tasks: RemoteTaskLite[];
};
type SyncTasksResponse = { parsed: number; synced: number; created: number };
type ToolText = { content: [{ type: "text"; text: string }] };

function completeOnly(body: string): boolean {
  try {
    return (JSON.parse(body) as { complete?: boolean }).complete === true;
  } catch {
    return false;
  }
}

function toolText(text: string): ToolText {
  return { content: [{ type: "text" as const, text }] };
}

function undetectedRepoError(): ToolText {
  return toolText("Could not detect repo. Specify repo parameter.");
}

// Runs a proxied call and maps every failure (no pool per ADR-032: config gap, denial, outage) to its own tool text rather than a misleading "requires PostgreSQL".
async function proxiedText(
  call: () => Promise<ProxyResult>,
  {
    op,
    toolName,
    subject,
    render,
  }: {
    op: string;
    toolName: string;
    /** Set for reads: names what could not be fetched, with no write-loss copy. */
    subject?: string;
    render: (body: unknown) => string;
  },
): Promise<ToolText> {
  try {
    const proxied = await call();

    if (proxied.ok) {
      return toolText(render(JSON.parse(proxied.body)));
    }

    if (proxied.reason === "not_configured") {
      return notConfiguredError(op);
    }

    if (proxied.reason === "denied") {
      return deniedError(toolName, proxied.detail);
    }

    // A non-retriable status means the server answered and refused (e.g. 409); reporting "unreachable" would wrongly blame the network for the server's verdict.
    if (proxied.status) {
      return toolText(`The Lore API refused ${op}: ${proxied.detail}`);
    }

    return subject
      ? toolText(
          `Could not fetch ${subject} from the Lore API: ${proxied.detail}`,
        )
      : unreachableError(op, proxied.detail);
  } catch (err) {
    return toolText(`Error ${op}: ${errorMessage(err)}`);
  }
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

/** The pending-task list via the API, grouped by repo; null when the API is unavailable. */
async function listPendingTasksViaApi(
  filterRepo: string | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }> } | null> {
  const apiUrl = process.env.LORE_API_URL || "";
  const token = process.env.LORE_INGEST_TOKEN || "";

  if (!(apiUrl && token)) {
    return null;
  }
  const resp = await fetch(`${apiUrl}/api/tasks?status=pending&limit=50`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    return null;
  }
  const body = (await resp.json()) as { tasks?: RemoteTaskLite[] };
  const remoteTasks = body.tasks || [];
  const tasks = filterRepo
    ? remoteTasks.filter((t) => t.target_repo === filterRepo)
    : remoteTasks;

  if (tasks.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: filterRepo
            ? `No pending tasks for ${filterRepo}.`
            : "No pending tasks.",
        },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: formatPendingTasksByRepo(tasks) }],
  };
}

export function registerPipelineTools(server: McpServer) {
  server.tool(
    "lore_create_pipeline_task",
    "Enqueues a new server-side pipeline task and returns its UUID and a pickup hint. priority=normal lands in the backlog; priority=immediate the GKE agent picks up within ~30s. This tool only enqueues — it never runs anything on your machine. Instead: lore_run_task_locally to start a new ad-hoc task in a local worktree NOW; lore_claim_and_run_locally to run an existing backlog task locally; lore_sync_tasks to materialize a tasks.md checklist as spec-tasks (not this tool).",
    {
      description: z
        .string()
        .min(1)
        .max(10000)
        .refine((v) => v.trim().length > 0, {
          message: "description cannot be blank",
        })
        .describe(
          "Primary natural-language instruction; be specific. Max 10000 chars; non-empty.",
        ),
      task_type: z
        .string()
        .default("general")
        .describe(
          "feature-request | general | runbook | implementation | gap-fill | review. Unknown values fall back to 'general'. 'onboard' is refused here — use lore_onboard_repo, which guards against duplicate onboarding.",
        ),
      target_repo: z
        .string()
        .optional()
        .describe("'owner/repo'. Auto-detected from git remote when omitted."),
      priority: z
        .enum(["normal", "immediate"])
        .default("normal")
        .describe(
          "'normal' = backlog; 'immediate' = GKE agent auto-executes within ~30s.",
        ),
      group_id: z
        .string()
        .optional()
        .describe(
          "Task-group UUID to link this task into a multi-repo feature rollup (see lore_list_task_group).",
        ),
      context: z
        .object({
          spec_file: z.boolean().optional(),
          branch: z.string().optional(),
          seed_query: z.string().optional(),
        })
        .optional()
        .describe(
          "Optional context for the agent: spec_file, branch, seed_query.",
        ),
    },
    async ({
      description: desc,
      task_type,
      target_repo,
      priority,
      group_id,
      context,
    }) => {
      try {
        // Refused before the local/remote split: onboarding's duplicate guard lives inside lore_onboard_repo's own transaction (#968).
        if (task_type === "onboard") {
          return {
            content: [
              {
                type: "text" as const,
                text: "Onboard tasks are not created here — use lore_onboard_repo, which refuses a repo that is already onboarded or has an onboard task in flight.",
              },
            ],
          };
        }

        // Auto-detect repo from git remote if not specified
        const resolvedRepo = target_repo || detectCurrentRepo() || undefined;

        // The adapter holds no pool: the remote API is the only writer.
        {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;

          if (!apiUrl || !apiToken) {
            return notConfiguredError("creating a pipeline task");
          }

          let res: Response;

          try {
            res = await fetch(`${apiUrl}/api/task`, {
              signal: AbortSignal.timeout(30_000),
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                description: desc,
                task_type,
                target_repo: resolvedRepo,
                priority,
                group_id,
                context,
              }),
            });
          } catch (err) {
            return unreachableError(
              "creating a pipeline task",
              errorMessage(err),
            );
          }

          if (res.status === 401 || res.status === 403) {
            return deniedError("creating a pipeline task", res.statusText);
          }

          if (!res.ok) {
            const err = await res
              .json()
              .catch(() => ({ error: res.statusText }));

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Remote task creation failed: ${(err as { error?: string }).error || res.statusText}`,
                },
              ],
            };
          }
          const result = (await res.json()) as {
            error?: string;
            task_id?: string;
            [k: string]: unknown;
          };
          const pickupMsg =
            priority === "immediate"
              ? "The GKE agent will pick this up within 30 seconds."
              : "Task added to backlog. Claim it locally with lore_claim_and_run_locally, or set priority to immediate via the UI.";
          const msg = `Task created: ${result.task_id}\nType: ${result.task_type || task_type}\nPriority: ${priority}\nRepo: ${resolvedRepo || "default"}\n\n${pickupMsg}`;

          invalidateCache([
            "lore_list_pipeline_tasks",
            "lore_list_pending_tasks",
            "lore_get_pipeline_status",
          ]);

          return { content: [{ type: "text" as const, text: msg }] };
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating pipeline task: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_get_pipeline_status",
    "Returns one pipeline task's full record (status + ordered event timeline) as JSON, by UUID. Instead: lore_list_pipeline_tasks for a multi-task listing; lore_get_pr_status for the live GitHub PR/CI verdict; lore_get_task_logs for the execution transcript; lore_list_task_group for a group rollup.",
    {
      task_id: z.string(),
    },
    async ({ task_id }) => {
      try {
        {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;

          if (!apiUrl || !apiToken) {
            return notConfiguredError("getting pipeline status");
          }

          let res: Response;

          try {
            res = await fetch(`${apiUrl}/api/task/${task_id}`, {
              signal: AbortSignal.timeout(30_000),
              headers: { Authorization: `Bearer ${apiToken}` },
            });
          } catch (err) {
            return unreachableError(
              "getting pipeline status",
              errorMessage(err),
            );
          }

          if (res.status === 401 || res.status === 403) {
            return deniedError("getting pipeline status", res.statusText);
          }

          if (!res.ok) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Remote error: ${res.statusText}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await res.json(), null, 2),
              },
            ],
          };
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting pipeline status: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_get_pr_status",
    "Fetches live PR state from GitHub and returns a derived computed_status (merged | closed | draft | checks-failing | changes-requested | approved | open) plus CI checks and reviews. Use this for the real-time PR/CI/review verdict. Instead: lore_get_pipeline_status for the Lore task's stored status and event timeline.",
    {
      repo: z.string().describe("'owner/repo'"),
      pr_number: z
        .number()
        .describe("PR number (integer from the PR URL, not a UUID)."),
    },
    async ({ repo, pr_number }) => {
      try {
        const params = new URLSearchParams({
          repo,
          pr_number: String(pr_number),
        });
        const proxied = await proxyGetApi(`/api/pr-status?${params}`);

        if (proxied.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(JSON.parse(proxied.body), null, 2),
              },
            ],
          };
        }

        if (proxied.reason === "not_configured") {
          return notConfiguredError("getting PR status");
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_get_pr_status", proxied.detail);
        }

        // A read with no local fallback: surface the server's reason plainly rather than the write-oriented "unreachable" copy.
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not fetch PR status from the Lore API: ${proxied.detail}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting PR status: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_list_pipeline_tasks",
    "Lists pipeline tasks newest-first as JSON, optionally filtered by status. General browse view across all tasks and statuses. Instead: lore_list_pending_tasks for unclaimed work to grab locally; lore_ready_tasks for dependency-ready spec-tasks in one repo; lore_list_task_group for one feature's group; lore_list_local_tasks for tasks running on your machine.",
    {
      status: z
        .string()
        .optional()
        .describe(
          "Filter by status: pending | queued | running | pr-created | review | merged | failed | cancelled. Omit for all.",
        ),
      limit: z.number().default(20),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          "Skip this many newest-first rows for paging. Response carries total so you know if more remain.",
        ),
    },
    async ({ status, limit, offset }) => {
      try {
        {
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;

          if (!apiUrl || !apiToken) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access.",
                },
              ],
            };
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
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Remote error: ${res.statusText}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await res.json(), null, 2),
              },
            ],
          };
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing pipeline tasks: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

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

  server.tool(
    "lore_list_task_group",
    "Lists every task in one task_group_id with a completed/total rollup — the view for a single multi-repo feature's progress. Instead: lore_list_pipeline_tasks for an unscoped newest-first listing of all tasks.",
    {
      group_id: z
        .string()
        .describe(
          "Task-group UUID (the value passed as group_id to lore_create_pipeline_task).",
        ),
    },
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

  server.tool(
    "lore_sync_tasks",
    "Parses a speckit tasks.md and idempotently upserts each checklist item as a spec-task row; returns a 'Synced N tasks (M new)' summary. Run once per spec before any claiming — this is the start of spec-driven multi-agent work. This tool does NOT claim, run, or evaluate readiness. After syncing: lore_ready_tasks to find workable items; lore_claim_task to lock one; lore_complete_task to finish it.",
    {
      tasks_markdown: z
        .string()
        .describe(
          "Full markdown text of the tasks.md document (not a path). Parsed for phases, [P] parallel markers, [DEPENDS ON: …] deps, and file-path suffixes.",
        ),
      repo: z
        .string()
        .optional()
        .describe("'owner/repo'. Auto-detected from git remote when omitted."),
      spec_slug: z
        .string()
        .describe("Feature slug grouping these spec-tasks within the repo."),
    },
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

  server.tool(
    "lore_ready_tasks",
    "Lists spec-tasks that are 'pending' AND whose every dependency has completed — the items you can start right now. Spec-tasks must first be materialized with lore_sync_tasks; after picking one, lock it with lore_claim_task. Instead: lore_list_pipeline_tasks for a general status-filtered listing; lore_list_pending_tasks for unclaimed tasks across repos to run locally.",
    {
      repo: z
        .string()
        .optional()
        .describe("'owner/repo'. Auto-detected from git remote when omitted."),
    },
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

  server.tool(
    "lore_claim_task",
    "Atomically locks one 'pending' spec-task (flips it to 'running') so exactly one agent owns it. Use right before starting a task surfaced by lore_ready_tasks. Instead: lore_complete_task to mark it done afterward; lore_skip_task to dismiss a local notification without a server claim.",
    {
      task_id: z.string(),
      agent_id: z
        .string()
        .optional()
        .describe("Claiming agent identifier. Auto-resolved when omitted."),
    },
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

  server.tool(
    "lore_get_task_logs",
    "Fetches one pipeline task's execution transcript (by UUID), returning {logs, next_offset, complete, cursor?}. Tasks with recorded agent turns return NDJSON — one {source, event} stream-json envelope per line from the turn store; tasks with no recorded turns fall back to the raw captured output. Responses may be capped: pass next_offset back as offset (and cursor back verbatim, when present) and poll until complete is true. Instead: lore_get_job_logs (job_name + run_id) for scheduled CronJob run logs.",
    {
      task_id: z.string(),
      offset: z
        .number()
        .default(0)
        .describe(
          "UTF-16 code-unit offset (not bytes) into the flattened transcript; pass previous next_offset to poll incrementally.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "Opaque resume cursor from the previous response; pass it back only together with that response's next_offset as offset. Omit it when reading from any other offset.",
        ),
    },
    async ({ task_id, offset, cursor }) => {
      try {
        // Logs live server-side; the API resolves the task's repo from task_id since the local adapter holds no DB to look it up.
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;

        if (!apiUrl || !apiToken) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Task logs require LORE_API_URL.",
              },
            ],
          };
        }
        const params = new URLSearchParams({ task_id, offset: String(offset) });

        if (cursor !== undefined) {
          params.set("cursor", cursor);
        }
        const proxied = await withReadCache(
          {
            tool: "lore_get_task_logs",
            args:
              cursor === undefined
                ? { task_id, offset }
                : { task_id, offset, cursor },
            ttlSeconds: 86400,
          },
          async () => {
            const res = await fetch(`${apiUrl}/api/task-logs?${params}`, {
              signal: AbortSignal.timeout(30_000),
              headers: { Authorization: `Bearer ${apiToken}` },
            });

            if (res.ok) {
              return {
                ok: true as const,
                body: JSON.stringify(await res.json()),
              };
            }
            const detail = `HTTP ${res.status} ${res.statusText}`;

            if (res.status === 401 || res.status === 403) {
              return { ok: false as const, reason: "denied" as const, detail };
            }

            return {
              ok: false as const,
              reason: "unreachable" as const,
              detail,
            };
          },
          { label: false, cacheIf: completeOnly },
        );

        if (proxied.ok) {
          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_get_task_logs", proxied.detail);
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_get_task_logs", proxied.detail);
        }

        return {
          content: [
            { type: "text" as const, text: "Task logs require LORE_API_URL." },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting task logs: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_get_job_logs",
    "Fetches the full stdout/stderr of one scheduled CronJob run (keyed by job_name + run_id), returning {logs, complete:true}. Use for scheduled jobs like context_reindex or spec_test_linker. Instead: lore_get_task_logs for a user-created pipeline task's logs (by UUID).",
    {
      job_name: z
        .string()
        .describe(
          "Scheduled job name, e.g. 'context_reindex' or 'spec_test_linker'.",
        ),
      run_id: z.string().describe("Run UUID from pipeline.job_runs."),
    },
    async ({ job_name, run_id }) => {
      try {
        // Proxy log reads to the remote API (logs live server-side in GCS).
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;

        if (!apiUrl || !apiToken) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Job-run logs require LORE_API_URL.",
              },
            ],
          };
        }
        const params = new URLSearchParams({ job_name, run_id });
        const proxied = await withReadCache(
          {
            tool: "lore_get_job_logs",
            args: { job_name, run_id },
            ttlSeconds: 86400,
          },
          async () => {
            const res = await fetch(`${apiUrl}/api/job-run-logs?${params}`, {
              signal: AbortSignal.timeout(30_000),
              headers: { Authorization: `Bearer ${apiToken}` },
            });

            if (res.ok) {
              return {
                ok: true as const,
                body: JSON.stringify(await res.json()),
              };
            }
            const detail = `HTTP ${res.status} ${res.statusText}`;

            if (res.status === 401 || res.status === 403) {
              return { ok: false as const, reason: "denied" as const, detail };
            }

            return {
              ok: false as const,
              reason: "unreachable" as const,
              detail,
            };
          },
          { label: false, cacheIf: completeOnly },
        );

        if (proxied.ok) {
          return { content: [{ type: "text" as const, text: proxied.body }] };
        }

        if (proxied.reason === "denied") {
          return deniedError("lore_get_job_logs", proxied.detail);
        }

        if (proxied.reason === "unreachable") {
          return unreachableError("lore_get_job_logs", proxied.detail);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: "Job-run logs require LORE_API_URL.",
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting job logs: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_list_pending_tasks",
    "Shows unclaimed 'pending' backlog tasks grouped by repo — the 'what can I grab' view. Falls back to ~/.lore/pending-tasks.json (local notifier cache) when the API is unreachable; the repo filter applies on both paths. After choosing one, run it with lore_claim_and_run_locally. Instead: lore_list_pipeline_tasks for a general status-filterable listing; lore_ready_tasks for dependency-ready spec-tasks in one repo.",
    {
      repo: z
        .string()
        .optional()
        .describe("'owner/repo' filter for the API view. Omit for all repos."),
    },
    async ({ repo: filterRepo }) => {
      try {
        // Try API first for global view (all repos)
        const apiListing = await listPendingTasksViaApi(filterRepo);

        if (apiListing) {
          return apiListing;
        }
        // Fallback to local pending file
        const { listPendingTasks } =
          await import("../../features/pipeline/runner.local.js");
        const allTasks = listPendingTasks();
        const tasks = filterRepo
          ? allTasks.filter((t) => t.target_repo === filterRepo)
          : allTasks;

        if (tasks.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: filterRepo
                  ? `No pending tasks for ${filterRepo}.`
                  : "No pending tasks.",
              },
            ],
          };
        }
        const lines = tasks.map(
          (t) =>
            `${t.id.substring(0, 8)} ${t.task_type} ${t.target_repo}${t.issue_number ? " #" + t.issue_number : ""}\n  ${t.description}`,
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n\n") }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing pending tasks: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_skip_task",
    "Removes one task from the local ~/.lore/pending-tasks.json notification cache so it stops appearing in the statusline. Local only — does NOT change server state (task stays 'pending'). Instead: lore_cancel_task to cancel server-side; lore_complete_task to mark a claimed spec-task done.",
    {
      task_id: z.string(),
    },
    async (args) => {
      try {
        const { skipTask } =
          await import("../../features/pipeline/runner.local.js");

        skipTask(args.task_id);

        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${args.task_id} skipped. GKE will handle it.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error skipping task: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_enable_task_notifications",
    "Starts a local background poller that watches repos for new 'pending' pipeline tasks and writes matches to ~/.lore/pending-tasks.json for the statusline. Idempotent — returns 'already active' if running. To stop it: lore_disable_task_notifications. To run a surfaced task: lore_claim_and_run_locally. To dismiss one: lore_skip_task.",
    {
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
    },
    async (args) => {
      try {
        const { startNotifier, detectRepo, isNotifierRunning } =
          await import("../../features/pipeline/runner.local.js");

        if (isNotifierRunning()) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Task notifications already active.",
              },
            ],
          };
        }
        const repos =
          args.repos || ([detectRepo()].filter(Boolean) as string[]);

        if (repos.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: no repos to watch. Pass repos explicitly or run from a git repo with a GitHub remote.",
              },
            ],
          };
        }
        const taskTypes = args.task_types || [
          "implementation",
          "general",
          "runbook",
          "gap-fill",
        ];

        startNotifier(repos, taskTypes);

        return {
          content: [
            {
              type: "text" as const,
              text: `Watching for pending tasks on ${repos.join(", ")}.\nTypes: ${taskTypes.join(", ")}\nCheck the statusline for new tasks.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error enabling task notifications: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "lore_disable_task_notifications",
    "Stops the local pending-task notifier and removes the ~/.lore/pending-tasks.json cache. Undoes lore_enable_task_notifications. Idempotent.",
    {},
    async () => {
      try {
        const { stopNotifier } =
          await import("../../features/pipeline/runner.local.js");

        stopNotifier();

        return {
          content: [
            { type: "text" as const, text: "Task notifications stopped." },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error disabling task notifications: ${errorMessage(err)}`,
            },
          ],
        };
      }
    },
  );
}
