import { describe, it, expect } from "vitest";
import { RUN_START_EVENT, RUN_RESUME_EVENT } from "./run-events.js";

describe("run event names", () => {
  it("RUN_START_EVENT is assembly_run.start, a wire spelling an unrecognizing Floor dead-letters", () => {
    expect(RUN_START_EVENT).toBe("assembly_run.start");
  });

  it("RUN_RESUME_EVENT is assembly_run.resume, a wire spelling an unrecognizing Floor dead-letters", () => {
    expect(RUN_RESUME_EVENT).toBe("assembly_run.resume");
  });
});
