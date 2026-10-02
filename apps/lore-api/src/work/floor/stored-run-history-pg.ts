// The stored run history bound to this service's pool, built per read because the pool does not exist until boot has finished.
import type { Pool } from "pg";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { PgAgentRunTurns } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-pg.js";
import { PgAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-pg.js";
import { PgPodLogs } from "@re-cinq/lore-shared/project/pod-logs/pod-logs-pg.js";
import {
  storedRunHistory,
  type StoredRunHistory,
} from "./stored-run-history.js";

/** Null with no database, which reads as "Postgres has no such run". */
export function storedRunHistoryOf(
  getPool: () => Pool | null,
): () => StoredRunHistory | null {
  return () => {
    const pool = getPool();

    return pool ? pgStoredRunHistory(pool) : null;
  };
}

function pgStoredRunHistory(pool: Pool): StoredRunHistory {
  const runs = new PgAssemblyRuns(pool);

  return storedRunHistory({
    hasRun: async (runId) => (await runs.getById(runId)) !== null,
    nodeOf: (agentCrName) => runs.findStationRunByAgentCrName(agentCrName),
    turns: new PgAgentRunTurns(pool),
    events: new PgAgentRunEvents(pool),
    podLogs: new PgPodLogs(pool),
  });
}
