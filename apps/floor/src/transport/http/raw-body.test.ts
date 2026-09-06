import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { parseJsonBody } from "./raw-body.js";

describe("parseJsonBody", () => {
  it("parses a valid JSON body into the typed object", () => {
    expect(parseJsonBody<{ a: number }>('{"a":1}', "review-start")).toEqual({
      a: 1,
    });
  });

  it("throws a 400 naming the caller and offending position, in two checks since V8 rewords the message between Node versions", () => {
    let thrown: unknown;

    try {
      parseJsonBody("{ not json", "ci-ingest");
    } catch (err) {
      thrown = err;
    }
    expect(Boom.isBoom(thrown as Error)).toBe(true);
    expect((thrown as Boom.Boom).output.statusCode).toBe(400);
    const { error } = (thrown as Boom.Boom).output.payload as { error: string };

    expect(error).toContain("invalid JSON in ci-ingest body:");
    expect(error).toContain("at position 2");
  });
});
