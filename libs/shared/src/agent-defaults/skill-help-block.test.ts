import { describe, expect, it } from "vitest";
import { hasValidHelpBlock } from "./skill-help-block.js";

const BEGIN = "<!-- lore-help:begin -->";
const END = "<!-- lore-help:end -->";
const SUMMARY = "**Summary.** Does a thing.";
const USAGE = "**Usage:** `/thing`";

const skillWith = (...blockLines: string[]) =>
  ["# Thing", "", "## Help", "", ...blockLines].join("\n");

describe("hasValidHelpBlock", () => {
  it("returns true when one block holds a Summary and a Usage line", () => {
    expect(hasValidHelpBlock(skillWith(BEGIN, SUMMARY, USAGE, END))).toBe(true);
  });

  it("returns false for each malformed block: no Summary, no Usage, two begins, two ends, no end, inline marker, lines outside the block", () => {
    const malformedBlocks: Record<string, string[]> = {
      noSummary: [BEGIN, USAGE, END],
      noUsage: [BEGIN, SUMMARY, END],
      twoBegins: [BEGIN, BEGIN, SUMMARY, USAGE, END],
      twoEnds: [BEGIN, SUMMARY, USAGE, END, END],
      noEnd: [BEGIN, SUMMARY, USAGE],
      inlineMarker: [`See ${BEGIN}`, SUMMARY, USAGE, END],
      linesOutsideBlock: [SUMMARY, USAGE, BEGIN, END],
    };

    expect(
      Object.entries(malformedBlocks).filter(([, lines]) =>
        hasValidHelpBlock(skillWith(...lines)),
      ),
    ).toEqual([]);
  });
});
