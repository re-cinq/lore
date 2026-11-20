import { describe, it, expect } from "vitest";
import { latestVersionTag, nextVersion } from "./next-version.js";

describe("latestVersionTag", () => {
  it("returns v1.10.0 for v1.9.3 and v1.10.0, comparing the parts as numbers", () => {
    expect(latestVersionTag(["v1.9.3", "v1.10.0"])).toBe("v1.10.0");
  });

  it("returns v2.0.0 for v1.99.99, v2.0.0 and v1.100.0", () => {
    expect(latestVersionTag(["v1.99.99", "v2.0.0", "v1.100.0"])).toBe("v2.0.0");
  });

  it("returns v1.2.3 for v1.2, 1.2.3, v1.2.3, v1.2.3-rc.1 and release-5, which only v1.2.3 is of the form", () => {
    expect(
      latestVersionTag(["v1.2", "1.2.3", "v1.2.3", "v1.2.3-rc.1", "release-5"]),
    ).toBe("v1.2.3");
  });

  it("returns null for v1.2, 1.2.3, v1.2.3-rc.1 and release-5", () => {
    expect(
      latestVersionTag(["v1.2", "1.2.3", "v1.2.3-rc.1", "release-5"]),
    ).toBeNull();
  });

  it("returns null for no tags", () => {
    expect(latestVersionTag([])).toBeNull();
  });
});

describe("nextVersion", () => {
  it("returns v0.1.0 for no previous tag and a major bump", () => {
    expect(nextVersion(null, "major")).toBe("v0.1.0");
  });

  it("returns v0.1.0 for no previous tag and a patch bump", () => {
    expect(nextVersion(null, "patch")).toBe("v0.1.0");
  });

  it("returns v2.0.0 for v1.9.9 and a major bump", () => {
    expect(nextVersion("v1.9.9", "major")).toBe("v2.0.0");
  });

  it("returns v1.3.0 for v1.2.4 and a minor bump", () => {
    expect(nextVersion("v1.2.4", "minor")).toBe("v1.3.0");
  });

  it("returns v1.2.5 for v1.2.4 and a patch bump", () => {
    expect(nextVersion("v1.2.4", "patch")).toBe("v1.2.5");
  });

  it("returns v1.10.0 for v1.9.9 and a minor bump", () => {
    expect(nextVersion("v1.9.9", "minor")).toBe("v1.10.0");
  });

  it("refuses v1.2 as a previous tag", () => {
    expect(() => nextVersion("v1.2", "patch")).toThrow(
      new Error("last release tag v1.2 is not of the form vX.Y.Z"),
    );
  });

  it("refuses v1.2.3-rc.1 as a previous tag", () => {
    expect(() => nextVersion("v1.2.3-rc.1", "minor")).toThrow(
      new Error("last release tag v1.2.3-rc.1 is not of the form vX.Y.Z"),
    );
  });
});
