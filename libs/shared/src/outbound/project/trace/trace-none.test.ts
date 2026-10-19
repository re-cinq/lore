import { describe, it, expect } from "vitest";
import { NoGraphTrace } from "./trace-none.js";

describe("NoGraphTrace", () => {
  const trace = new NoGraphTrace("lore-api");

  it("returns no failures, no callers and an empty graph context when no graph is configured", async () => {
    expect({
      failures: await trace.failuresTouching(),
      callers: await trace.callers(),
      context: await trace.graphContext(),
    }).toEqual({
      failures: [],
      callers: [],
      context: {
        statements: [],
        adrRefs: [],
        testSelectors: [],
        truncated: false,
      },
    });
  });

  it("throws naming lore-api for a document read when no graph is configured", async () => {
    await expect(trace.document()).rejects.toThrow(
      new Error("lore-api has no Dgraph client (LORE_DGRAPH_HTTP unset)"),
    );
  });
});
