import { describe, expect, it } from "vitest";
import { creditFailureOf } from "./credit-failure.js";

const ANTHROPIC =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';

describe("creditFailureOf", () => {
  it("returns the agent visit's credit error", () => {
    expect(
      creditFailureOf([
        { nodeId: "dod", report: { outcome: "success" } },
        {
          nodeId: "tdd-round",
          report: { outcome: "failed", error: ANTHROPIC },
        },
      ]),
    ).toBe(ANTHROPIC);
  });

  it("returns a service station's Gemini quota error", () => {
    const quota =
      "429 You exceeded your current quota, please check your plan and billing details.";

    expect(
      creditFailureOf([
        { nodeId: "decompose", report: { outcome: "failed", error: quota } },
      ]),
    ).toBe(quota);
  });

  it("returns null when the failure is not about credit", () => {
    expect(
      creditFailureOf([
        {
          nodeId: "tdd-round",
          report: { outcome: "failed", error: "tests failed: 3 of 40" },
        },
        { nodeId: "await-ci", report: null },
      ]),
    ).toBeNull();
  });

  it("returns null for a successful visit that quoted the credit message", () => {
    expect(
      creditFailureOf([
        { nodeId: "review", report: { outcome: "success", error: ANTHROPIC } },
      ]),
    ).toBeNull();
  });

  it("returns the reproduce visit's credit error when the run went on to label-failed", () => {
    expect(
      creditFailureOf([
        {
          nodeId: "reproduce",
          report: { outcome: "failed", error: ANTHROPIC },
        },
        { nodeId: "label-failed", report: { outcome: "success" } },
      ]),
    ).toBe(ANTHROPIC);
  });

  it("returns null when the review that ran out of credit succeeded on its retry", () => {
    expect(
      creditFailureOf([
        { nodeId: "review", report: { outcome: "failed", error: ANTHROPIC } },
        { nodeId: "review", report: { outcome: "success" } },
      ]),
    ).toBeNull();
  });
});
