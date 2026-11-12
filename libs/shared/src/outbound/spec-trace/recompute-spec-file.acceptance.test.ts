import { describe, it, expect } from "vitest";
import { recomputeSpecFile } from "./recompute-spec-file.js";

describe("recomputeSpecFile delegator", () => {
  it("delegates to recomputeFile.", async () => {
    expect(typeof recomputeSpecFile).toBe("function");

    const fakeDgraph = {} as any;

    await expect(
      recomputeSpecFile("repo", "specs/never.md", fakeDgraph),
    ).rejects.toThrow();
  });
});
