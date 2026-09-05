import { describe, it, expect } from "vitest";
import { autoReviewEnabled } from "../lib/should-auto-review.js";

describe("autoReviewEnabled", () => {
  it("returns true when auto_review is the boolean true", () => {
    expect(autoReviewEnabled({ auto_review: true })).toBe(true);
  });

  it("returns false when auto_review is false, absent, or settings are null", () => {
    expect(autoReviewEnabled({ auto_review: false })).toBe(false);
    expect(autoReviewEnabled({})).toBe(false);
    expect(autoReviewEnabled(null)).toBe(false);
  });

  it("parses a JSON string settings blob", () => {
    expect(autoReviewEnabled('{"auto_review":true}')).toBe(true);
    expect(autoReviewEnabled("not json")).toBe(false);
  });
});
