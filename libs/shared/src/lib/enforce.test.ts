import { describe, it, expect } from "vitest";
import { enforceTrue, enforceOk } from "./enforce.js";

type Result = { ok: true; value: number } | { ok: false; status: number; reason: string };

describe("enforceTrue", () => {
  it("returns without throwing when the condition is truthy", () => {
    expect(() => enforceTrue(1, "unused")).not.toThrow();
  });

  it("throws an Error with the message when given a string and the condition is false", () => {
    expect(() => enforceTrue(false, "must be positive")).toThrow(new Error("must be positive"));
  });

  it("throws the provided Error instance when the condition is false", () => {
    const boom = new RangeError("out of range");
    expect(() => enforceTrue(0, boom)).toThrow(boom);
  });

  it("only invokes the thunk on failure, and throws its result", () => {
    let built = 0;
    const factory = (): Error => {
      built++;
      return new Error("lazy");
    };
    enforceTrue(true, factory);
    expect(built).toBe(0);
    expect(() => enforceTrue(null, factory)).toThrow(new Error("lazy"));
    expect(built).toBe(1);
  });

  it("narrows the checked value for the happy path", () => {
    const value: string | undefined = "x";
    enforceTrue(value, "missing");
    // Type-level: `value` is now `string`; this line would not compile if it stayed `string | undefined`.
    expect(value.length).toBe(1);
  });
});

describe("enforceOk", () => {
  it("returns and narrows to the ok branch when ok is true", () => {
    const result: Result = { ok: true, value: 42 };
    enforceOk(result, () => new Error("unused"));
    // Type-level: `result` is now the ok branch; `.value` would not compile otherwise.
    expect(result.value).toBe(42);
  });

  it("throws an error built from the failure branch's fields when ok is false", () => {
    const result: Result = { ok: false, status: 400, reason: "bad repo" };
    expect(() => enforceOk(result, (f) => new Error(`${f.status}: ${f.reason}`))).toThrow(
      new Error("400: bad repo"),
    );
  });
});
