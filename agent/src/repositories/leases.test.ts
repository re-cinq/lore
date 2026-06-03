import { describe, it, expect } from "vitest";
import { InMemoryLeaseRepository, type ExpiredLease } from "./leases.js";

const lease = (over: Partial<ExpiredLease>): ExpiredLease => ({
  branch_name: "lore/task",
  task_id: "t1",
  holder: "pod-a",
  expires_at: new Date("2026-06-03T10:00:00Z"),
  ...over,
});

describe("InMemoryLeaseRepository.deleteExpired", () => {
  it("removes and returns only leases before the cutoff", async () => {
    const repo = new InMemoryLeaseRepository([
      lease({ task_id: "old", expires_at: new Date("2026-06-03T09:00:00Z") }),
      lease({ task_id: "fresh", expires_at: new Date("2026-06-03T11:00:00Z") }),
    ]);

    const expired = await repo.deleteExpired(new Date("2026-06-03T10:00:00Z"));

    expect(expired.map((l) => l.task_id)).toEqual(["old"]);
    expect(repo.leases.map((l) => l.task_id)).toEqual(["fresh"]);
  });

  it("returns an empty array when nothing is past the cutoff", async () => {
    const repo = new InMemoryLeaseRepository([
      lease({ expires_at: new Date("2026-06-03T11:00:00Z") }),
    ]);
    expect(await repo.deleteExpired(new Date("2026-06-03T10:00:00Z"))).toEqual([]);
    expect(repo.leases).toHaveLength(1);
  });
});
