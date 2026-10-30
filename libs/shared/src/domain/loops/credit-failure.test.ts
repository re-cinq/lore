import { describe, expect, it } from "vitest";
import { creditFailureOf } from "./credit-failure.js";

const ANTHROPIC =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';

describe("creditFailureOf", () => {
  it("returns the agent visit's credit error", () => {
    expect(
      creditFailureOf([
        { report: { outcome: "success" } },
        { report: { outcome: "failed", error: ANTHROPIC } },
      ]),
    ).toBe(ANTHROPIC);
  });

  it("returns a service station's Gemini quota error", () => {
    const quota =
      "429 You exceeded your current quota, please check your plan and billing details.";

    expect(
      creditFailureOf([{ report: { outcome: "failed", error: quota } }]),
    ).toBe(quota);
  });

  it("returns null when the failure is not about credit", () => {
    expect(
      creditFailureOf([
        { report: { outcome: "failed", error: "tests failed: 3 of 40" } },
        { report: null },
      ]),
    ).toBeNull();
  });

  it("returns null for a successful visit that quoted the credit message", () => {
    expect(
      creditFailureOf([{ report: { outcome: "success", error: ANTHROPIC } }]),
    ).toBeNull();
  });
});
