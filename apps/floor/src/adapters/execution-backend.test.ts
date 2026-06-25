import { describe, it, expect } from "vitest";
import { decideExecutionBackend, bucketFor } from "./execution-backend.js";

describe("bucketFor", () => {
  it("returns a stable value in 0..99", () => {
    const b = bucketFor("task-123");
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
    expect(bucketFor("task-123")).toBe(b);
  });
});

describe("decideExecutionBackend", () => {
  it("routes to loretask when the cluster gate is off (even if the repo opted in)", () => {
    expect(
      decideExecutionBackend({ clusterEnabled: false, repoBackend: "agent-cr" }),
    ).toBe("loretask");
  });

  it("routes to loretask when the repo has not opted in", () => {
    expect(decideExecutionBackend({ clusterEnabled: true })).toBe("loretask");
    expect(
      decideExecutionBackend({ clusterEnabled: true, repoBackend: "loretask" }),
    ).toBe("loretask");
  });

  it("routes to agent-cr when both gates are on and no rollout cap is set", () => {
    expect(
      decideExecutionBackend({ clusterEnabled: true, repoBackend: "agent-cr" }),
    ).toBe("agent-cr");
  });

  it("ignores the percentage gate when no taskId is given", () => {
    expect(
      decideExecutionBackend({ clusterEnabled: true, repoBackend: "agent-cr", percent: 0 }),
    ).toBe("agent-cr");
  });

  it("applies the rollout bucket: in-bucket → agent-cr, out-of-bucket → loretask", () => {
    const taskId = "task-123";
    const b = bucketFor(taskId);
    // bucket >= percent → out of the rollout → loretask
    expect(
      decideExecutionBackend({ clusterEnabled: true, repoBackend: "agent-cr", percent: b, taskId }),
    ).toBe("loretask");
    // bucket < percent → in the rollout → agent-cr
    expect(
      decideExecutionBackend({ clusterEnabled: true, repoBackend: "agent-cr", percent: b + 1, taskId }),
    ).toBe("agent-cr");
  });
});
