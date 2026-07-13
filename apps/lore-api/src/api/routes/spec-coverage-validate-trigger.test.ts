import { describe, it, expect } from "vitest";
import { triggerAgentSpecCoverageValidate } from "../routes.js";

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

describe("triggerAgentSpecCoverageValidate", () => {
  it("inserts an internal.ingest.spec_coverage_validate event for the repo", async () => {
    const pool = recordingPool();

    await triggerAgentSpecCoverageValidate(pool as never, "re-cinq/lore");
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].text).toContain("INSERT INTO pipeline.events");
    expect(pool.calls[0].params[0]).toBe(
      "internal.ingest.spec_coverage_validate",
    );
    expect(JSON.parse(pool.calls[0].params[2] as string)).toEqual({
      repo: "re-cinq/lore",
    });
  });

  it("is a no-op when there is no DB pool", async () => {
    await expect(
      triggerAgentSpecCoverageValidate(null, "o/r"),
    ).resolves.toBeUndefined();
  });

  it("swallows insert errors so a flaky DB never breaks the ingest response", async () => {
    const pool = {
      query: async () => {
        throw new Error("db down");
      },
    };

    await expect(
      triggerAgentSpecCoverageValidate(pool as never, "o/r"),
    ).resolves.toBeUndefined();
  });
});
