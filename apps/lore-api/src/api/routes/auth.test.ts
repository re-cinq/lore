import { describe, it, expect } from "vitest";
import { getRequiredScope } from "./auth.js";

// getRequiredScope now governs only the still-bridged routes (impact, features)
// plus the default; migrated routes enforce their scope declaratively via
// bearerScope, not this map.
describe("getRequiredScope", () => {
  it("returns write for the impact route", () => {
    expect(getRequiredScope("/api/repos/o/r/impact", "POST")).toBe("write");
  });

  it("gates feature writes behind write while list/get stay read", () => {
    expect(getRequiredScope("/api/repos/o/r/features", "GET")).toBe("read");
    expect(getRequiredScope("/api/repos/o/r/features/x", "POST")).toBe("write");
  });

  it("returns read for an unmapped route", () => {
    expect(getRequiredScope("/api/unknown/path")).toBe("read");
  });
});
