import { describe, it, expect } from "vitest";
import { previewBlock } from "./preview-block";

describe("previewBlock", () => {
  it("returns the first paragraph of prose, dropping later blocks", () => {
    const content =
      "First paragraph here.\n\nSecond paragraph that should be cut.";
    expect(previewBlock(content, "doc")).toEqual("First paragraph here.");
  });

  it("keeps a leading heading together with the first paragraph", () => {
    const content = "# Title\n\nLead paragraph.\n\nTrailing paragraph.";
    expect(previewBlock(content, "doc")).toEqual("# Title\n\nLead paragraph.");
  });

  it("returns a lone heading when no paragraph follows", () => {
    expect(previewBlock("# Title only", "doc")).toEqual("# Title only");
  });

  it("caps code chunks at the first 12 lines", () => {
    const code = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const result = previewBlock(code, "code");
    expect(result.split("\n")).toHaveLength(12);
    expect(result.split("\n")[0]).toEqual("line 1");
    expect(result.split("\n")[11]).toEqual("line 12");
  });

  it("returns short code unchanged", () => {
    expect(previewBlock("const x = 1;", "code")).toEqual("const x = 1;");
  });

  it("returns an empty string for empty or whitespace-only content", () => {
    expect(previewBlock("", "doc")).toEqual("");
    expect(previewBlock("   \n\n  ", "code")).toEqual("");
  });
});
