// The `pipeline` schema's repo-agnostic tables, as ONE bundle.
//
// Every field here is an org-wide table: its rows carry their own repo/task
// association where relevant, so the bundle itself is built once per process and
// shared across every repo — unlike `Project`, which is per-repo and rebuilt on
// each `createProject`. Before this existed the two deployables reached these
// tables through divergent, incomplete paths: Floor via ~19 flat lazy accessors
// in its own `kernel/queues.ts`, lore-api only through the four `Project` getters
// that happened to be wired — leaving it with NO route to events, job runs, or
// agent-run telemetry at all, while rebuilding three Pg adapters per request.
//
// `taskQueue` and `eventQueue` are deliberately NOT named `tasks`/`events`:
// `pipeline.tasks` is the org-wide claim/sweep QUEUE, and `Project.tasks` is the
// repo-scoped `project.tasks` record store. Two different tables, and a call site
// reading `tasks` would not say which. The other six keep the names `Project` and
// `queues.ts` already used for them, so migrating call sites renames no concept.

import type { TaskQueueRepository } from "../tasks/task-queue-port.js";
import type { EventQueueRepository } from "../events/event-queue-port.js";
import type { AssemblyRunsPort } from "../assembly-runs/assembly-runs-port.js";
import type { JobRunsPort } from "../job-runs/job-runs-port.js";
import type { AuditPort } from "../audit/audit-port.js";
import type { LeaseBackend } from "../leases/lease-backends.js";
import type { AgentRunEventsRepository } from "../agent-run-events/agent-run-events-port.js";
import type { AgentRunTurnsRepository } from "../agent-run-turns/agent-run-turns-port.js";

/**
 * The org-wide `pipeline.*` repositories, bound to one pool.
 *
 * Type-only on purpose — this module is safe for the light barrel because it
 * pulls no adapter and therefore no `pg`. Build one with
 * `createPipelineRepositories` (Postgres) or `createInMemoryPipelineRepositories`
 * (tests); neither memoizes, because whose singleton this is belongs to the
 * runtime's composition root, not to shared.
 */
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
  /** `pipeline.task_leases`, Postgres-backed. The file-backed local-worktree
   *  backend is a different mode and is deliberately not reachable from here. */
  leases: LeaseBackend;
  /** `pipeline.agent_run_events` — per-tool-call agent telemetry. */
  agentRunEvents: AgentRunEventsRepository;
  /** `pipeline.agent_run_turns` — full-fidelity run transcripts. */
  agentRunTurns: AgentRunTurnsRepository;
}
