import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { parseJsonBody } from "./raw-body.js";

describe("parseJsonBody", () => {
  it("parses a valid JSON body into the typed object", () => {
    expect(parseJsonBody<{ a: number }>('{"a":1}', "review-start")).toEqual({
      a: 1,
    });
  });

  it("throws a 400 naming the caller and what the parser objected to", () => {
    let thrown: unknown;

    try {
      parseJsonBody("{ not json", "ci-ingest");
    } catch (err) {
      thrown = err;
    }
    expect(Boom.isBoom(thrown as Error)).toBe(true);
    expect((thrown as Boom.Boom).output.statusCode).toBe(400);
    const { error } = (thrown as Boom.Boom).output.payload as { error: string };

    // Asserted in two parts rather than as one literal: the ROUTE and the offending
    // POSITION are this function's contract, but the sentence around them is V8's,
    // and V8 rewords it between Node versions — 20 ends at "position 2" where 24
    // appends "(line 1 column 3)". Pinning the whole string tests the runtime.
    expect(error).toContain("invalid JSON in ci-ingest body:");
    expect(error).toContain("at position 2");
  });
});
