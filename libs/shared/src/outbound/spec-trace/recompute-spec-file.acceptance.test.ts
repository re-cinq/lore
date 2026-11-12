import { describe, it, expect } from "vitest";
import { recomputeFile, recomputeSpecFile } from "./recompute-spec-file.js";

describe("recomputeSpecFile delegator", () => {
  it("delegates to recomputeFile.", async () => {
    expect(typeof recomputeSpecFile).toBe("function");

    const fakeDgraph = {} as any;

    await expect(
      recomputeSpecFile("repo", "specs/never.md", fakeDgraph),
    ).rejects.toThrow();
  });
});

describe("recomputeSpecFile", () => {
  it("is exported as a thin alias for recomputeFile", () => {
    expect(recomputeSpecFile).toBe(recomputeFile);
  });
});
