import { describe, it, expect } from "vitest";
import { PLANNING_INSTRUCTIONS, PLANNING_EXAMPLE } from "./planning-instructions.js";
import { parseGapResult } from "./gap-result.js";

describe("PLANNING_INSTRUCTIONS", () => {
  it("ships an example that parses cleanly against the GapResult schema", () => {
    expect(parseGapResult(PLANNING_EXAMPLE)).toEqual(PLANNING_EXAMPLE);
  });

  it("pins every mandatory field name the parser is strict-ish about", () => {
    for (const field of ["responsibility", "touchpoints", "section", "draft_spec_markdown", "split_suggestion", "options"]) {
      expect(PLANNING_INSTRUCTIONS).toContain(field);
    }
  });

  it("requires an Integration section in the draft spec", () => {
    expect(PLANNING_INSTRUCTIONS).toContain("## Integration");
  });
});
