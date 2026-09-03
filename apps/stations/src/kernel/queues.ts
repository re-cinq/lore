// The org-wide `pipeline.*` repositories, bound to this service's pool.
//
// Lazy for the usual reason: `getPool()` throws until `initPool()` has run at
// boot. Never call at module scope.

import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import { PgTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-pg.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import { PgCost } from "@re-cinq/lore-shared/project/cost/cost-pg.js";
import { PgUsage } from "@re-cinq/lore-shared/project/usage/usage-pg.js";
import { PgEventDeliveries } from "@re-cinq/lore-shared/project/events/event-deliveries-pg.js";
import type { EventDeliveriesPort } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { selectEventDeliveries } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import { PgMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-pg.js";
import { selectEventProxy } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import type { EventProxy } from "@re-cinq/lore-shared/project/events/event-proxy.js";
import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";

let pipelineSingleton: PipelineRepositories | undefined;

export const pipelineRepositories = (): PipelineRepositories =>
  (pipelineSingleton ??= createPipelineRepositories(getPool()));

/** The name the moved stations already used for it. */
export const pipeline = pipelineRepositories;

let taskStoreSingleton: PgTaskStore | undefined;
let settingsSingleton: PgSettings | undefined;
let memoryLifecycleSingleton: PgMemoryLifecycle | undefined;
let costSingleton: PgCost | undefined;
let deliveriesSingleton: EventDeliveriesPort | undefined;
let eventProxySingleton: EventProxy | undefined;

/** Repo-agnostic task record ops (`pipeline.tasks`). */
export const taskStore = (): PgTaskStore =>
  (taskStoreSingleton ??= new PgTaskStore(getPool()));

/** Org-wide `lore.repos` record reads/writes. */
export const settings = (): PgSettings =>
  (settingsSingleton ??= new PgSettings(getPool()));

/** memory.* lifecycle — the episode/curation write surface. */
export const memoryLifecycle = (): PgMemoryLifecycle =>
  (memoryLifecycleSingleton ??= new PgMemoryLifecycle(getPool()));

/** Where this service reports events. Stations produce them (a resume, a
 *  decomposition) and, like every producer, go through the router (ADR-044). */
/** pipeline.anthropic_cost_daily — the cost import's write surface. */
export const cost = (): PgCost => (costSingleton ??= new PgCost(getPool()));

let usageSingleton: PgUsage | undefined;

/** Per-call `pipeline.llm_calls` cost logging — the transport a service-run
 *  station's model call reports through (a pod reports via its terminal line
 *  instead, and `Llm.usageConfigured` keeps the two from double-counting). */
export const usage = (): PgUsage => (usageSingleton ??= new PgUsage(getPool()));

export const eventProxy = (): EventProxy =>
  (eventProxySingleton ??= selectEventProxy({
    local: () => pipelineRepositories().eventQueue,
  }));

/**
 * The reporting half of that hub: `insert`, synchronous and throwing. A
 * producer with nobody to return a status to reaches for `eventProxy().emit`
 * instead.
 */
export const eventReporter = (): EventReporter => eventProxy();

/**
 * The deliveries this service consumes.
 *
 * Resolved the same three ways every other bus client is: over HTTP to the
 * event-router where one is configured, and against the local pool otherwise so
 * `npm start` keeps working with no router in front of it.
 */
export const deliveries = (): EventDeliveriesPort =>
  (deliveriesSingleton ??= selectEventDeliveries({
    local: () => new PgEventDeliveries(getPool()),
  }));
