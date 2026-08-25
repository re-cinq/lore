import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { apiError, rethrowBoom } from "./api-error.js";

describe("apiError", () => {
  it("carries the status on a boom hapi renders", () => {
    const err = apiError(409)("cannot finalize a feature in 'draft' state");

    expect(Boom.isBoom(err)).toBe(true);
    expect(err.output.statusCode).toBe(409);
  });

  it("payload is the house { error } envelope, not boom's default", () => {
    expect(apiError(404)("feature not found").output.payload).toEqual({
      error: "feature not found",
    });
  });

  it("extra data rides alongside the message", () => {
    expect(
      apiError(409, { run_id: "abc", runId: "abc" })(
        "a run is already in flight for this feature",
      ).output.payload,
    ).toEqual({
      error: "a run is already in flight for this feature",
      run_id: "abc",
      runId: "abc",
    });
  });

  it("a data key named error does not override the message", () => {
    expect(
      apiError(400, { error: "shadowed" })("real message").output.payload,
    ).toEqual({
      error: "real message",
    });
  });
});

describe("rethrowBoom", () => {
  it("a refusal a guard already shaped passes straight back out", () => {
    const refusal = apiError(404)("feature not found");

    expect(() => rethrowBoom(refusal)).toThrow(refusal);
  });

  it("an ordinary failure is the catch block's to shape", () => {
    expect(rethrowBoom(new Error("connection reset"))).toBeUndefined();
  });
});
