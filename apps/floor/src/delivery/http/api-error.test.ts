import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { apiError, rethrowBoom } from "./api-error.js";

describe("apiError", () => {
  it("carries the status hapi renders", () => {
    const err = apiError(404)("assembly line not found");

    expect(Boom.isBoom(err)).toBe(true);
    expect(err.output.statusCode).toBe(404);
  });

  it("payload is the { error } envelope the web UI proxies, not boom's default", () => {
    expect(apiError(404)("assembly line not found").output.payload).toEqual({
      error: "assembly line not found",
    });
  });

  it("extra data rides alongside the message", () => {
    expect(apiError(409, { run_id: "abc" })("busy").output.payload).toEqual({
      error: "busy",
      run_id: "abc",
    });
  });
});

describe("rethrowBoom", () => {
  it("a refusal a guard already shaped passes straight back out", () => {
    const refusal = apiError(404)("assembly line not found");

    expect(() => rethrowBoom(refusal)).toThrow(refusal);
  });

  it("an ordinary failure is the catch block's to shape", () => {
    expect(rethrowBoom(new Error("connection reset"))).toBeUndefined();
  });
});
