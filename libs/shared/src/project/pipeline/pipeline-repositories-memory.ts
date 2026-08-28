// The bundle a test gets: the seven existing InMemory doubles, composed.
//
// No new behaviour is written here — each double is already the behavioural spec
// for its own port, and re-implementing any of them would fork that spec.
//
// `leases` is the exception, and deliberately so: no in-memory LeaseBackend
// exists, and the acquire/takeover mechanics are the whole point of the port, so
// this defaults to a FileLeaseBackend on a fresh temp dir — exactly what
// lease-backends.test.ts already does rather than fake.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTaskQueue } from "../tasks/task-queue-memory.js";
import { InMemoryEventQueue } from "../events/event-queue-memory.js";
import { InMemoryAssemblyRuns } from "../assembly-runs/assembly-runs-memory.js";
import { InMemoryJobRuns } from "../job-runs/job-runs-memory.js";
import { InMemoryAudit } from "../audit/audit-memory.js";
import { FileLeaseBackend } from "../leases/lease-backends.js";
import { InMemoryAgentRunEvents } from "../agent-run-events/agent-run-events-memory.js";
import { InMemoryPodLogs } from "../pod-logs/pod-logs-memory.js";
import { InMemoryAgentRunTurns } from "../agent-run-turns/agent-run-turns-memory.js";
import type { PipelineRepositories } from "./pipeline-repositories.js";

/**
 * An all-doubles bundle. `overrides` swaps one field without losing the other
 * seven — the common shape for a test that cares about a single table but is
 * handed the whole bundle by the code under test.
 */
export function createInMemoryPipelineRepositories(
  overrides: Partial<PipelineRepositories> = {},
): PipelineRepositories {
  return {
    taskQueue: new InMemoryTaskQueue(),
    eventQueue: new InMemoryEventQueue(),
    assemblyRuns: new InMemoryAssemblyRuns(),
    jobRuns: new InMemoryJobRuns(),
    audit: new InMemoryAudit(),
    leases: new FileLeaseBackend(
      mkdtempSync(join(tmpdir(), "pipeline-leases-")),
    ),
    agentRunEvents: new InMemoryAgentRunEvents(),
    podLogs: new InMemoryPodLogs(),
    agentRunTurns: new InMemoryAgentRunTurns(),
    ...overrides,
  };
}
