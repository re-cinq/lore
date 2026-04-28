import { trace } from "@opentelemetry/api";
import { query } from "../db.js";
import { writeAuditLog } from "../lib/audit.js";

const tracer = trace.getTracer("lore.lease");

interface ExpiredLease {
  branch_name: string;
  task_id: string;
  holder: string;
  expires_at: Date;
}

/**
 * Reaper job: deletes leases whose expiry is more than 5 minutes past,
 * emitting one `lease_expired` audit log entry per row. The 5-minute
 * grace beyond TTL absorbs clock skew between the supervisor pod and
 * the database. Scheduled at 60s tick by the agent's job runner.
 */
export async function leaseReaperJob(): Promise<string> {
  return await tracer.startActiveSpan("lore.lease.expired", async (span) => {
    try {
      const expired = await query<ExpiredLease>(
        `DELETE FROM pipeline.task_leases
          WHERE expires_at < now() - interval '5 minutes'
        RETURNING branch_name, task_id, holder, expires_at`,
      );

      for (const lease of expired) {
        await writeAuditLog({
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
        });
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
