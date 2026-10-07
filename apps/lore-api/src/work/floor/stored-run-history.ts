// The history Postgres holds of a run Lore's own Floor walked: its turns, its agent events and the stdout of its pods. Read here because the old Floor's HTTP server, which used to answer these, is going (specs/external-floor FR16.9). Every read answers null for a run Postgres does not have: that run is on the external floor, and the caller asks the floor.
import type { AgentRunTurnsRepository } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";
import type { AgentRunEventsRepository } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-port.js";
import type { PodLogsRepository } from "@re-cinq/lore-shared/project/pod-logs/pod-logs-port.js";
import { storedPodLogArchive } from "@re-cinq/lore-shared/project/pod-logs/stored-pod-log-archive.js";

export interface StoredRunPorts {
  hasRun(runId: string): Promise<boolean>;
  /** The node an Agent CR name belongs to, null for a name no node of a Postgres run has. Its outcome is null until it finishes. */
  nodeOf(agentCrName: string): Promise<{
    assemblyRunId: string;
    status: string;
    outcome: string | null;
  } | null>;
  turns: Pick<AgentRunTurnsRepository, "listByLine">;
  events: Pick<AgentRunEventsRepository, "listSince">;
  podLogs: PodLogsRepository;
}

/** A node's stored stdout in the shape the run page reads a log in. */
export interface StoredNodeLogs {
  available: boolean;
  logs: string | null;
  phase: string;
  podName: null;
  archived: boolean;
  reason?: "no-records";
}

export type StoredRunHistory = ReturnType<typeof storedRunHistory>;

export function storedRunHistory(ports: StoredRunPorts) {
  return {
    turns: async (runId: string, afterId: string, limit: number) =>
      (await ports.hasRun(runId))
        ? ports.turns.listByLine(runId, afterId, limit)
        : null,
    events: async (runId: string, afterId: string, limit: number) =>
      (await ports.hasRun(runId))
        ? ports.events.listSince(runId, afterId, limit)
        : null,
    nodeLogs: (runId: string, agentCrName: string, tail: number | undefined) =>
      storedNodeLogs(ports, { runId, agentCrName, tail }),
  };
}

// Only what was stored: a pod of the old walk is long gone by the time anyone reads this, and the stored chunks are the one source that also covers a satellite's run.
async function storedNodeLogs(
  ports: StoredRunPorts,
  read: { runId: string; agentCrName: string; tail: number | undefined },
): Promise<StoredNodeLogs | null> {
  const node = await ports.nodeOf(read.agentCrName);

  if (node?.assemblyRunId !== read.runId) {
    return null;
  }
  const phase = node.outcome ?? node.status;
  const logs = await storedPodLogArchive(ports.podLogs).logsForAgent(
    read.agentCrName,
    { tailLines: read.tail },
  );

  return logs === null
    ? { ...unread(phase), reason: "no-records" }
    : { ...unread(phase), available: true, logs, archived: true };
}

function unread(phase: string): StoredNodeLogs {
  return {
    available: false,
    logs: null,
    phase,
    podName: null,
    archived: false,
  };
}
