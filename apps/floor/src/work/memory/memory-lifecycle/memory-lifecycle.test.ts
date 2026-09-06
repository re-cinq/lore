import { describe, it, expect } from "vitest";
import { parseConsolidationPatterns } from "./memory-lifecycle.js";

describe("parseConsolidationPatterns", () => {
  it("extracts PATTERN: prefixed lines and drops the prose around them", () => {
    const response = `Looking at these facts, I see:

PATTERN: The team consistently uses ephemeral K8s Jobs for long-running tasks to survive agent deploys.
PATTERN: Cross-repo ingestion requires HEAD ref, not specific commit SHAs.

Those are the main ones.`;

    expect(parseConsolidationPatterns(response)).toEqual([
      "The team consistently uses ephemeral K8s Jobs for long-running tasks to survive agent deploys.",
      "Cross-repo ingestion requires HEAD ref, not specific commit SHAs.",
    ]);
  });

  it("returns nothing for a NONE reply, which carries no prefix", () => {
    expect(parseConsolidationPatterns("NONE")).toEqual([]);
  });

  it("keeps 11 characters and drops 10, the filter being length > 10", () => {
    const response = ["PATTERN: 12345678901", "PATTERN: 1234567890"].join("\n");

    expect(parseConsolidationPatterns(response)).toEqual(["12345678901"]);
  });
});
