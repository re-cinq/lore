/**
 * GET /api/agent-logs/{name} — live pod logs for one assembly-line node's Agent
 * CR, read on-demand from the cluster (never persisted). The web-ui proxies here
 * (after its own repo-access check) with the shared LORE_INGEST_TOKEN. A dead-end
 * — CR gone, no job yet, pod garbage-collected — returns 200 with
 * `available:false`, not an error, since the pod-log lifetime is short by design.
 */

import type { ServerRoute } from "@hapi/hapi";
import {
  readAgentLogs,
  KubePodLogs,
  type PodLogSource,
} from "../../../jobs/station/agent-pod-logs.js";

const DEFAULT_TAIL_LINES = 5000;

function parseTail(raw: unknown): number {
  const n = Number(raw);

  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TAIL_LINES;
}

export function agentLogsRoute(
  source: PodLogSource = new KubePodLogs(),
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-logs/{name}",
    options: { auth: "ingest-token" },
    handler: async (request, h) => {
      const name = request.params.name;
      const tailLines = parseTail(request.query.tail);
      const result = await readAgentLogs(source, name, { tailLines });

      return h.response(result).code(200);
    },
  };
}
