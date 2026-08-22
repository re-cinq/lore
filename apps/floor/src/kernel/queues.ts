/**
 * Floor-side singletons for the shared, repo-agnostic repositories: `pipeline()`
 * for the whole `pipeline.*` bundle (ADR-024), plus one accessor each for the
 * tables that sit outside it.
 *
 * Lazy because `getPool()` throws until `initPool()` has run at startup — the
 * accessor defers construction to first use (after the pool exists), mirroring
 * how the kernel repositories defer their first `query`. Never call one at
 * module scope. Jobs default their injected dependency to these so tests can
 * swap in the shared InMemory doubles.
 */
import { getPool } from "./db.js";
import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import {
  selectEventQueue,
  selectEventReporter,
} from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import type {
  EventQueueRepository,
  EventReporter,
} from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import { PgTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-pg.js";
import { PgUsage } from "@re-cinq/lore-shared/project/usage/usage-pg.js";
import { PgConversations } from "@re-cinq/lore-shared/project/conversations/conversations-pg.js";
import { PgEvalRuns } from "@re-cinq/lore-shared/project/evals/evals-pg.js";
import { PgCost } from "@re-cinq/lore-shared/project/cost/cost-pg.js";
import { PgContextCore } from "@re-cinq/lore-shared/project/context-core/context-core-pg.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import { PgChunks } from "@re-cinq/lore-shared/project/chunks/chunks-pg.js";
import { PgMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-pg.js";

let pipelineSingleton: PipelineRepositories | undefined;
let taskStoreSingleton: PgTaskStore | undefined;
let usageSingleton: PgUsage | undefined;
let conversationsSingleton: PgConversations | undefined;
let evalRunsSingleton: PgEvalRuns | undefined;
let costSingleton: PgCost | undefined;
let contextCoreSingleton: PgContextCore | undefined;
let settingsSingleton: PgSettings | undefined;
let chunksSingleton: PgChunks | undefined;
let memoryLifecycleSingleton: PgMemoryLifecycle | undefined;

/**
 * The org-wide `pipeline.*` repositories — the task queue, the event queue,
 * assembly runs, job runs, audit, leases, and the agent-run event + turn
 * telemetry — bound to the pool as ONE bundle (ADR-024). lore-api binds the
 * same bundle through `project.pipeline`, so both deployables construct these
 * adapters exactly one way.
 */
export const pipeline = (): PipelineRepositories =>
  (pipelineSingleton ??= createPipelineRepositories(getPool()));

/**
 * Repo-agnostic task *record* surface (create / by-id reads + status writes /
 * event recording), bound to the pool. The cross-repo cron jobs reach
 * `pipeline.tasks` records through this instead of inline SQL; a job that holds
 * a Project uses `project.tasks` instead.
 */
export const taskStore = (): PgTaskStore =>
  (taskStoreSingleton ??= new PgTaskStore(getPool()));

/** LLM-call accounting, repo-agnostic (the agent-events telemetry sink + health). */
export const usage = (): PgUsage => (usageSingleton ??= new PgUsage(getPool()));

/** Conversations a run can continue (pipeline.agent_conversations). */
export const conversations = (): PgConversations =>
  (conversationsSingleton ??= new PgConversations(getPool()));

/** Eval-run results (pipeline.eval_runs), written by the eval-runner cron. */
export const evalRuns = (): PgEvalRuns =>
  (evalRunsSingleton ??= new PgEvalRuns(getPool()));

/** Daily Anthropic cost rollup (pipeline.anthropic_cost_daily). */
export const cost = (): PgCost => (costSingleton ??= new PgCost(getPool()));

/** Context-core promotion history (pipeline.context_core_history). */
export const contextCore = (): PgContextCore =>
  (contextCoreSingleton ??= new PgContextCore(getPool()));

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

let eventReporterSingleton: EventReporter | undefined;

/**
 * Where this Floor reports events (ADR-044). The event-router owns
 * `pipeline.events`, so in a cluster this is an HTTP reporter; with no
 * `EVENT_ROUTER_URL` (local `npm start`) it falls back to the pool.
 *
 * Memoized so the resolution logs once per boot rather than once per event.
 */
export const eventReporter = (): EventReporter =>
  (eventReporterSingleton ??= selectEventReporter({
    local: () => pipeline().eventQueue,
  }));

let eventQueueSingleton: EventQueueRepository | undefined;

/**
 * The queue this Floor DRAINS (ADR-044). The router owns `pipeline.events`, so
 * in a cluster the loop claims and acks over HTTP; with no `EVENT_ROUTER_URL`
 * (local `npm start`) it falls back to the pool.
 *
 * The claim stays atomic either way — `FOR UPDATE SKIP LOCKED` is one statement
 * server-side, and going over HTTP only carries the request to it.
 */
export const eventQueue = (): EventQueueRepository =>
  (eventQueueSingleton ??= selectEventQueue({
    local: () => pipeline().eventQueue,
  }));
