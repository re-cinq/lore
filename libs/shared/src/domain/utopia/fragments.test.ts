import { describe, it, expect } from "vitest";
import { splitToFit, type Fragment } from "./fragments.js";
import { attribute } from "./statements.js";

const partOf = (index: number, statements: number): Fragment => ({
  e: [[`part-${index}`, "Test", true]],
  s: Array.from({ length: statements }, (_, row) =>
    attribute(`part-${index}`, `field-${row}`, "x"),
  ),
});

const build = (parts: Fragment[]) => ({
  e: parts.flatMap((part) => part.e),
  s: parts.flatMap((part) => part.s),
});

describe("splitToFit", () => {
  it("packs 8 parts of 60 statements into groups of 3, 3 and 2 under the 200-statement limit", () => {
    const parts = Array.from({ length: 8 }, (_, index) => partOf(index, 60));

    expect(
      splitToFit("test:a.ts", parts, build).map((pushed) => pushed.e.length),
    ).toEqual([3, 3, 2]);
  });

  it("names the items test:a.ts, test:a.ts.2 and test:a.ts.3 in order", () => {
    const parts = Array.from({ length: 8 }, (_, index) => partOf(index, 60));

    expect(
      splitToFit("test:a.ts", parts, build).map((pushed) => pushed.externalId),
    ).toEqual(["test:a.ts", "test:a.ts.2", "test:a.ts.3"]);
  });

  it("keeps a single part that alone exceeds the limit as its own item", () => {
    const parts = [partOf(0, 10), partOf(1, 250), partOf(2, 10)];

    expect(
      splitToFit("test:a.ts", parts, build).map((pushed) => pushed.s.length),
    ).toEqual([10, 250, 10]);
  });
});
