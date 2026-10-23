import { describe, expect, it } from "vitest";
import { digestQueues } from "./digest-queues.js";

const post = (runId: string, status: string, postedAt: string) => ({
  runId,
  status,
  postedAt,
});

const keys = (rows: { ref: string; state: string; run_id: string | null }[]) =>
  rows.map((row) => [row.ref, row.state, row.run_id]);

describe("digestQueues", () => {
  it("shows today's claimed post as current, parks the newest post when it failed, and lists the posted ones under recent", () => {
    const queues = digestQueues([
      post("run-3", "claimed", "2026-10-23T07:00:00Z"),
      post("run-2", "failed", "2026-10-22T07:00:00Z"),
      post("run-1", "posted", "2026-10-21T07:00:00Z"),
    ]);

    expect({
      current: keys(queues.current),
      parked: keys(queues.parked),
      recent: keys(queues.recent),
      backlog: queues.backlog,
    }).toEqual({
      current: [["2026-10-23", "claimed", "run-3"]],
      parked: [["2026-10-22", "failed", "run-2"]],
      recent: [["2026-10-21", "posted", "run-1"]],
      backlog: [],
    });
  });

  it("parks nothing once a later post went out after a failed one", () => {
    const queues = digestQueues([
      post("run-2", "posted", "2026-10-22T07:00:00Z"),
      post("run-1", "failed", "2026-10-21T07:00:00Z"),
    ]);

    expect(queues.parked).toEqual([]);
  });
});
