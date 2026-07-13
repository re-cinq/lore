import { describe, it, expect } from "vitest";
import { triggerAgentSpecTrace } from "../routes.js";

function recordingPool() {
  const calls: Array<{ text: string; params: unknown[] }> = [];

  return {
    calls,
    query: async (text: string, params: unknown[]) => {
      calls.push({ text, params });

      return { rows: [] };
    },
  };
}

describe("triggerAgentSpecTrace", () => {
  it("inserts an internal.ingest.spec_trace event carrying repo, kind and payload", async () => {
    const pool = recordingPool();

    await triggerAgentSpecTrace(pool as never, "re-cinq/lore", "test-report", {
      commit: "abc",
      tests: [],
      results: [],
    });
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].text).toContain("INSERT INTO pipeline.events");
    expect(pool.calls[0].params[0]).toBe("internal.ingest.spec_trace");
    expect(pool.calls[0].params[1]).toBe("internal");
    expect(JSON.parse(pool.calls[0].params[2] as string)).toEqual({
      repo: "re-cinq/lore",
      kind: "test-report",
      payload: { commit: "abc", tests: [], results: [] },
    });
  });

  it("is a no-op when there is no DB pool", async () => {
    await expect(
      triggerAgentSpecTrace(null, "o/r", "coverage", {}),
    ).resolves.toBeUndefined();
  });
});
