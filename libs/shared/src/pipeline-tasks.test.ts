import { describe, it, expect } from "vitest";
import { isGraphIngestTaskType } from "./pipeline-tasks.js";

describe("isGraphIngestTaskType", () => {
  it("returns true for ingest-tests", () => {
    expect(isGraphIngestTaskType("ingest-tests")).toBe(true);
  });

  it("returns false for ingest-specs (docs project via the CI trigger, not a task)", () => {
    expect(isGraphIngestTaskType("ingest-specs")).toBe(false);
  });

  it("returns false for ingest-adrs (docs project via the CI trigger, not a task)", () => {
    expect(isGraphIngestTaskType("ingest-adrs")).toBe(false);
  });

  it("returns false for implementation", () => {
    expect(isGraphIngestTaskType("implementation")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGraphIngestTaskType("")).toBe(false);
  });
});
