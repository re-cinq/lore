import { describe, it, expect } from "vitest";
import { segmentBlocks, reassembleBlocks } from "./spec-blocks.js";

describe("spec-blocks lossless layer fences", () => {
  it("keeps a tilde fenced code block as one verbatim code block", () => {
    const content = ["~~~ts", "const x = 1;", "~~~"].join("\n");

    const blocks = segmentBlocks(content);

    expect(blocks).toEqual([{ ordinal: 0, kind: "code", text: content }]);
    expect(reassembleBlocks(blocks)).toBe(content);
  });

  it("keeps an indented fenced code block as one verbatim code block", () => {
    const content = ["  ```ts", "  const x = 1;", "  ```"].join("\n");

    const blocks = segmentBlocks(content);

    expect(blocks).toEqual([{ ordinal: 0, kind: "code", text: content }]);
    expect(reassembleBlocks(blocks)).toBe(content);
  });

  it("keeps a code block with longer fence delimiters and internal short fences as one verbatim code block", () => {
    const content = ["`````ts", "```", "const x = 1;", "```", "`````"].join(
      "\n",
    );

    const blocks = segmentBlocks(content);

    expect(blocks).toEqual([{ ordinal: 0, kind: "code", text: content }]);
    expect(reassembleBlocks(blocks)).toBe(content);
  });
});
