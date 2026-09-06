// The `pipeline` schema's repo-agnostic tables as ONE bundle, built once per process (unlike per-repo `Project`); `taskQueue`/`eventQueue` are deliberately not named `tasks`/`events` to avoid collision with `Project.tasks`.

import type { TaskQueueRepository } from "../tasks/task-queue-port.js";
import type { EventQueueRepository } from "../events/event-queue-port.js";
import type { AssemblyRunsPort } from "../assembly-runs/assembly-runs-port.js";
import type { JobRunsPort } from "../job-runs/job-runs-port.js";
import type { AuditPort } from "../audit/audit-port.js";
import type { LeaseBackend } from "../leases/lease-backends.js";
import type { AgentRunEventsRepository } from "../agent-run-events/agent-run-events-port.js";
import type { PodLogsRepository } from "../pod-logs/pod-logs-port.js";
import type { AgentRunTurnsRepository } from "../agent-run-turns/agent-run-turns-port.js";

/** The org-wide `pipeline.*` repositories, bound to one pool; type-only so this module is safe for the light barrel (no `pg`). Build via `createPipelineRepositories`/`createInMemoryPipelineRepositories`; neither memoizes. */
export interface PipelineRepositories {
  /** `pipeline.tasks` — the org-wide claim/sweep queue (NOT `project.tasks`). */
  taskQueue: TaskQueueRepository;
  /** `pipeline.events` — the event bus's consume side. */
  eventQueue: EventQueueRepository;
  /** `pipeline.assembly_runs` + `pipeline.station_runs`. */
  assemblyRuns: AssemblyRunsPort;
  /** `pipeline.job_runs` — the scheduled-job ledger. */
  jobRuns: JobRunsPort;
  /** `pipeline.audit_log` — append-only. */
  audit: AuditPort;
  /** `pipeline.task_leases`, Postgres-backed; the file-backed local-worktree backend is a different mode, deliberately not reachable from here. */
  leases: LeaseBackend;
  /** `pipeline.agent_run_events` — per-tool-call agent telemetry. */
  agentRunEvents: AgentRunEventsRepository;
  /** `pipeline.pod_log_chunks` — durable run-pod stdout, the only log source that works for a run in a cluster the Floor cannot reach. */
  podLogs: PodLogsRepository;
  /** `pipeline.agent_run_turns` — full-fidelity run transcripts. */
  agentRunTurns: AgentRunTurnsRepository;
}
