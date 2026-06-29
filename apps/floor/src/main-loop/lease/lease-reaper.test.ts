import { describe, it, expect } from "vitest";
import { leaseReaperJob } from "./lease-reaper.js";
import {
  InMemoryAuditLogRepository,
  InMemoryLeaseRepository,
  type ExpiredLease,
} from "../../kernel/repositories/index.js";

const NOW = new Date("2026-06-03T10:00:00Z");
// Anything expiring before 09:55 (NOW − 5min grace) is reaped.
const STALE = new Date("2026-06-03T09:50:00Z");
const RECENT = new Date("2026-06-03T09:58:00Z");

const lease = (over: Partial<ExpiredLease>): ExpiredLease => ({
  branch_name: "lore/task",
  task_id: "t1",
  holder: "pod-a",
  expires_at: STALE,
  ...over,
});

describe("leaseReaperJob", () => {
  it("writes one lease_expired audit entry per reaped lease", async () => {
    const leases = new InMemoryLeaseRepository([
      lease({ task_id: "one", holder: "pod-a", branch_name: "b1" }),
      lease({ task_id: "two", holder: "pod-b", branch_name: "b2" }),
    ]);
    const audit = new InMemoryAuditLogRepository();

    const result = await leaseReaperJob({ leases, audit }, NOW);

    expect(result).toBe("Reaped 2 expired leases");
    expect(audit.rows).toMatchObject([
      { event_type: "lease_expired", task_id: "one", payload: { branch_name: "b1", previous_holder: "pod-a" } },
      { event_type: "lease_expired", task_id: "two", payload: { branch_name: "b2", previous_holder: "pod-b" } },
    ]);
  });

  it("ISO-stringifies a Date expiry in the audit payload", async () => {
    const leases = new InMemoryLeaseRepository([lease({ expires_at: STALE })]);
    const audit = new InMemoryAuditLogRepository();
    await leaseReaperJob({ leases, audit }, NOW);
    expect(audit.rows[0].payload.expired_at).toBe(STALE.toISOString());
  });

  it("passes through a string expiry without calling toISOString", async () => {
    const leases = new InMemoryLeaseRepository([lease({ expires_at: "2026-06-03T09:50:00+00:00" })]);
    const audit = new InMemoryAuditLogRepository();
    await leaseReaperJob({ leases, audit }, NOW);
    expect(audit.rows[0].payload.expired_at).toBe("2026-06-03T09:50:00+00:00");
  });

  it("writes no audit entries and reports zero when nothing is expired", async () => {
    const leases = new InMemoryLeaseRepository([lease({ expires_at: RECENT })]);
    const audit = new InMemoryAuditLogRepository();
    const result = await leaseReaperJob({ leases, audit }, NOW);
    expect(result).toBe("Reaped 0 expired leases");
    expect(audit.rows).toEqual([]);
  });
});
