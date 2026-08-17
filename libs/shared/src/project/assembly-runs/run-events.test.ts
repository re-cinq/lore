import { describe, it, expect } from "vitest";
import { RUN_START_EVENT, RUN_RESUME_EVENT } from "./run-events.js";

// These pin the WIRE spelling the writers emit. They are deliberately literal:
// the value crosses a process boundary into `pipeline.events`, where a Floor that
// does not recognise it marks the row dead with no retry — so a change here is a
// rollout decision, and the test is the thing that makes it a deliberate one
// rather than a silent edit.
//
// Flipped from `assembly_line.*` on 2026-08-17, once every deployed Floor was at
// or past the release that registered both spellings.
describe("run event names", () => {
  it("RUN_START_EVENT is assembly_run.start", () => {
    expect(RUN_START_EVENT).toBe("assembly_run.start");
  });

  it("RUN_RESUME_EVENT is assembly_run.resume", () => {
    expect(RUN_RESUME_EVENT).toBe("assembly_run.resume");
  });
});
