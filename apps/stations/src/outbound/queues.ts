// The org-wide `pipeline.*` repositories, bound to this service's pool. Lazy for the usual reason: `getPool()` throws until `initPool()` has run at boot — never call at module scope.

import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import { PgTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-pg.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import {
  PgCost,
  PgGcpCost,
} from "@re-cinq/lore-shared/project/cost/cost-pg.js";
import { PgUsage } from "@re-cinq/lore-shared/project/usage/usage-pg.js";
import { PgEventDeliveries } from "@re-cinq/lore-shared/project/events/event-deliveries-pg.js";
import type { EventDeliveriesPort } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { PgMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-pg.js";
import { localEventProxy } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import type { EventProxy } from "@re-cinq/lore-shared/project/events/event-proxy.js";
import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-port.js";
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

/** pipeline.anthropic_cost_daily — the cost import's write surface. */
export const cost = (): PgCost => (costSingleton ??= new PgCost(getPool()));

let gcpCostSingleton: PgGcpCost | undefined;

/** pipeline.gcp_cost_daily — the GCP billing import's write surface. */
export const gcpCost = (): PgGcpCost =>
  (gcpCostSingleton ??= new PgGcpCost(getPool()));

let usageSingleton: PgUsage | undefined;

// Per-call `pipeline.llm_calls` cost logging — the transport a service-run station's model call reports through (a pod uses its terminal line instead; `Llm.usageConfigured` avoids double-counting).
export const usage = (): PgUsage => (usageSingleton ??= new PgUsage(getPool()));

// Stations holds a pool, so it reports its events (ticks, resumes) straight to `pipeline.events`.
export const eventProxy = (): EventProxy =>
  (eventProxySingleton ??= localEventProxy({
    local: () => pipelineRepositories().eventReporter,
  }));

// The reporting half of that hub: `insert`, synchronous and throwing; a producer with nobody to return a status to uses `eventProxy().emit` instead.
export const eventReporter = (): EventReporter => eventProxy();

// The deliveries this service consumes, claimed from its own pool.
export const deliveries = (): EventDeliveriesPort =>
  (deliveriesSingleton ??= new PgEventDeliveries(getPool()));
