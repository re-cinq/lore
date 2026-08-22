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
    expect((thrown as Boom.Boom).output).toMatchObject({
      statusCode: 400,
      // The route, so a 400 in the log says WHICH ingress rejected the body, and
      // the parser's own complaint, which names the offending position.
      payload: {
        error:
          "invalid JSON in ci-ingest body: Expected property name or '}' in JSON at position 2",
      },
    });
  });
});
