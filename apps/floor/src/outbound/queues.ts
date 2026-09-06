/** Floor-side singletons for the shared, repo-agnostic repositories, lazy because `getPool()` throws until `initPool()` has run at startup — never call one at module scope. */
import { getPool } from "./db.js";
import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import { internalToken } from "@re-cinq/lore-shared/http/internal-token.js";
import { StationClient } from "@re-cinq/lore-shared/project/stations/station-client.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { ClusterAgentClient } from "@re-cinq/lore-shared";
import {
  selectEventDeliveries,
  selectEventQueue,
  selectEventProxy,
} from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import type { EventDeliveriesPort } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { PgEventDeliveries } from "@re-cinq/lore-shared/project/events/event-deliveries-pg.js";
import type {
  EventQueueRepository,
  EventReporter,
} from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import type { EventProxy } from "@re-cinq/lore-shared/project/events/event-proxy.js";
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

/** The org-wide `pipeline.*` repositories bound to the pool as ONE bundle (ADR-024); lore-api binds the same bundle through `project.pipeline`. */
export const pipeline = (): PipelineRepositories =>
  (pipelineSingleton ??= createPipelineRepositories(getPool()));

/** Repo-agnostic task *record* surface, bound to the pool; cross-repo cron jobs use this instead of inline SQL, a job holding a Project uses `project.tasks`. */
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

/** Org-wide lore.repos record reads/writes; repo var/secret writes go through a repo-scoped `project.settings` (which carries the GitHub writer) instead. */
export const settings = (): PgSettings =>
  (settingsSingleton ??= new PgSettings(getPool()));

/** Vector-store chunk ops (schema-per-team {schema}.chunks + org_shared.chunks). */
export const chunks = (): PgChunks =>
  (chunksSingleton ??= new PgChunks(getPool()));

/** Floor-side memory.* lifecycle (decay/eviction/consolidation, PR-outcome feedback); distinct from the agent-facing memory tools — this is the cron/job write surface. */
export const memoryLifecycle = (): PgMemoryLifecycle =>
  (memoryLifecycleSingleton ??= new PgMemoryLifecycle(getPool()));

let eventProxySingleton: EventProxy | undefined;

/** The hub this Floor reports through (ADR-044): over HTTP to the event-router in a cluster, or the pool with no `EVENT_ROUTER_URL`; memoized to ONE per process since a second instance would be a second, undrained queue. */
export const eventProxy = (): EventProxy =>
  (eventProxySingleton ??= selectEventProxy({
    local: () => pipeline().eventQueue,
  }));

/** The reporting half of that hub: `insert`, synchronous and throwing so ingress routes can 500 to make the sender redeliver; a producer with no status to return uses `eventProxy().emit` instead. */
export const eventReporter = (): EventReporter => eventProxy();

let eventQueueSingleton: EventQueueRepository | undefined;

/** The queue this Floor DRAINS (ADR-044): over HTTP to the router in a cluster, or the pool locally; `FOR UPDATE SKIP LOCKED` keeps the claim atomic either way. */
export const eventQueue = (): EventQueueRepository =>
  (eventQueueSingleton ??= selectEventQueue({
    local: () => pipeline().eventQueue,
  }));

let deliveriesSingleton: EventDeliveriesPort | undefined;

/** The DELIVERIES this Floor consumes (ADR-044 amendment): one subscriber among several claiming its own copies, so nothing it did not subscribe to is ever delivered to it. */
export const deliveries = (): EventDeliveriesPort =>
  (deliveriesSingleton ??= selectEventDeliveries({
    local: () => new PgEventDeliveries(getPool()),
  }));

let stationClientSingleton: StationClient | undefined;

/** The stations service (ADR-024's service-endpoint form); the Floor still owns WHEN a station runs, this is how it says so. */
export const stationClient = (): StationClient =>
  (stationClientSingleton ??= new StationClient(
    process.env.STATIONS_URL ?? "",
    internalToken(),
  ));

let clusterAgentsSingleton: PgClusterAgents | undefined;

/** The execution-cluster registry (specs/running-stations-in-any-k8s-cluster): registration, the reaper's offline sweep, and central-id resolution. */
export const clusterAgents = (): PgClusterAgents =>
  (clusterAgentsSingleton ??= new PgClusterAgents(getPool()));

let clusterAgentSingleton: ClusterAgentClient | undefined;

/** This cluster's agent — the only process that talks to its Kubernetes API; the Floor decides WHAT to dispatch, the agent performs it. */
export const clusterAgent = (): ClusterAgentClient =>
  (clusterAgentSingleton ??= new ClusterAgentClient(
    process.env.CLUSTER_AGENT_URL ?? "",
    internalToken(),
  ));
