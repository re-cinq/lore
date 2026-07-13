import { describe, it, expect } from "vitest";
import { isAcceptanceCriteriaHeading } from "../project-spec-file.js";

describe("isAcceptanceCriteriaHeading", () => {
  it("matches the canonical heading and its title variants", () => {
    for (const h of [
      "Acceptance Criteria",
      "Acceptance criteria",
      "**Acceptance Criteria:**",
      "Success Criteria",
      "Independent Test Criteria",
      "User Scenarios & Acceptance Criteria",
    ]) {
      expect(isAcceptanceCriteriaHeading(h)).toBe(true);
    }
  });

  it("does not match ordinary headings or null", () => {
    for (const h of [
      "Problem Statement",
      "Solution",
      "Interface",
      "Out of Scope",
      null,
    ]) {
      expect(isAcceptanceCriteriaHeading(h)).toBe(false);
    }
  });
});
