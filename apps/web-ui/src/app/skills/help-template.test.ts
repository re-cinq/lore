import { describe, it, expect } from "vitest";
import { HELP_BLOCK_TEMPLATE } from "./help-template";

const occurrencesOf = (text: string, part: string) =>
  text.split(part).length - 1;

describe("HELP_BLOCK_TEMPLATE", () => {
  it("holds each lore-help marker once and the Summary and Usage line starts", () => {
    expect({
      begin: occurrencesOf(HELP_BLOCK_TEMPLATE, "<!-- lore-help:begin -->"),
      end: occurrencesOf(HELP_BLOCK_TEMPLATE, "<!-- lore-help:end -->"),
      summaryLines: HELP_BLOCK_TEMPLATE.split("\n").filter((line) =>
        line.startsWith("**Summary.**"),
      ).length,
      usageLines: HELP_BLOCK_TEMPLATE.split("\n").filter((line) =>
        line.startsWith("**Usage:**"),
      ).length,
    }).toEqual({ begin: 1, end: 1, summaryLines: 1, usageLines: 1 });
  });
});
