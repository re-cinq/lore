import { describe, it, expect } from "vitest";
import { getRequiredScope } from "./auth.js";

describe("getRequiredScope", () => {
  it("returns write for the coverage route", () => {
    expect(getRequiredScope("/api/repos/o/r/coverage")).toBe("write");
  });

  it("returns write for the test-report route", () => {
    expect(getRequiredScope("/api/repos/o/r/test-report")).toBe("write");
  });
});
