/** GET /api/agent-logs/{name} — live pod logs for one node's Agent CR, read on-demand from the cluster; a dead pod/CR returns 200 `available:false`, not an error. */

import type { ServerRoute } from "@hapi/hapi";
import {
  firstAvailableArchive,
  storedPodLogArchive,
} from "@re-cinq/lore-shared/project/pod-logs/stored-pod-log-archive.js";
import { pipeline } from "../../../kernel/queues.js";
import {
  readAgentLogs,
  CloudLoggingPodLogs,
  type PodLogArchive,
} from "../../../jobs/station/agent-pod-logs.js";
import { HttpPodLogSource, type PodLogSource } from "@re-cinq/lore-shared";
import { clusterAgent } from "../../../kernel/queues.js";

const DEFAULT_TAIL_LINES = 5000;
const MAX_TAIL_LINES = 50_000;

/** Clamps caller-supplied `tail` — LORE_INGEST_TOKEN is shared with web-ui, so an unbounded value could pressure the Floor's memory. */
export function parseTail(raw: unknown): number {
  const n = Number(raw);

  return Number.isInteger(n) && n > 0
    ? Math.min(n, MAX_TAIL_LINES)
    : DEFAULT_TAIL_LINES;
}

/** Stored chunks first, Cloud Logging behind them — stored is the only source that reaches a satellite-cluster run; `storedPodLogArchive` returns null (not "") to let the chain continue. */
function defaultArchive(): PodLogArchive {
  return firstAvailableArchive(
    {
      // Resolved per read, not here — this runs before `initPool`, so eager resolution would boot-crash route registration.
      logsForJob: (jobName, opts) =>
        storedPodLogArchive(pipeline().podLogs).logsForJob(jobName, opts),
    },
    new CloudLoggingPodLogs(),
  );
}

export function agentLogsRoute(
  source: PodLogSource = new HttpPodLogSource(clusterAgent()),
  archive: PodLogArchive = defaultArchive(),
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-logs/{name}",
    options: { auth: "ingest-token" },
    handler: async (request, h) => {
      const name = request.params.name;
      const tailLines = parseTail(request.query.tail);
      const result = await readAgentLogs(source, name, { tailLines }, archive);

      return h.response(result).code(200);
    },
  };
}
