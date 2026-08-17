import { describe, it, expect } from "vitest";
import { runIdOf } from "./run-id";

describe("runIdOf", () => {
  it("returns assembly_run_id when the API sends the current spelling", () => {
    expect(runIdOf({ assembly_run_id: "run-1" })).toBe("run-1");
  });

  it("returns assembly_line_id when only the pre-rename spelling is present", () => {
    expect(runIdOf({ assembly_line_id: "run-1" })).toBe("run-1");
  });

  it("prefers assembly_run_id when both are present", () => {
    expect(
      runIdOf({ assembly_run_id: "run-1", assembly_line_id: "run-1" }),
    ).toBe("run-1");
  });

  it("returns null when the response names no run", () => {
    expect(runIdOf({})).toBeNull();
    expect(
      runIdOf({ assembly_run_id: null, assembly_line_id: null }),
    ).toBeNull();
  });
});
