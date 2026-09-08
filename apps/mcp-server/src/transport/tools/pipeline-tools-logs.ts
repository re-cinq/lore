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

/** Both log reads are the same read: logs live server-side, so with no API there is nothing to fall back to. Cached for a DAY but only once `complete` — a still-running task's partial transcript must never be served as its final one. */
async function cachedLogRead(read: {
  tool: string;
  missing: string;
  path: (apiUrl: string) => string;
  args: Record<string, unknown>;
}) {
  const creds = resolveApiCredentials();

  if (!creds) {
    return textResult(read.missing);
  }
  const proxied = await withReadCache(
    { tool: read.tool, args: read.args, ttlSeconds: 86400 },
    () => fetchLogsResult(read.path(creds.apiUrl), creds.token),
    { label: false, cacheIf: completeOnly },
  );

  return interpretLogsProxy(read.tool, proxied);
}

/** The API resolves the task's repo from task_id — the local adapter holds no DB to look it up in. An absent cursor is left out of the cache key rather than keyed as undefined, so the first page and a re-read of it share one entry. */
function getTaskLogs(read: {
  task_id: string;
  offset: number;
  cursor?: string;
}) {
  const { task_id, offset, cursor } = read;

  return cachedLogRead({
    tool: "lore_get_task_logs",
    missing: "Task logs require LORE_API_URL.",
    path: (apiUrl) =>
      `${apiUrl}/api/task-logs?${buildTaskLogsParams(task_id, offset, cursor)}`,
    args:
      cursor === undefined ? { task_id, offset } : { task_id, offset, cursor },
  });
}

function registerGetTaskLogsTool(server: McpServer) {
  server.tool(
    "lore_get_task_logs",
    "Fetches one pipeline task's execution transcript (by UUID), returning {logs, next_offset, complete, cursor?}. Tasks with recorded agent turns return NDJSON — one {source, event} stream-json envelope per line from the turn store; tasks with no recorded turns fall back to the raw captured output. Responses may be capped: pass next_offset back as offset (and cursor back verbatim, when present) and poll until complete is true. Instead: lore_get_job_logs (job_name + run_id) for scheduled CronJob run logs.",
    GET_TASK_LOGS_INPUT,
    async (args) => {
      try {
        return await getTaskLogs(args);
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
        return await cachedLogRead({
          tool: "lore_get_job_logs",
          missing: "Job-run logs require LORE_API_URL.",
          path: (apiUrl) =>
            `${apiUrl}/api/job-run-logs?${new URLSearchParams({ job_name, run_id })}`,
          args: { job_name, run_id },
        });
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
