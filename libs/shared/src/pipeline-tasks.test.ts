import { describe, it, expect } from "vitest";
import { isGraphIngestTaskType } from "./pipeline-tasks.js";

describe("isGraphIngestTaskType", () => {
  it("returns true for ingest-specs", () => {
    expect(isGraphIngestTaskType("ingest-specs")).toBe(true);
  });

  it("returns true for ingest-adrs", () => {
    expect(isGraphIngestTaskType("ingest-adrs")).toBe(true);
  });

  it("returns true for ingest-tests", () => {
    expect(isGraphIngestTaskType("ingest-tests")).toBe(true);
  });

  it("returns false for implementation", () => {
    expect(isGraphIngestTaskType("implementation")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGraphIngestTaskType("")).toBe(false);
  });
});
