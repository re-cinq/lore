import { describe, it, expect } from "vitest";
import { featureDirOf } from "./feature-dir.js";

/**
 * featureDirOf groups a spec file's path to the feature folder that owns it — the
 * node the UI hangs every `.md` of one speckit folder under. Deeper nesting under
 * `specs/<feature>/` collapses to the feature folder; non-`specs/` trees group by
 * their immediate directory; a root-level file has no feature.
 */
describe("featureDirOf", () => {
  it("returns specs/1-lore-platform for a spec.md inside that feature folder", () => {
    expect(featureDirOf("specs/1-lore-platform/spec.md")).toBe("specs/1-lore-platform");
  });

  it("collapses a nested contracts/ doc to its feature folder", () => {
    expect(featureDirOf("specs/1-lore-platform/contracts/mcp-tools.md")).toBe("specs/1-lore-platform");
  });

  it("returns .specify for a .specify/spec.md", () => {
    expect(featureDirOf(".specify/spec.md")).toBe(".specify");
  });

  it("returns null for a repo-root file with no directory", () => {
    expect(featureDirOf("SPEC.md")).toBeNull();
  });
});
