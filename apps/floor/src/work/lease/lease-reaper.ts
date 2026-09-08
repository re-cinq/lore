import { trace, type Span } from "@opentelemetry/api";
import { writeAuditLog, type AuditLogEntry } from "../../outbound/audit.js";
import { pipeline } from "../../outbound/queues.js";
import type { LeaseReaper } from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";

const tracer = trace.getTracer("lore.lease");

/** Grace beyond TTL absorbing clock skew between supervisor pod and DB. */
const GRACE_MS = 5 * 60 * 1000;

export interface LeaseReaperDeps {
  leases: LeaseReaper;
  audit: AuditPort;
}

type ExpiredLease = Awaited<
  ReturnType<LeaseReaperDeps["leases"]["reapExpired"]>
>[number];

/** Names the PREVIOUS holder: a lease that expired is a run that stopped reporting, and the holder is the only pointer back to which one. */
function expiredAuditEntry(lease: ExpiredLease): AuditLogEntry {
  return {
    event_type: "lease_expired",
    task_id: lease.task_id,
    payload: {
      branch_name: lease.branch_name,
      previous_holder: lease.holder,
      expired_at:
        lease.expires_at instanceof Date
          ? lease.expires_at.toISOString()
          : String(lease.expires_at),
    },
  };
}

/** One audit row per reaped lease. */
async function auditExpiries(
  expired: ExpiredLease[],
  deps: LeaseReaperDeps,
): Promise<void> {
  for (const lease of expired) {
    await writeAuditLog(expiredAuditEntry(lease), deps.audit);
  }
}

/** The reap itself, inside the caller's span: delete past-grace leases, audit each, and report the count. */
async function reapExpiredLeases(
  deps: LeaseReaperDeps,
  now: Date,
  span: Span,
): Promise<string> {
  const cutoff = new Date(now.getTime() - GRACE_MS);
  const expired = await deps.leases.reapExpired(cutoff);

  await auditExpiries(expired, deps);
  span.setAttribute("expired_count", expired.length);

  if (expired.length > 0) {
    console.log(`[job] lease-reaper: removed ${expired.length} expired leases`);
  }

  return `Reaped ${expired.length} expired leases`;
}

/** Reaper job: deletes leases whose expiry is more than 5 minutes past (grace absorbs clock skew between the supervisor pod and the database), emitting one `lease_expired` audit entry per row; scheduled at 60s tick by the agent's job runner. */
export async function leaseReaperJob(
  deps: LeaseReaperDeps = {
    leases: pipeline().leases,
    audit: pipeline().audit,
  },
  now: Date = new Date(),
): Promise<string> {
  return await tracer.startActiveSpan("lore.lease.expired", async (span) => {
    try {
      return await reapExpiredLeases(deps, now, span);
    } finally {
      span.end();
    }
  });
}
