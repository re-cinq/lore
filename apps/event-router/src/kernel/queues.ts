// Router's binding of org-wide pipeline.* repositories; lazy singletons (ADR-024).

import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { PgEventDeliveries } from "@re-cinq/lore-shared/project/events/event-deliveries-pg.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";

let pipelineSingleton: PipelineRepositories | undefined;

export const pipeline = (): PipelineRepositories =>
  (pipelineSingleton ??= createPipelineRepositories(getPool()));

let deliveriesSingleton: PgEventDeliveries | undefined;

/** Delivery side of bus; lazy singleton (getPool throws until initPool runs). */
export const deliveries = (): PgEventDeliveries =>
  (deliveriesSingleton ??= new PgEventDeliveries(getPool()));

let clusterAgentsSingleton: PgClusterAgents | undefined;

/** Cluster-agent registry: per-agent token lookup for reporting (FR5); lazy singleton. */
export const clusterAgents = (): PgClusterAgents =>
  (clusterAgentsSingleton ??= new PgClusterAgents(getPool()));
