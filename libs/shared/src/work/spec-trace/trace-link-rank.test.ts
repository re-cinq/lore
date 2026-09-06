import { describe, it, expect } from "vitest";
import { rankEvidence, highestTier } from "./trace-link.js";

describe("evidence tier ladder", () => {
  it("ranks execution-verified highest down to llm-suggested and picks the highest from a list", () => {
    expect(rankEvidence("execution-verified")).toBeGreaterThan(
      rankEvidence("generated-provenance"),
    );
    expect(rankEvidence("generated-provenance")).toBeGreaterThan(
      rankEvidence("human-linked"),
    );
    expect(rankEvidence("human-linked")).toBeGreaterThan(
      rankEvidence("coverage-bridged"),
    );
    expect(rankEvidence("coverage-bridged")).toBeGreaterThan(
      rankEvidence("llm-suggested"),
    );
    expect(
      highestTier(["human-linked", "execution-verified", "llm-suggested"]),
    ).toBe("execution-verified");
    expect(highestTier([])).toBeUndefined();
  });
});
