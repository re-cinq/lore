import { trace } from "@opentelemetry/api";
import { writeAuditLog } from "../../jobs/dark-factory/audit.js";
import { leaseBackend, auditLog } from "../../kernel/queues.js";
import type { LeaseReaper } from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";

const tracer = trace.getTracer("lore.lease");

/** Grace beyond TTL absorbing clock skew between supervisor pod and DB. */
const GRACE_MS = 5 * 60 * 1000;

export interface LeaseReaperDeps {
  leases: LeaseReaper;
  audit: AuditPort;
}

/**
 * Reaper job: deletes leases whose expiry is more than 5 minutes past,
 * emitting one `lease_expired` audit log entry per row. The 5-minute
 * grace beyond TTL absorbs clock skew between the supervisor pod and
 * the database. Scheduled at 60s tick by the agent's job runner.
 */
export async function leaseReaperJob(
  deps: LeaseReaperDeps = { leases: leaseBackend(), audit: auditLog() },
  now: Date = new Date(),
): Promise<string> {
  return await tracer.startActiveSpan("lore.lease.expired", async (span) => {
    try {
      const cutoff = new Date(now.getTime() - GRACE_MS);
      const expired = await deps.leases.reapExpired(cutoff);

      for (const lease of expired) {
        await writeAuditLog(
          {
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
          },
          deps.audit,
        );
      }

      span.setAttribute("expired_count", expired.length);
      if (expired.length > 0) {
        console.log(
          `[job] lease-reaper: removed ${expired.length} expired leases`,
        );
      }
      return `Reaped ${expired.length} expired leases`;
    } finally {
      span.end();
    }
  });
}
