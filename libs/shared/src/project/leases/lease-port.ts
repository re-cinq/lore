import { trace, type Span, type Tracer } from "@opentelemetry/api";
import {
  TaskLeaseSchema,
  TASK_LEASE_COLUMNS,
} from "../../models/task-lease.js";
import type { WireOf } from "../../lib/wire-schema.js";

/** Postgres interface for DbLeaseBackend (query + rowCount). */
export interface LeasePool {
  query<R = unknown>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export const DEFAULT_TTL_SEC = 600;

export const tracer: Tracer = trace.getTracer("lore.lease");

export const EXPIRED_LEASE_SHAPE = TaskLeaseSchema.pick({
  branchName: true,
  taskId: true,
  holder: true,
  expiresAt: true,
}).shape;

/** Swept lease row (branch/task/holder/expiry, named from the model); `expires_at` widens to `Date | string` since the File backend reads its own JSON-serialized copy back through the same type. */
export type ExpiredLease = Omit<
  WireOf<typeof EXPIRED_LEASE_SHAPE, typeof TASK_LEASE_COLUMNS>,
  "expires_at"
> & { expires_at: Date | string };

export interface AcquireResult {
  acquired: boolean;
  /** Set when acquired === false; holder of the conflicting lease. */
  currentHolder?: string;
  /** Set on takeover from expired prior holder; undefined on fresh insert. */
  tookOverFrom?: string;
}

/** Supervisor lease abstraction with Db + File implementations. */
export interface LeaseBackend {
  /** `taskId` is null for task-less runs (detection assembly lines). */
  acquire(
    branchName: string,
    taskId: string | null,
    holder: string,
    ttlSec?: number,
  ): Promise<AcquireResult>;

  refresh(
    branchName: string,
    holder: string,
    ttlSec?: number,
    phase?: string,
  ): Promise<boolean>;

  release(branchName: string, holder: string): Promise<boolean>;

  /** Sweep expired leases (expires_at < cutoff) for audit. */
  reapExpired(cutoff: Date): Promise<ExpiredLease[]>;
}

/** Shape the result for a won upsert (takeover vs. fresh acquire); shared by the Db and File backends. */
export function acquiredResult(
  span: Span,
  tookOverFrom: string | undefined,
): AcquireResult {
  span.setAttribute("outcome", tookOverFrom ? "takeover" : "acquired");

  if (tookOverFrom) {
    span.setAttribute("took_over_from", tookOverFrom);
  }

  return tookOverFrom ? { acquired: true, tookOverFrom } : { acquired: true };
}

/** The narrow reap surface the lease-reaper depends on (DbLeaseBackend satisfies it). */
export interface LeaseReaper {
  reapExpired(cutoff: Date): Promise<ExpiredLease[]>;
}
