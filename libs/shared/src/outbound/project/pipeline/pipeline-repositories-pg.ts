// Postgres adapters; kept out of package barrel (subpath-only) to avoid pulling pg into light runtimes; takes pool arg, memoizes nothing.

import { PgTaskQueue } from "../tasks/task-queue-pg.js";
import { PgEventQueue } from "../events/event-queue-pg.js";
import { PgAssemblyRuns } from "../assembly-runs/assembly-runs-pg.js";
import { PgJobRuns } from "../job-runs/job-runs-pg.js";
import { PgAudit } from "../audit/audit-pg.js";
import { DbLeaseBackend, type LeasePool } from "../leases/lease-backends.js";
import { PgAgentRunEvents } from "../agent-run-events/agent-run-events-pg.js";
import { PgPodLogs } from "../pod-logs/pod-logs-pg.js";
import { PgAgentRunTurns } from "../agent-run-turns/agent-run-turns-pg.js";
import type { PgPool } from "../../memory-store.js";
import type { PipelineRepositories } from "./pipeline-repositories.js";

/** Bind every `pipeline.*` repository to one pool. */
export function createPipelineRepositories(pool: PgPool): PipelineRepositories {
  return {
    taskQueue: new PgTaskQueue(pool),
    eventQueue: new PgEventQueue(pool),
    assemblyRuns: new PgAssemblyRuns(pool),
    jobRuns: new PgJobRuns(pool),
    audit: new PgAudit(pool),
    // The real pg pool returns rowCount; PgPool's narrow type omits it.
    leases: new DbLeaseBackend(pool as unknown as LeasePool),
    agentRunEvents: new PgAgentRunEvents(pool),
    podLogs: new PgPodLogs(pool),
    agentRunTurns: new PgAgentRunTurns(pool),
  };
}
