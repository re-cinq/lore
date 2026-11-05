import { describe, it, expect } from "vitest";
import { anchorHashOf } from "../anchor-hash.js";
import { resolveAnchorLine } from "./resolve-anchor-line.js";

const ADDS = '  it("adds numbers", () => {';
const SOURCE = ["// one", "// two", ADDS, "  });"].join("\n");
const ADDS_HASH = anchorHashOf(ADDS);

describe("resolveAnchorLine", () => {
  it("returns line 3, where the hash now sits, for a link written at line 1", () => {
    expect(resolveAnchorLine({ line: 1, hash: ADDS_HASH }, SOURCE)).toBe(3);
  });

  it("returns the written line 7 for a hash no line carries", () => {
    expect(resolveAnchorLine({ line: 7, hash: "00000000" }, SOURCE)).toBe(7);
  });

  it("returns the written line 7 for a link with no hash", () => {
    expect(resolveAnchorLine({ line: 7, hash: null }, SOURCE)).toBe(7);
  });

  it("returns the written line 7 when the cited file cannot be read", () => {
    expect(resolveAnchorLine({ line: 7, hash: ADDS_HASH }, null)).toBe(7);
  });
});
