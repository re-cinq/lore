import { describe, it, expect } from "vitest";
import { enforceTrue, enforceOk, enforceIntegerInterval } from "./enforce.js";

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
    const check = () => enforceTrue(false, Error, "must be positive"); // eslint-disable-line re-lint/no-flag-params -- the literal is the condition under test, not a switch

    expect(check).toThrow(new Error("must be positive"));
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

    enforceTrue(true, counting, "lazy"); // eslint-disable-line re-lint/no-flag-params -- the literal is the condition under test, not a switch
    expect(built).toBe(0);
    const failing = () => enforceTrue(false, counting, "lazy"); // eslint-disable-line re-lint/no-flag-params -- the literal is the condition under test, not a switch

    expect(failing).toThrow(new Error("lazy"));
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

describe("enforceIntegerInterval", () => {
  it("passes an integer inside the interval", () => {
    expect(() => enforceIntegerInterval(50, 1, 100, Error)).not.toThrow();
  });

  it("passes the interval bounds themselves", () => {
    expect(() => enforceIntegerInterval(1, 1, 100, Error)).not.toThrow();
    expect(() => enforceIntegerInterval(100, 1, 100, Error)).not.toThrow();
  });

  it("refuses 101 against a maximum of 100 with the default message", () => {
    expect(() => enforceIntegerInterval(101, 1, 100, Error)).toThrow(
      new Error("value must be an integer in 1..100"),
    );
  });

  it("refuses 0 against a minimum of 1", () => {
    expect(() => enforceIntegerInterval(0, 1, 100, Error)).toThrow(
      new Error("value must be an integer in 1..100"),
    );
  });

  it("refuses a non-integer inside the interval", () => {
    expect(() => enforceIntegerInterval(2.5, 1, 100, Error)).toThrow(
      new Error("value must be an integer in 1..100"),
    );
  });

  it("refuses NaN, which no comparison alone would catch", () => {
    expect(() => enforceIntegerInterval(Number.NaN, 1, 100, Error)).toThrow(
      new Error("value must be an integer in 1..100"),
    );
  });

  it("uses the caller's message when one is given", () => {
    expect(() =>
      enforceIntegerInterval(500, 1, 100, Error, "limit is at most 100"),
    ).toThrow(new Error("limit is at most 100"));
  });
});
