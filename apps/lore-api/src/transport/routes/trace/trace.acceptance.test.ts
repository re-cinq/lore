import { describe, it, expect } from "vitest";
import { traceRoute } from "./trace.js";
import { getResponseMeta } from "../../http/zod-response.js";
import { optionsOf } from "../../openapi/operation-responses.js";

describe("trace", () => {
  it("declares strict response schemas for trace shapes", () => {
    const route = traceRoute();
    const meta = getResponseMeta(optionsOf(route).plugins);

    expect(meta).toBeDefined();

    const invalidDocumentPayload = {
      sections: "not-an-array",
      statements: [],
      coverage: {
        testable: "not-a-number",
      },
    };

    const result = meta!.schema.safeParse(invalidDocumentPayload);

    expect(result.success).toBe(false);
  });
});
