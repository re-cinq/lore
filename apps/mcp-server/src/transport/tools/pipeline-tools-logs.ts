import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  withReadCache,
  unreachableError,
  deniedError,
  textResult,
  type ProxyResult,
} from "./deps.js";
import {
  type ToolText,
  completeOnly,
  isAuthDenied,
  resolveApiCredentials,
} from "./pipeline-tools-shared.js";
import {
  GET_TASK_LOGS_INPUT,
  GET_JOB_LOGS_INPUT,
} from "./pipeline-tools-schemas.js";

/** One fetch, classified into ok/denied/unreachable — the shape both log tools' `withReadCache` closures need. */
async function fetchLogsResult(
  url: string,
  apiToken: string,
): Promise<ProxyResult> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (res.ok) {
    return { ok: true, body: JSON.stringify(await res.json()) };
  }
  const detail = `HTTP ${res.status} ${res.statusText}`;

  if (isAuthDenied(res.status)) {
    return { ok: false, reason: "denied", detail };
  }

  return { ok: false, reason: "unreachable", detail };
}

/** fetchLogsResult only ever produces ok/denied/unreachable, but the shared ProxyResult type also carries not_configured — treated the same as unreachable here since the caller already returned early on missing credentials. */
function interpretLogsProxy(toolName: string, proxied: ProxyResult): ToolText {
  if (proxied.ok) {
    return textResult(proxied.body);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return unreachableError(
    toolName,
    proxied.reason === "unreachable" ? proxied.detail : "not configured",
  );
}

function buildTaskLogsParams(
  taskId: string,
  offset: number,
  cursor: string | undefined,
): URLSearchParams {
  const params = new URLSearchParams({
    task_id: taskId,
    offset: String(offset),
  });

  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }

  return params;
}

function registerGetTaskLogsTool(server: McpServer) {
  server.tool(
    "lore_get_task_logs",
    "Fetches one pipeline task's execution transcript (by UUID), returning {logs, next_offset, complete, cursor?}. Tasks with recorded agent turns return NDJSON — one {source, event} stream-json envelope per line from the turn store; tasks with no recorded turns fall back to the raw captured output. Responses may be capped: pass next_offset back as offset (and cursor back verbatim, when present) and poll until complete is true. Instead: lore_get_job_logs (job_name + run_id) for scheduled CronJob run logs.",
    GET_TASK_LOGS_INPUT,
    async ({ task_id, offset, cursor }) => {
      try {
        // Logs live server-side; the API resolves the task's repo from task_id since the local adapter holds no DB to look it up.
        const creds = resolveApiCredentials();

        if (!creds) {
          return textResult("Task logs require LORE_API_URL.");
        }
        const params = buildTaskLogsParams(task_id, offset, cursor);
        const proxied = await withReadCache(
          {
            tool: "lore_get_task_logs",
            args:
              cursor === undefined
                ? { task_id, offset }
                : { task_id, offset, cursor },
            ttlSeconds: 86400,
          },
          () =>
            fetchLogsResult(
              `${creds.apiUrl}/api/task-logs?${params}`,
              creds.token,
            ),
          { label: false, cacheIf: completeOnly },
        );

        return interpretLogsProxy("lore_get_task_logs", proxied);
      } catch (err) {
        return textResult(`Error getting task logs: ${errorMessage(err)}`);
      }
    },
  );
}

function registerGetJobLogsTool(server: McpServer) {
  server.tool(
    "lore_get_job_logs",
    "Fetches the full stdout/stderr of one scheduled CronJob run (keyed by job_name + run_id), returning {logs, complete:true}. Use for scheduled jobs like context_reindex or spec_test_linker. Instead: lore_get_task_logs for a user-created pipeline task's logs (by UUID).",
    GET_JOB_LOGS_INPUT,
    async ({ job_name, run_id }) => {
      try {
        // Proxy log reads to the remote API (logs live server-side in GCS).
        const creds = resolveApiCredentials();

        if (!creds) {
          return textResult("Job-run logs require LORE_API_URL.");
        }
        const params = new URLSearchParams({ job_name, run_id });
        const proxied = await withReadCache(
          {
            tool: "lore_get_job_logs",
            args: { job_name, run_id },
            ttlSeconds: 86400,
          },
          () =>
            fetchLogsResult(
              `${creds.apiUrl}/api/job-run-logs?${params}`,
              creds.token,
            ),
          { label: false, cacheIf: completeOnly },
        );

        return interpretLogsProxy("lore_get_job_logs", proxied);
      } catch (err) {
        return textResult(`Error getting job logs: ${errorMessage(err)}`);
      }
    },
  );
}

export function registerPipelineLogTools(server: McpServer) {
  registerGetTaskLogsTool(server);
  registerGetJobLogsTool(server);
}
