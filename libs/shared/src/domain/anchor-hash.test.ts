import { describe, it, expect } from "vitest";
import fixtures from "./anchor-hash.fixtures.json" with { type: "json" };
import {
  anchorHashOf,
  linesWithHash,
  nearestLine,
  normalizeAnchorLine,
} from "./anchor-hash.js";

describe("anchorHashOf", () => {
  it("normalizes and hashes every line of the fixtures re-lint and lore-code-trace share", () => {
    expect(
      fixtures.map(({ line }) => ({
        line,
        normalized: normalizeAnchorLine(line),
        hash: anchorHashOf(line),
      })),
    ).toEqual(fixtures);
  });

  it("returns null for a closing line", () => {
    expect(anchorHashOf("});")).toBeNull();
  });
});

describe("linesWithHash", () => {
  it("returns lines 1 and 3 of a source that repeats the hashed line", () => {
    const line = 'it("returns true when positive", () => {';

    expect(
      linesWithHash([line, "});", line].join("\n"), anchorHashOf(line) ?? ""),
    ).toEqual([1, 3]);
  });
});

describe("nearestLine", () => {
  it("returns 40 near 30 and 10 near 25 from lines 10 and 40", () => {
    expect([nearestLine([10, 40], 30), nearestLine([10, 40], 25)]).toEqual([
      40, 10,
    ]);
  });
});
