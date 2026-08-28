import { describe, it, expect } from "vitest";
import { pruneTelemetry, RETENTION_DAYS } from "./log-retention.js";

const store = (removed: number) => ({
  pruneOld: (days: number) => Promise.resolve(removed + days * 0),
});

describe("pruneTelemetry", () => {
  it("prunes both tables at the retention window and reports each count", async () => {
    expect(
      await pruneTelemetry({ runEvents: store(4), podLogs: store(9) }),
    ).toBe(
      `pruned older than ${RETENTION_DAYS}d — agent_run_events 4, pod_log_chunks 9`,
    );
  });

  it("still prunes the other table when one fails, so neither grows unbounded", async () => {
    // Settled, not all: these are two independent sweeps, and letting a failure
    // in one skip the other is how a table quietly outgrows its window.
    const result = await pruneTelemetry({
      runEvents: {
        pruneOld: () => Promise.reject(new Error("deadlock detected")),
      },
      podLogs: store(3),
    });

    expect(result).toBe(
      `pruned older than ${RETENTION_DAYS}d — agent_run_events FAILED (deadlock detected), pod_log_chunks 3`,
    );
  });

  it("honours an explicit window, so a deployment can keep less", async () => {
    expect(
      await pruneTelemetry({
        runEvents: store(0),
        podLogs: store(0),
        days: 3,
      }),
    ).toContain("older than 3d");
  });
});
