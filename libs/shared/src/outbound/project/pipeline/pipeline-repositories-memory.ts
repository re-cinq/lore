// Bundle of seven InMemory doubles; `leases` uses FileLeaseBackend (no in-memory impl of acquire/takeover).

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

/** An all-doubles bundle; `overrides` swaps one field without losing the others. */
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
