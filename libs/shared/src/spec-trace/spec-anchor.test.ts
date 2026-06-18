import { describe, it, expect } from "vitest";
import { parseSpecAnchor, parseSpecAnchors } from "./spec-anchor.js";

describe("parseSpecAnchor", () => {
  it("parses a path#ordinal anchor", () => {
    expect(parseSpecAnchor("specs/a/spec.md#7")).toEqual({ specPath: "specs/a/spec.md", ordinal: 7 });
  });

  it("returns null for a missing # separator", () => {
    expect(parseSpecAnchor("specs/a/spec.md")).toBeNull();
  });

  it("returns null for a non-integer ordinal", () => {
    expect(parseSpecAnchor("specs/a/spec.md#x")).toBeNull();
  });
});

describe("parseSpecAnchors", () => {
  it("wraps a single string anchor", () => {
    expect(parseSpecAnchors("specs/a/spec.md#3")).toEqual([{ specPath: "specs/a/spec.md", ordinal: 3 }]);
  });

  it("parses an array of anchors, dropping the unparseable ones", () => {
    expect(parseSpecAnchors(["specs/a/spec.md#3", "garbage", "specs/b/spec.md#5"])).toEqual([
      { specPath: "specs/a/spec.md", ordinal: 3 },
      { specPath: "specs/b/spec.md", ordinal: 5 },
    ]);
  });

  it("returns an empty array for undefined", () => {
    expect(parseSpecAnchors(undefined)).toEqual([]);
  });
});
