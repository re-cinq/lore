import { describe, it, expect } from "vitest";
import { isAlreadyExistsError } from "./k8s-errors.js";

describe("isAlreadyExistsError", () => {
  it("returns true when err.code is 409", () => {
    expect(isAlreadyExistsError({ code: 409 })).toBe(true);
  });

  it("returns true when err.statusCode is 409", () => {
    expect(isAlreadyExistsError({ statusCode: 409 })).toBe(true);
  });

  it("returns true when err.response.statusCode is 409", () => {
    expect(isAlreadyExistsError({ response: { statusCode: 409 } })).toBe(true);
  });

  it("returns true when err.body.reason is AlreadyExists", () => {
    expect(isAlreadyExistsError({ body: { reason: "AlreadyExists" } })).toBe(true);
  });

  it("returns true when err.body.code is 409", () => {
    expect(isAlreadyExistsError({ body: { code: 409 } })).toBe(true);
  });

  it("returns true for the kubernetes client message dump with HTTP-Code 409", () => {
    const err = {
      message:
        'HTTP-Code: 409 Message: Unknown API Status Code! Body: {"reason":"AlreadyExists","message":"jobs.batch \\"loretask-job-b7777726\\" already exists","code":409}',
    };
    expect(isAlreadyExistsError(err)).toBe(true);
  });

  it("returns true when the message contains already exists", () => {
    expect(isAlreadyExistsError(new Error('jobs.batch "x" already exists'))).toBe(true);
  });

  it("returns true when the message names the AlreadyExists reason without the spaced phrase", () => {
    expect(isAlreadyExistsError({ message: "Conflict, reason=AlreadyExists" })).toBe(true);
  });

  it("returns false for a 500 error", () => {
    expect(isAlreadyExistsError({ code: 500, message: "internal error" })).toBe(false);
  });

  it("returns false when a body is present but is a different conflict", () => {
    expect(isAlreadyExistsError({ body: { reason: "Invalid", code: 422 }, message: "bad" })).toBe(false);
  });

  it("returns false for an object with no recognizable fields", () => {
    expect(isAlreadyExistsError({ foo: 1 })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAlreadyExistsError(null)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isAlreadyExistsError("boom")).toBe(false);
  });
});
