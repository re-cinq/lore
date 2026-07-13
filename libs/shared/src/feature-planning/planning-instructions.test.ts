import { describe, it, expect } from "vitest";
import {
  PLANNING_INSTRUCTIONS,
  PLANNING_EXAMPLE,
} from "./planning-instructions.js";
import { parseGapResult } from "./gap-result.js";

describe("PLANNING_INSTRUCTIONS", () => {
  it("ships an example that parses cleanly against the GapResult schema", () => {
    expect(parseGapResult(PLANNING_EXAMPLE)).toEqual(PLANNING_EXAMPLE);
  });

  it("starts the example with an Overview section that has no questions", () => {
    expect(PLANNING_EXAMPLE.sections[0].title).toBe("Overview");
    expect(PLANNING_EXAMPLE.sections[0].questions).toBeUndefined();
  });

  it("pins the dynamic-sections schema field names", () => {
    for (const field of [
      "sections",
      "content",
      "questions",
      "why",
      "mockups",
      "split_suggestion",
    ]) {
      expect(PLANNING_INSTRUCTIONS).toContain(field);
    }
  });

  it("mandates an Overview-first, gap-closing, integration-focused contract", () => {
    expect(PLANNING_INSTRUCTIONS).toContain('titled "Overview"');
    expect(PLANNING_INSTRUCTIONS).toContain("## Integration");
    expect(PLANNING_INSTRUCTIONS).toContain("GAP-CLOSING");
  });

  it("forbids task breakdown / sizing / ordering questions", () => {
    expect(PLANNING_INSTRUCTIONS).toMatch(/task sizing/i);
    expect(PLANNING_INSTRUCTIONS).toMatch(/user-story/i);
  });
});
