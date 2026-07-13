import { describe, it, expect } from "vitest";
import { segmentBlocks, reassembleBlocks } from "./spec-blocks.js";

describe("segmentBlocks / reassembleBlocks", () => {
  it("round-trips a single-paragraph source verbatim", () => {
    const content = "The widget emits a click event.";
    expect(reassembleBlocks(segmentBlocks(content))).toBe(content);
    expect(segmentBlocks(content)).toEqual([
      { ordinal: 0, kind: "paragraph", text: content },
    ]);
  });

  it("segments two blank-separated paragraphs into paragraph, blank, paragraph", () => {
    const content = "First paragraph.\n\nSecond paragraph.";
    expect(segmentBlocks(content)).toEqual([
      { ordinal: 0, kind: "paragraph", text: "First paragraph." },
      { ordinal: 1, kind: "blank", text: "" },
      { ordinal: 2, kind: "paragraph", text: "Second paragraph." },
    ]);
    expect(reassembleBlocks(segmentBlocks(content))).toBe(content);
  });

  it("splits an ATX heading into a level-2 heading block before the following paragraph", () => {
    const content = "## Overview\nThe widget emits a click event.";
    expect(segmentBlocks(content)).toEqual([
      { ordinal: 0, kind: "heading", level: 2, text: "## Overview" },
      {
        ordinal: 1,
        kind: "paragraph",
        text: "The widget emits a click event.",
      },
    ]);
    expect(reassembleBlocks(segmentBlocks(content))).toBe(content);
  });

  it("keeps a fenced code block with an internal blank and # line as one verbatim code block", () => {
    const content = [
      "```ts",
      "const x = 1;",
      "",
      "# not a heading inside code",
      "```",
    ].join("\n");
    expect(segmentBlocks(content)).toEqual([
      { ordinal: 0, kind: "code", text: content },
    ]);
    expect(reassembleBlocks(segmentBlocks(content))).toBe(content);
  });

  it("groups header, separator, and data rows into one table block", () => {
    const content = ["| Col A | Col B |", "| --- | --- |", "| 1 | 2 |"].join(
      "\n",
    );
    expect(segmentBlocks(content)).toEqual([
      { ordinal: 0, kind: "table", text: content },
    ]);
    expect(reassembleBlocks(segmentBlocks(content))).toBe(content);
  });

  it("splits two bullet lines into two separate list-item blocks", () => {
    const content = ["- First point", "- Second point"].join("\n");
    expect(segmentBlocks(content)).toEqual([
      { ordinal: 0, kind: "list-item", text: "- First point" },
      { ordinal: 1, kind: "list-item", text: "- Second point" },
    ]);
    expect(reassembleBlocks(segmentBlocks(content))).toBe(content);
  });
});
