/**
 * Floor-side singletons for the shared, repo-agnostic queue repositories.
 * They bind the agent's Postgres pool to the `@re-cinq/lore-shared` adapters
 * that single-source the `pipeline.tasks` / `pipeline.events` claim + sweep SQL.
 *
 * Lazy because `getPool()` throws until `initPool()` has run at startup — the
 * accessor defers construction to first use (after the pool exists), mirroring
 * how the kernel repositories defer their first `query`. Jobs default their
 * injected dependency to these so tests can swap in the shared InMemory doubles.
 */
import { getPool } from "./db.js";
import { PgEventQueue } from "@re-cinq/lore-shared/project/events/event-queue-pg.js";
import { PgTaskQueue } from "@re-cinq/lore-shared/project/tasks/task-queue-pg.js";
import { PgTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-pg.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import {
  DbLeaseBackend,
  type LeasePool,
} from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import { PgAudit } from "@re-cinq/lore-shared/project/audit/audit-pg.js";
import { PgUsage } from "@re-cinq/lore-shared/project/usage/usage-pg.js";
import { PgJobRuns } from "@re-cinq/lore-shared/project/job-runs/job-runs-pg.js";
import { PgAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-pg.js";
import { PgConversations } from "@re-cinq/lore-shared/project/conversations/conversations-pg.js";
import { PgAgentRunTurns } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-pg.js";
import { PgEvalRuns } from "@re-cinq/lore-shared/project/evals/evals-pg.js";
import { PgCost } from "@re-cinq/lore-shared/project/cost/cost-pg.js";
import { PgContextCore } from "@re-cinq/lore-shared/project/context-core/context-core-pg.js";
import { PgBaseline } from "@re-cinq/lore-shared/project/baseline/baseline-pg.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import { PgChunks } from "@re-cinq/lore-shared/project/chunks/chunks-pg.js";
import { PgMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-pg.js";

let eventQueueSingleton: PgEventQueue | undefined;
let taskQueueSingleton: PgTaskQueue | undefined;
let taskStoreSingleton: PgTaskStore | undefined;
let assemblyLinesSingleton: PgAssemblyRuns | undefined;
let leaseBackendSingleton: DbLeaseBackend | undefined;
let auditLogSingleton: PgAudit | undefined;
let usageSingleton: PgUsage | undefined;
let jobRunsSingleton: PgJobRuns | undefined;
let agentRunEventsSingleton: PgAgentRunEvents | undefined;
let conversationsSingleton: PgConversations | undefined;
let agentRunTurnsSingleton: PgAgentRunTurns | undefined;
let evalRunsSingleton: PgEvalRuns | undefined;
let costSingleton: PgCost | undefined;
let contextCoreSingleton: PgContextCore | undefined;
let baselineSingleton: PgBaseline | undefined;
let settingsSingleton: PgSettings | undefined;
let chunksSingleton: PgChunks | undefined;
let memoryLifecycleSingleton: PgMemoryLifecycle | undefined;

export const eventQueue = (): PgEventQueue =>
  (eventQueueSingleton ??= new PgEventQueue(getPool()));

export const taskQueue = (): PgTaskQueue =>
  (taskQueueSingleton ??= new PgTaskQueue(getPool()));

/**
 * Repo-agnostic task *record* surface (create / by-id reads + status writes /
 * event recording), bound to the pool. The cross-repo cron jobs reach
 * `pipeline.tasks` records through this instead of inline SQL; a job that holds
 * a Project uses `project.tasks` instead.
 */
export const taskStore = (): PgTaskStore =>
  (taskStoreSingleton ??= new PgTaskStore(getPool()));

/**
 * First-class assembly line runs (pipeline.assembly_runs + _nodes), repo-agnostic.
 * The event-loop handler and watchers reach the rows through this; a job that
 * holds a Project uses `project.assemblyLines` instead.
 */
export const assemblyLines = (): PgAssemblyRuns =>
  (assemblyLinesSingleton ??= new PgAssemblyRuns(getPool()));

/** The cluster lease backend (its reap side feeds the lease-reaper). */
export const leaseBackend = (): DbLeaseBackend =>
  // The real pg pool returns rowCount; LeasePool's narrow type omits it.
  (leaseBackendSingleton ??= new DbLeaseBackend(
    getPool() as unknown as LeasePool,
  ));

/** Append-only audit writer, repo-agnostic (used where no Project is in scope). */
export const auditLog = (): PgAudit =>
  (auditLogSingleton ??= new PgAudit(getPool()));

/** LLM-call accounting, repo-agnostic (the agent-events telemetry sink + health). */
export const usage = (): PgUsage => (usageSingleton ??= new PgUsage(getPool()));

/** Scheduled-job run ledger (pipeline.job_runs), bound by the scheduler. */
export const jobRuns = (): PgJobRuns =>
  (jobRunsSingleton ??= new PgJobRuns(getPool()));

/** Per-tool-call agent telemetry (pipeline.agent_run_events). */
export const agentRunEvents = (): PgAgentRunEvents =>
  (agentRunEventsSingleton ??= new PgAgentRunEvents(getPool()));

/** Conversations a run can continue (pipeline.agent_conversations). */
export const conversations = (): PgConversations =>
  (conversationsSingleton ??= new PgConversations(getPool()));
/** Full-fidelity run transcripts (pipeline.agent_run_turns), written on every
 *  agent-events POST and read by the turn history route. */
export const agentRunTurns = (): PgAgentRunTurns =>
  (agentRunTurnsSingleton ??= new PgAgentRunTurns(getPool()));

/** Eval-run results (pipeline.eval_runs), written by the eval-runner cron. */
export const evalRuns = (): PgEvalRuns =>
  (evalRunsSingleton ??= new PgEvalRuns(getPool()));

/** Daily Anthropic cost rollup (pipeline.anthropic_cost_daily). */
export const cost = (): PgCost => (costSingleton ??= new PgCost(getPool()));

/** Context-core promotion history (pipeline.context_core_history). */
export const contextCore = (): PgContextCore =>
  (contextCoreSingleton ??= new PgContextCore(getPool()));

/** Dark-factory pre-feature baseline snapshots + stats (pipeline.dark_factory_baseline). */
export const baseline = (): PgBaseline =>
  (baselineSingleton ??= new PgBaseline(getPool()));

/**
 * Org-wide lore.repos record reads/writes (settings JSONB, team, onboarded set,
 * ingest stamp). Read-only binding — repo var/secret writes go through a
 * repo-scoped `project.settings` (which carries the GitHub writer).
 */
export const settings = (): PgSettings =>
  (settingsSingleton ??= new PgSettings(getPool()));

/** Vector-store chunk ops (schema-per-team {schema}.chunks + org_shared.chunks). */
export const chunks = (): PgChunks =>
  (chunksSingleton ??= new PgChunks(getPool()));

/**
 * Floor-side memory.* lifecycle (decay/eviction/consolidation, PR-outcome
 * feedback, episode + memory writes). Distinct from the agent-facing memory
 * tools — this is the cron/job write surface.
 */
export const memoryLifecycle = (): PgMemoryLifecycle =>
  (memoryLifecycleSingleton ??= new PgMemoryLifecycle(getPool()));
