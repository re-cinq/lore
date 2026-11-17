import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { userInfo } from "node:os";
import { z } from "zod";
import type { ProxyResult } from "../shared/deps.js";
import type { ServerMode } from "../shared/repo-scope.js";
import {
  type ApiGet,
  type ApiPost,
  readRun,
  runPath,
} from "./shared/run-read.js";
import { RUN_ID } from "./shared/run-params.js";

export const RETRY_STATION_DESCRIPTION =
  "Runs one station of an assembly-line run again, returning {run_id, pending}; the floor reopens a finished or failed run to take it, and pending is true when it had not taken the ask within a few seconds. node is a node id of the run's line, from lore_get_run. On the agent gateway a run that is still queued or running is refused, so an agent cannot restart its own run. Instead: lore_get_run to see which station failed.";

const RETRY_STATION_INPUT = {
  run_id: RUN_ID,
  node: z
    .string()
    .min(1)
    .describe("The node id of the station to run again, e.g. tdd-round."),
};

const OPEN_STATUSES = ["queued", "running"];

type Ask = { run_id: string; node: string };

export function registerRetryStationTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_retry_station",
    RETRY_STATION_DESCRIPTION,
    RETRY_STATION_INPUT,
    (ask) =>
      readRun({
        tool: "lore_retry_station",
        op: "retrying station",
        load: (get, post) =>
          mode === "agent"
            ? retryAsAgent(get, post, ask)
            : retry(post, ask, mode),
      }),
  );
}

async function retryAsAgent(
  get: ApiGet,
  post: ApiPost,
  ask: Ask,
): Promise<ProxyResult> {
  const run = await get(runPath(ask.run_id));

  if (!run.ok) {
    return run;
  }
  const status =
    (JSON.parse(run.body) as { line?: { status?: string } }).line?.status ?? "";

  return OPEN_STATUSES.includes(status)
    ? openRunRefusal(ask.run_id, status)
    : retry(post, ask, "agent");
}

function openRunRefusal(runId: string, status: string): ProxyResult {
  const refused = `run ${runId} is ${status}: an agent runs a station again only in a settled run, never in its own`;

  return { ok: true, body: JSON.stringify({ refused }) };
}

function retry(
  post: ApiPost,
  ask: Ask,
  mode: ServerMode,
): Promise<ProxyResult> {
  return post(
    runPath(ask.run_id, `/nodes/${encodeURIComponent(ask.node)}/run`),
    {
      requested_by:
        mode === "agent" ? "lore-mcp:agent" : `lore-mcp:${userInfo().username}`,
    },
  );
}
