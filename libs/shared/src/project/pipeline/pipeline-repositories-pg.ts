// The Postgres composition of the pipeline bundle.
//
// Kept out of the package barrel like every other `*-pg.ts`: importing it pulls
// eight adapters and `pg` with them, which the light runtimes (mcp-server,
// web-ui) must never take on. Reach it by subpath.
//
// Takes the pool as an argument and memoizes NOTHING. Both apps' pools are
// module singletons that throw until their `initPool()` has run, so whoever owns
// the deferral owns it — a singleton in here would pick one process's pool and
// silently hand it to a test that built another.

import { PgTaskQueue } from "../tasks/task-queue-pg.js";
import { PgEventQueue } from "../events/event-queue-pg.js";
import { PgAssemblyRuns } from "../assembly-runs/assembly-runs-pg.js";
import { PgJobRuns } from "../job-runs/job-runs-pg.js";
import { PgAudit } from "../audit/audit-pg.js";
import { DbLeaseBackend, type LeasePool } from "../leases/lease-backends.js";
import { PgAgentRunEvents } from "../agent-run-events/agent-run-events-pg.js";
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
    agentRunTurns: new PgAgentRunTurns(pool),
  };
}
