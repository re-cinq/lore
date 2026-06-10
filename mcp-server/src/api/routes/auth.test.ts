import { describe, it, expect } from "vitest";
import { getRequiredScope } from "./auth.js";

describe("getRequiredScope", () => {
  it("returns write for the coverage route", () => {
    expect(getRequiredScope("/api/repos/o/r/coverage")).toBe("write");
  });

  it("returns write for the test-report route", () => {
    expect(getRequiredScope("/api/repos/o/r/test-report")).toBe("write");
  });

  it("returns admin for the tokens route", () => {
    expect(getRequiredScope("/api/tokens")).toBe("admin");
  });

  it("returns admin for the onboard route", () => {
    expect(getRequiredScope("/api/onboard")).toBe("admin");
  });

  it("returns admin for the dark-factory settings route via override", () => {
    expect(getRequiredScope("/api/repos/o/r/settings/dark-factory")).toBe("admin");
  });

  it("returns admin for the dark-factory route with a query string", () => {
    expect(getRequiredScope("/api/repos/o/r/settings/dark-factory?x=1")).toBe("admin");
  });

  it("returns read for an unmapped route", () => {
    expect(getRequiredScope("/api/unknown/path")).toBe("read");
  });

  it("returns read for the repo-status route", () => {
    expect(getRequiredScope("/api/repo-status?repo=o/r")).toBe("read");
  });
});
