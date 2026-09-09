/** GET /api/agent-logs/{name} — live pod logs for one node's Agent CR, read on-demand from the cluster; a dead pod/CR returns 200 `available:false`, not an error. */

import type { ServerRoute } from "@hapi/hapi";
import {
  firstAvailableArchive,
  storedPodLogArchive,
} from "@re-cinq/lore-shared/project/pod-logs/stored-pod-log-archive.js";
import { clusterAgent, pipeline } from "../../../outbound/queues.js";
import { centralClusterAgentId } from "../../../outbound/central-cluster-agent.js";
import { agentCrVisible } from "../../../work/assembly-run/cr-visibility.js";
import {
  readAgentLogs,
  CloudLoggingPodLogs,
  type AgentLogsResult,
  type LiveReadable,
  type PodLogArchive,
} from "../../../work/station/agent-pod-logs.js";
import { HttpPodLogSource, type PodLogSource } from "@re-cinq/lore-shared";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

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

/** The live source is the CENTRAL cluster-agent, so it may only be asked about a CR the central cluster ran; a row with no claim record keeps today's behaviour. */
export function liveReadableFromCentral(
  row: Pick<StationRunRecord, "status" | "clusterAgentId"> | null,
  centralId: string | null,
): boolean {
  return row === null || agentCrVisible(row, centralId);
}

/** Resolved per read (after `initPool`), like the archive. */
const centralLiveReadable: LiveReadable = async (agentName) =>
  liveReadableFromCentral(
    await pipeline().assemblyRuns.findStationRunByAgentCrName(agentName),
    await centralClusterAgentId(),
  );

export function agentLogsRoute(
  source: PodLogSource = new HttpPodLogSource(clusterAgent()),
  archive: PodLogArchive = defaultArchive(),
  liveReadable: LiveReadable = centralLiveReadable,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-logs/{name}",
    options: { auth: "ingest-token" },
    handler: async (request, h) =>
      h.response(await logsFor(request, { source, archive, liveReadable })),
  };
}

/** What one GET resolves to, with the caller's tail clamped. */
function logsFor(
  request: { params: Record<string, string>; query: { tail?: unknown } },
  reads: {
    source: PodLogSource;
    archive: PodLogArchive;
    liveReadable: LiveReadable;
  },
): Promise<AgentLogsResult> {
  return readAgentLogs(
    reads.source,
    request.params.name,
    {
      tailLines: parseTail(request.query.tail),
      liveReadable: reads.liveReadable,
    },
    reads.archive,
  );
}
