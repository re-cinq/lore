import { describe, it, expect } from "vitest";
// @ts-expect-error: We are intentionally testing that recomputeSpecFile is exported
import { recomputeFile, recomputeSpecFile } from "./recompute-spec-file.js";

describe("recomputeSpecFile", () => {
  it("is exported as a thin alias for recomputeFile", () => {
    expect(recomputeSpecFile).toBeDefined();
    expect(recomputeSpecFile).toBe(recomputeFile);
  });
});
