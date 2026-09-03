import { describe, it, expect } from "vitest";
import { enforceTrue, enforceOk } from "./enforce.js";

type Result =
  { ok: true; value: number } | { ok: false; status: number; error: string };

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

describe("enforceTrue", () => {
  it("returns without throwing when the condition is truthy", () => {
    expect(() => enforceTrue(1, Error, "unused")).not.toThrow();
  });

  it("throws new Error with the message when errorType is Error and the condition is false", () => {
    expect(() => enforceTrue(false, Error, "must be positive")).toThrow(
      new Error("must be positive"),
    );
  });

  it("constructs an Error subclass with the message when given a class", () => {
    expect(() => enforceTrue(0, ValidationError, "bad input")).toThrow(
      new ValidationError("bad input"),
    );
  });

  it("calls a factory with the message and throws its result", () => {
    const outOfRange = (message: string): Error => new RangeError(message);

    expect(() => enforceTrue(null, outOfRange, "out of range")).toThrow(
      new RangeError("out of range"),
    );
  });

  it("only builds the error on failure", () => {
    let built = 0;
    const counting = (message: string): Error => {
      built++;

      return new Error(message);
    };

    enforceTrue(true, counting, "lazy");
    expect(built).toBe(0);
    expect(() => enforceTrue(false, counting, "lazy")).toThrow(
      new Error("lazy"),
    );
    expect(built).toBe(1);
  });

  it("narrows the checked value for the happy path", () => {
    const value: string | undefined = "x";

    enforceTrue(value, Error, "missing");
    expect(value.length).toBe(1);
  });
});

describe("enforceOk", () => {
  it("returns and narrows to the ok branch when ok is true", () => {
    const result: Result = { ok: true, value: 42 };

    enforceOk(result, Error);
    expect(result.value).toBe(42);
  });

  it("throws errorType(result.error) when ok is false", () => {
    const result: Result = { ok: false, status: 400, error: "bad repo" };

    expect(() => enforceOk(result, ValidationError)).toThrow(
      new ValidationError("bad repo"),
    );
  });

  it("defaults the errorType to Error", () => {
    const result: Result = { ok: false, status: 400, error: "bad repo" };

    expect(() => enforceOk(result)).toThrow(new Error("bad repo"));
  });

  it("calls a factory with the failure error message", () => {
    const badRequest = (message: string): Error =>
      new RangeError(`400: ${message}`);
    const result: Result = { ok: false, status: 400, error: "no repo field" };

    expect(() => enforceOk(result, badRequest)).toThrow(
      new RangeError("400: no repo field"),
    );
  });
});
