/**
 * GET /api/agent-logs/{name} — live pod logs for one assembly-line node's Agent
 * CR, read on-demand from the cluster (never persisted). The web-ui proxies here
 * (after its own repo-access check) with the shared LORE_INGEST_TOKEN. A dead-end
 * — CR gone, no job yet, pod garbage-collected — returns 200 with
 * `available:false`, not an error, since the pod-log lifetime is short by design.
 */

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

/** Clamp the caller-supplied `tail`. LORE_INGEST_TOKEN is shared with the web-ui,
 *  so a signed-in user could hit this route directly — an unbounded `tailLines`
 *  would ask Kubernetes for arbitrarily many lines and pressure the Floor's memory. */
export function parseTail(raw: unknown): number {
  const n = Number(raw);

  return Number.isInteger(n) && n > 0
    ? Math.min(n, MAX_TAIL_LINES)
    : DEFAULT_TAIL_LINES;
}

/**
 * Stored chunks first, Cloud Logging behind them.
 *
 * Stored leads because it is the only source that works for a run executed in a
 * cluster the Floor cannot reach — the live read dials one CLUSTER_AGENT_URL
 * and the Cloud Logging filter names one project, so a satellite's run is
 * invisible to both. Cloud Logging stays behind it because it holds history
 * from before the table existed, and `storedPodLogArchive` returns null rather
 * than "" for a job it has nothing for, which is what lets the chain continue.
 */
function defaultArchive(): PodLogArchive {
  return firstAvailableArchive(
    {
      // `pipeline()` is resolved per READ, not here: this default is evaluated
      // when the route is registered, and that happens before `initPool`. A
      // pool resolved eagerly would turn route registration into a boot crash.
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
