/**
 * Repository layer: one interface per table, a Postgres implementation
 * (production) and an in-memory implementation (tests). DB-backed modules
 * depend on the interface and default to the Pg singletons below, so
 * production call sites stay unchanged while tests inject the in-memory
 * double and assert on its captured state.
 *
 * Instantiating a `Pg…` repo does NOT touch the database — `query` inits
 * the pool lazily on first call.
 */
export * from "./audit-log.js";
export * from "./leases.js";
export * from "./baseline.js";
export * from "./tasks.js";
export * from "./episodes.js";
export * from "./memories.js";
export * from "./repos.js";

import { PgAuditLogRepository } from "./audit-log.js";
import { PgLeaseRepository } from "./leases.js";
import { PgBaselineRepository } from "./baseline.js";
import { PgTasksRepository } from "./tasks.js";
import { PgEpisodeRepository } from "./episodes.js";
import { PgMemoryRepository } from "./memories.js";
import { PgReposRepository } from "./repos.js";

export const pgAuditLog = new PgAuditLogRepository();
export const pgLeases = new PgLeaseRepository();
export const pgBaseline = new PgBaselineRepository();
export const pgTasks = new PgTasksRepository();
export const pgEpisodes = new PgEpisodeRepository();
export const pgMemories = new PgMemoryRepository();
export const pgRepos = new PgReposRepository();
