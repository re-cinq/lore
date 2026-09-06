import { describe, it, expect } from "vitest";
import { featureDirOf } from "./feature-dir.js";

describe("featureDirOf — groups a spec path to its owning feature folder", () => {
  it("returns specs/1-lore-platform for a spec.md inside that feature folder", () => {
    expect(featureDirOf("specs/1-lore-platform/spec.md")).toBe(
      "specs/1-lore-platform",
    );
  });

  it("collapses a nested contracts/ doc to its feature folder", () => {
    expect(featureDirOf("specs/1-lore-platform/contracts/mcp-tools.md")).toBe(
      "specs/1-lore-platform",
    );
  });

  it("returns .specify for a .specify/spec.md", () => {
    expect(featureDirOf(".specify/spec.md")).toBe(".specify");
  });

  it("returns null for a repo-root file with no directory", () => {
    expect(featureDirOf("SPEC.md")).toBeNull();
  });
});
