import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { parseJsonBody } from "./raw-body.js";

describe("parseJsonBody", () => {
  it("parses a valid JSON body into the typed object", () => {
    expect(parseJsonBody<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws a 400 Boom.badRequest on a malformed body", () => {
    let thrown: unknown;

    try {
      parseJsonBody("{ not json");
    } catch (err) {
      thrown = err;
    }
    expect(Boom.isBoom(thrown as Error)).toBe(true);
    expect((thrown as Boom.Boom).output.statusCode).toBe(400);
  });
});
