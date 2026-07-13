import { describe, it, expect } from "vitest";
import { repoRelativeLinkTarget } from "../link-target-path.js";

describe("repoRelativeLinkTarget", () => {
  it("returns a repo-relative target unchanged", () => {
    expect(repoRelativeLinkTarget("specs/x/spec.md", "shared/src/a.ts")).toBe(
      "shared/src/a.ts",
    );
  });

  it("resolves a ../-relative target against the spec's directory", () => {
    expect(
      repoRelativeLinkTarget("specs/x/spec.md", "../../shared/src/a.ts"),
    ).toBe("shared/src/a.ts");
  });

  it("resolves a ./-relative target against the spec's directory", () => {
    expect(repoRelativeLinkTarget("specs/x/spec.md", "./notes.ts")).toBe(
      "specs/x/notes.ts",
    );
  });

  it("drops a bare anchor target", () => {
    expect(
      repoRelativeLinkTarget(
        "specs/x/spec.md",
        "#divergences-from-original-design",
      ),
    ).toBeNull();
  });

  it("drops an empty target", () => {
    expect(repoRelativeLinkTarget("specs/x/spec.md", "")).toBeNull();
  });

  it("drops a target that escapes the repo root", () => {
    expect(
      repoRelativeLinkTarget("specs/spec.md", "../../../etc/passwd"),
    ).toBeNull();
  });

  it("strips a fragment from an otherwise valid target", () => {
    expect(
      repoRelativeLinkTarget("specs/x/spec.md", "shared/src/a.ts#L10"),
    ).toBe("shared/src/a.ts");
  });
});
