import { describe, it, expect } from "vitest";
import { formatSeconds } from "./format-time";

describe("formatSeconds", () => {
  it("formats whole minutes and seconds as m:ss", () => {
    expect(formatSeconds(75)).toBe("1:15");
  });

  it("zero-pads seconds under ten", () => {
    expect(formatSeconds(5)).toBe("0:05");
  });

  it("returns 0:00 for zero", () => {
    expect(formatSeconds(0)).toBe("0:00");
  });

  it("clamps a negative input to 0:00", () => {
    expect(formatSeconds(-3)).toBe("0:00");
  });
});
