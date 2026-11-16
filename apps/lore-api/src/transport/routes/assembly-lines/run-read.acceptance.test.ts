import { describe, it, expect } from "vitest";
import { runReadRoute } from "./run-read.js";
import { getResponseMeta } from "../../http/zod-response.js";

describe("run-read", () => {
  it("declares a strict response schema for the run graph", () => {
    const route = runReadRoute(() => null);
    const meta = getResponseMeta(route.options?.plugins);

    expect(meta).toBeDefined();

    const invalidPayload = {
      line: {
        id: "run-1",
        graph: {
          name: 123,
          entry: "node-1",
          exit: "node-2",
          nodes: [],
          edges: [],
        },
      },
      definitionKnown: true,
      nodes: [],
    };

    const result = meta!.schema.safeParse(invalidPayload);

    expect(result.success).toBe(false);
  });
});
