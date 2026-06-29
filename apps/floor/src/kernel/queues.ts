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
import {
  DbLeaseBackend,
  type LeasePool,
} from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import { PgAudit } from "@re-cinq/lore-shared/project/audit/audit-pg.js";

let eventQueueSingleton: PgEventQueue | undefined;
let taskQueueSingleton: PgTaskQueue | undefined;
let leaseBackendSingleton: DbLeaseBackend | undefined;
let auditLogSingleton: PgAudit | undefined;

export const eventQueue = (): PgEventQueue =>
  (eventQueueSingleton ??= new PgEventQueue(getPool()));

export const taskQueue = (): PgTaskQueue =>
  (taskQueueSingleton ??= new PgTaskQueue(getPool()));

/** The cluster lease backend (its reap side feeds the lease-reaper). */
export const leaseBackend = (): DbLeaseBackend =>
  // The real pg pool returns rowCount; LeasePool's narrow type omits it.
  (leaseBackendSingleton ??= new DbLeaseBackend(getPool() as unknown as LeasePool));

/** Append-only audit writer, repo-agnostic (used where no Project is in scope). */
export const auditLog = (): PgAudit =>
  (auditLogSingleton ??= new PgAudit(getPool()));
