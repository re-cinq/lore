import { describe, it, expect } from "vitest";
import { parseReviewVerdict } from "./node-outcome.js";

describe("parseReviewVerdict", () => {
  it("maps APPROVED to success and CHANGES_REQUESTED to changes_requested", () => {
    expect(parseReviewVerdict("notes\nREVIEW_RESULT:APPROVED")).toBe("success");
    expect(parseReviewVerdict("REVIEW_RESULT:CHANGES_REQUESTED: fix it")).toBe(
      "changes_requested",
    );
  });

  it("returns null for empty output or no marker", () => {
    expect(parseReviewVerdict(undefined)).toBeNull();
    expect(parseReviewVerdict("just logs, no verdict")).toBeNull();
  });
});
