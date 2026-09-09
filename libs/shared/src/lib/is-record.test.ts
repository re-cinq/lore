import { describe, it, expect } from "vitest";
import { isRecord } from "./is-record.js";

describe("isRecord", () => {
  it("accepts a plain object", () => {
    expect(isRecord({ type: "result" })).toBe(true);
  });

  it("rejects an array, which typeof calls an object", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ type: "result" }])).toBe(false);
  });

  it("rejects null and the primitives", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("result")).toBe(false);
    expect(isRecord(7)).toBe(false);
  });
});
