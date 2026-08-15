import { describe, it, expect } from "vitest";
import { RUN_START_EVENT, RUN_RESUME_EVENT } from "./run-events.js";

describe("run event names", () => {
  it("RUN_START_EVENT is the legacy wire spelling assembly_line.start", () => {
    expect(RUN_START_EVENT).toBe("assembly_line.start");
  });

  it("RUN_RESUME_EVENT is the legacy wire spelling assembly_line.resume", () => {
    expect(RUN_RESUME_EVENT).toBe("assembly_line.resume");
  });
});
