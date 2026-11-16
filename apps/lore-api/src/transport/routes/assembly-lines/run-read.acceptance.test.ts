import { describe, it, expect } from "vitest";
import { runReadRoute } from "./run-read.js";
import { RunRowSchema } from "./run-row.js";
import { getResponseMeta } from "../../http/zod-response.js";
import { optionsOf } from "../../openapi/operation-responses.js";

describe("run-read", () => {
  it("declares a strict response schema for the run graph", () => {
    const route = runReadRoute(() => null);
    const meta = getResponseMeta(optionsOf(route).plugins);

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
    expect(RunRowSchema.shape.graph.safeParse({ name: 123 }).success).toBe(
      false,
    );
  });
});
