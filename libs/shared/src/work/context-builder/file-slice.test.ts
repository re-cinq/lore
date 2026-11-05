import { describe, expect, it } from "vitest";
import { linesAround, relevantSlice } from "./file-slice.js";

const LONG = Array.from({ length: 400 }, (_, index) =>
  index === 200
    ? "export function isOutOfBudget(failure) {"
    : `const line${index} = ${"x".repeat(20)};`,
).join("\n");

describe("relevantSlice", () => {
  it("returns a 3,000-character file whole", () => {
    const short = "a".repeat(3000);

    expect(relevantSlice(short, ["isOutOfBudget"], 15_000)).toBe(short);
  });

  it("keeps the 20 numbered lines around isOutOfBudget on line 201 of a 400-line file, behind a gap marker", () => {
    const lines = relevantSlice(LONG, ["isOutOfBudget"], 15_000).split("\n");

    expect({
      gap: lines[0],
      first: lines[1],
      hit: lines[21],
      count: lines.length,
    }).toEqual({
      gap: "…",
      first: `181: const line180 = ${"x".repeat(20)};`,
      hit: "201: export function isOutOfBudget(failure) {",
      count: 42,
    });
  });

  it("falls back to the file's head when no word matches, cut at the budget", () => {
    expect(relevantSlice(LONG, ["nothing-here"], 100)).toBe(LONG.slice(0, 100));
  });

  it("ignores words shorter than 4 characters when matching", () => {
    expect(relevantSlice(LONG, ["is", "of"], 100)).toBe(LONG.slice(0, 100));
  });
});

describe("linesAround", () => {
  it("returns lines 77 to 107 numbered around line 92 of a 200-line file", () => {
    const file = Array.from({ length: 200 }, (_, index) => `row ${index + 1}`);
    const lines = linesAround(file.join("\n"), 92, 15).split("\n");

    expect({ first: lines[0], last: lines[30], count: lines.length }).toEqual({
      first: "77: row 77",
      last: "107: row 107",
      count: 31,
    });
  });
});
